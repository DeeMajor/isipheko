import sharp from 'sharp'

import {
  DERIVATIVE_FORMATS,
  PHOTO_SIZES,
  edgeFor,
  type Derivative,
  type ImageProcessor,
  type PhotoFormat,
  type ProcessedPhoto,
} from '@/domain/media'

/**
 * The only file in the codebase that imports sharp.
 *
 * sharp is libvips, and libvips is a native binary — so this is server-side and
 * costs the public page nothing. It is already an optional dependency of Next
 * itself, for the image optimiser, which is the reason it was the one to add:
 * it is a package this stack expects rather than a new vendor. AVIF needs an
 * AV1 encoder and there is no way to have one without a dependency; the parts
 * that *can* be written without one — magic-byte sniffing, the metadata reader
 * — are, in `src/domain/media/`.
 *
 * **Synchronous, on the request.** 200–500ms of CPU bounded by an 8MB cap does
 * not justify Redis and BullMQ, which nothing else in this codebase has needed
 * yet either (M1-06 §4, M2-08 §1).
 */

/**
 * A cap on what a decoder will expand to, independent of the byte cap.
 *
 * 8MB of PNG can describe an enormous canvas that costs gigabytes of RAM the
 * moment it is decoded — the decompression bomb, and the byte limit does not
 * see it coming. libvips refuses beyond this instead.
 */
const MAX_PIXELS = 60_000_000

/**
 * Quality settings. AVIF at 50 is visually equivalent to a JPEG in the high
 * seventies at roughly half the bytes; WebP needs a higher number for the same
 * result. Both matter — this is a photo travelling to somebody on a prepaid
 * bundle.
 */
const AVIF_QUALITY = 50
const WEBP_QUALITY = 72

export class SharpImageProcessor implements ImageProcessor {
  async process(bytes: Uint8Array, format: PhotoFormat): Promise<ProcessedPhoto> {
    /*
     * The pipeline that removes the location the camera saved.
     *
     * `rotate()` with no argument applies the EXIF orientation to the pixels.
     * It has to happen here, before the metadata goes, or a photo taken
     * sideways stays sideways once the tag that explained it is gone.
     *
     * Nothing calls `withMetadata`, `keepMetadata`, `keepExif` or
     * `keepIccProfile`, and nothing may: sharp's default is to carry none of it
     * across, and every one of those methods is a way to put the GPS back.
     *
     * `failOn: 'error'` refuses a truncated or malformed file rather than
     * decoding as much of it as it can. `unlimited: false` keeps libvips' own
     * ceilings on.
     */
    const source = sharp(bytes, {
      failOn: 'error',
      limitInputPixels: MAX_PIXELS,
      unlimited: false,
    })
      .rotate()
      // The format is what the magic bytes said, not what the request claimed.
      // Passing it on means an inconsistency between the two shows up as a
      // decode failure rather than as a silently different picture.
      .toFormat(format === 'jpeg' ? 'jpeg' : format)

    // Decoded once, held as raw pixels, encoded four times. Decoding an 8MB
    // JPEG four times over would be four times the work for the same answer.
    const { data, info } = await source
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch((cause: unknown) => {
        throw new Error('Could not decode the image', { cause })
      })

    const derivatives: Derivative[] = []

    for (const size of PHOTO_SIZES) {
      const resized = sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      }).resize({
        width: edgeFor(size),
        height: edgeFor(size),
        fit: 'inside',
        // Never scale a small photo up. Somebody's 400px picture stays 400px
        // rather than becoming a soft 2400px one at ten times the bytes.
        withoutEnlargement: true,
      })

      for (const output of DERIVATIVE_FORMATS) {
        const encoded = await (output === 'avif'
          ? resized.clone().avif({ quality: AVIF_QUALITY, effort: 4 })
          : resized.clone().webp({ quality: WEBP_QUALITY, effort: 4 })
        ).toBuffer({ resolveWithObject: true })

        derivatives.push({
          size,
          format: output,
          bytes: new Uint8Array(encoded.data),
          width: encoded.info.width,
          height: encoded.info.height,
        })
      }
    }

    const full = derivatives.find((derivative) => derivative.size === 'full')

    return {
      derivatives,
      width: full?.width ?? info.width,
      height: full?.height ?? info.height,
    }
  }
}
