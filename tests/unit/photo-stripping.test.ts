import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import { SharpImageProcessor } from '@/adapters/media'
import {
  MAX_PHOTO_EDGE,
  THUMB_PHOTO_EDGE,
  findGpsFix,
  scanImageMetadata,
  type Derivative,
} from '@/domain/media'

/**
 * **The reason this task exists.**
 *
 * A JPEG straight off a phone carries the position it was taken at. On a
 * funeral contribution that position is the family's house, published to
 * everybody holding the link — so the fixture here is a photo with a real fix
 * in KwaZulu-Natal, and the test is that nothing which leaves this pipeline
 * still knows about it.
 *
 * The assertions are made by `src/domain/media/metadata-scan.ts`, which shares
 * no code with sharp. A test in which the encoder is asked whether the encoder
 * stripped the metadata proves only that it agrees with itself.
 */

/** Roughly KwaMashu — a house, which is exactly the point. */
const LATITUDE = -29.851
const LONGITUDE = 31.0186666

async function phonePhoto({
  width = 1200,
  height = 800,
  orientation,
}: { width?: number; height?: number; orientation?: number } = {}): Promise<Uint8Array> {
  const image = sharp({
    create: { width, height, channels: 3, background: '#8C2F22' },
  }).withExif({
    IFD0: { Make: 'Apple', Model: 'iPhone 13' },
    IFD3: {
      GPSLatitudeRef: 'S',
      GPSLatitude: '29/1 51/1 3600/1000',
      GPSLongitudeRef: 'E',
      GPSLongitude: '31/1 1/1 7200/1000',
    },
  })

  // Orientation is not an ordinary EXIF tag to sharp — it reads and rewrites it
  // itself — so it is set separately, after the rest, which is the order that
  // keeps both.
  const oriented = orientation === undefined ? image : image.withMetadata({ orientation })

  return new Uint8Array(await oriented.jpeg().toBuffer())
}

const processor = new SharpImageProcessor()

describe('the fixture', () => {
  /**
   * Without this, every assertion below is vacuous: a reader that always found
   * nothing, or a fixture that never carried anything, would pass the whole
   * file. This is the test that the test means something.
   */
  it('really does carry the family’s address', async () => {
    const photo = await phonePhoto()

    const fix = findGpsFix(photo)
    expect(fix).not.toBeNull()
    expect(fix?.latitude).toBeCloseTo(LATITUDE, 3)
    expect(fix?.longitude).toBeCloseTo(LONGITUDE, 3)

    expect(scanImageMetadata(photo)).toContainEqual({ kind: 'exif', at: 'APP1' })
  })
})

describe('what comes out of the pipeline', () => {
  let derivatives: readonly Derivative[]

  beforeAll(async () => {
    derivatives = (await processor.process(await phonePhoto(), 'jpeg')).derivatives
  })

  it('is four files: full and thumb, each as AVIF and as WebP', () => {
    expect(
      derivatives.map((derivative) => `${derivative.size}.${derivative.format}`).sort(),
    ).toEqual(['full.avif', 'full.webp', 'thumb.avif', 'thumb.webp'])
  })

  /**
   * **Every derivative, not just the primary one.**
   *
   * A stripped AVIF beside an unstripped WebP fallback is the whole protection
   * lost to whichever format the browser happens to pick — and the fallback is
   * the one an older phone gets, which is most of the phones this is for.
   */
  it('carries no metadata of any kind, in any of the four', () => {
    for (const derivative of derivatives) {
      expect({
        which: `${derivative.size}.${derivative.format}`,
        markers: scanImageMetadata(derivative.bytes),
      }).toEqual({ which: `${derivative.size}.${derivative.format}`, markers: [] })
    }
  })

  it('carries no GPS fix, in any of the four', () => {
    for (const derivative of derivatives) {
      expect(findGpsFix(derivative.bytes)).toBeNull()
    }
  })

  it('never puts the coordinates back as raw bytes either', () => {
    // Belt and braces against the scanner missing a container it does not know:
    // the strings a phone writes should not survive anywhere in the output.
    for (const derivative of derivatives) {
      const text = Buffer.from(derivative.bytes).toString('latin1')

      expect(text).not.toContain('iPhone')
      expect(text).not.toContain('Apple')
      expect(text).not.toContain('Exif')
    }
  })

  it('is smaller than what went in, which is the other half of the point', async () => {
    const original = await phonePhoto()
    const full = derivatives.find(
      (derivative) => derivative.size === 'full' && derivative.format === 'avif',
    )

    expect(full?.bytes.length ?? Infinity).toBeLessThan(original.length)
  })
})

describe('dimensions', () => {
  it('caps the long edge and keeps the shape', async () => {
    const { derivatives } = await processor.process(
      await phonePhoto({ width: 4000, height: 3000 }),
      'jpeg',
    )

    const full = derivatives.find((d) => d.size === 'full' && d.format === 'avif')
    const thumb = derivatives.find((d) => d.size === 'thumb' && d.format === 'avif')

    expect(full?.width).toBe(MAX_PHOTO_EDGE)
    expect(full?.height).toBe(1800)
    expect(thumb?.width).toBe(THUMB_PHOTO_EDGE)
    expect(thumb?.height).toBe(240)
  })

  it('never enlarges a small photo', async () => {
    const { derivatives } = await processor.process(
      await phonePhoto({ width: 200, height: 150 }),
      'jpeg',
    )

    for (const derivative of derivatives) {
      expect(derivative.width).toBe(200)
      expect(derivative.height).toBe(150)
    }
  })

  /**
   * Orientation has to be applied to the pixels *before* the metadata goes.
   * The other way round, a photo taken sideways is stored sideways for good —
   * the tag that told the browser how to turn it is no longer there to do it.
   */
  it('turns a sideways photo the right way up before the tag is dropped', async () => {
    const { derivatives } = await processor.process(
      // 6: rotate 90° clockwise. A landscape frame that is really a portrait.
      await phonePhoto({ width: 1200, height: 800, orientation: 6 }),
      'jpeg',
    )

    const full = derivatives.find((d) => d.size === 'full' && d.format === 'avif')

    expect(full?.width).toBe(800)
    expect(full?.height).toBe(1200)
  })
})

describe('what it refuses', () => {
  it('throws on a truncated file rather than decoding half of it', async () => {
    const photo = await phonePhoto()

    await expect(processor.process(photo.slice(0, 400), 'jpeg')).rejects.toThrow(
      /decode/i,
    )
  })

  it('throws on bytes that are not the format they were sniffed as', async () => {
    const png = new Uint8Array(
      await sharp({
        create: { width: 10, height: 10, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer(),
    )

    // A PNG cannot be handed to the pipeline as a JPEG. In production the
    // format comes from the magic bytes, so the two can only disagree if
    // something upstream is wrong — and then this fails loudly.
    await expect(processor.process(png.slice(0, 30), 'jpeg')).rejects.toThrow()
  })
})
