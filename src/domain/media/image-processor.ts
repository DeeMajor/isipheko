import type { DerivativeFormat, PhotoFormat, PhotoSize } from './image.ts'

/**
 * The codec boundary.
 *
 * Declared here and implemented in `src/adapters/media/`, the same dependency
 * inversion the payment provider, the SMS sender and the object store use
 * (CLAUDE.md rules 6 and 10). **Nothing in `src/domain/`, `src/app/` or
 * `src/ui/` imports sharp**, and the one file that does is the adapter.
 *
 * The interface takes bytes and returns bytes. It does not take a file, a path
 * or a stream, because a codec that reads from disk is a codec that can be
 * pointed at `/etc/passwd`.
 */

export interface Derivative {
  readonly size: PhotoSize
  readonly format: DerivativeFormat
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
}

export interface ProcessedPhoto {
  /** Four: full and thumb, each as AVIF and as WebP. */
  readonly derivatives: readonly Derivative[]
  /** The dimensions of the full derivative, after the cap was applied. */
  readonly width: number
  readonly height: number
}

/**
 * Decode, orient, cap, **discard every scrap of metadata**, re-encode.
 *
 * The order matters. EXIF orientation has to be applied to the pixels *before*
 * the metadata is dropped, or a photo taken sideways is stored sideways for
 * good — the tag that told the browser how to turn it will no longer be there.
 *
 * An implementation must produce derivatives that carry no EXIF, no XMP, no ICC
 * profile and no timestamp, and it must do so for **all four**. A stripped AVIF
 * beside an unstripped WebP fallback is the whole protection lost to whichever
 * format the browser picks.
 *
 * Throws on anything it cannot decode. The caller turns that into
 * `'unreadable'` — bytes that pass a magic-byte sniff and then fail to decode
 * are a truncated upload or a deliberately malformed file, and neither is
 * something to guess at.
 */
export interface ImageProcessor {
  process(bytes: Uint8Array, format: PhotoFormat): Promise<ProcessedPhoto>
}
