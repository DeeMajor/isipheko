import { describe, expect, it } from 'vitest'

import {
  MAX_BODY_BYTES,
  MAX_PHOTO_BYTES,
  formatPhotoTicket,
  isAcceptedFormat,
  isPhotoDigest,
  parsePhotoFile,
  parsePhotoTicket,
  photoDigest,
  photoFile,
  photoKey,
  photoToken,
  photoTokenMatches,
  scanImageMetadata,
  sniffPhotoFormat,
} from '@/domain/media'

/**
 * The pure half of M4-01: what is accepted, what it is called, and what the
 * metadata reader sees.
 *
 * No codec here. The stripping itself is `photo-stripping.test.ts`, which needs
 * a real encoder; everything in this file is bytes in and an answer out.
 */

const bytes = (...values: (number | string)[]): Uint8Array => {
  const out: number[] = []

  for (const value of values) {
    if (typeof value === 'number') out.push(value)
    else for (const char of value) out.push(char.charCodeAt(0))
  }

  return new Uint8Array(out)
}

const zeros = (length: number): number[] => Array.from({ length }, () => 0)

const u32be = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

const u32le = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
]

describe('what counts as a photo', () => {
  it('reads the format out of the bytes, never the name', () => {
    expect(sniffPhotoFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(sniffPhotoFormat(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png')
    expect(sniffPhotoFormat(bytes('RIFF', ...u32le(100), 'WEBPVP8 '))).toBe('webp')
  })

  /**
   * The whole reason the check is on magic bytes. Every one of these arrives
   * with a name and a `content-type` that says it is a photo, and every one of
   * them is something else — an SVG is script, a PDF is a document a browser
   * will happily render, and a ZIP is whatever is inside it.
   */
  it.each([
    ['an SVG, which is script', bytes('<svg xmlns="http://www.w3.org/2000/svg">')],
    ['an SVG behind an XML declaration', bytes('<?xml version="1.0"?><svg>')],
    ['a PDF', bytes('%PDF-1.7\n')],
    ['a ZIP', bytes('PK', 0x03, 0x04)],
    ['a GIF', bytes('GIF89a')],
    ['an ELF binary', bytes(0x7f, 'ELF')],
    ['nothing at all', new Uint8Array()],
  ])('refuses %s however it is named', (_what, content) => {
    expect(sniffPhotoFormat(content)).toBe('unknown')
    expect(isAcceptedFormat(sniffPhotoFormat(content))).toBe(false)
  })

  /**
   * HEIC is refused, and it is refused **by name**, because "that is an iPhone
   * photo, send it as a JPEG" is something a person can act on and "we could
   * not read that file" is not.
   */
  it.each(['heic', 'heix', 'mif1', 'msf1'])('names a HEIC by its brand: %s', (brand) => {
    expect(sniffPhotoFormat(bytes(...u32be(24), 'ftyp', brand))).toBe('heic')
  })

  /**
   * AVIF is what we produce and deliberately not what we accept. Taking an
   * already-encoded AVIF would be the one input where a future short cut
   * ("it is already the right format, skip the re-encode") would carry
   * somebody's metadata straight through.
   */
  it('does not accept AVIF as an input', () => {
    expect(sniffPhotoFormat(bytes(...u32be(24), 'ftyp', 'avif'))).toBe('unknown')
  })

  it('leaves room for a real photo and none for a video', () => {
    expect(MAX_PHOTO_BYTES).toBe(8 * 1024 * 1024)
    // The body ceiling is above the photo cap on purpose: between the two, an
    // oversized photo is refused with the rest of the flow's state intact.
    expect(MAX_BODY_BYTES).toBeGreaterThan(MAX_PHOTO_BYTES)
  })
})

describe('what a stored photo is called', () => {
  it('names bytes, so the same photo always lands in the same place', () => {
    const first = photoDigest(bytes('the same picture'))
    const second = photoDigest(bytes('the same picture'))

    expect(first).toBe(second)
    expect(photoDigest(bytes('a different one'))).not.toBe(first)
    expect(isPhotoDigest(first)).toBe(true)
  })

  it('scopes the key to the umcimbi it was uploaded for', () => {
    const digest = photoDigest(bytes('x'))

    expect(photoKey('event-1', digest, 'full', 'avif')).toBe(
      `photo/event-1/${digest}-full.avif`,
    )
    expect(photoKey('event-2', digest, 'thumb', 'webp')).toBe(
      `photo/event-2/${digest}-thumb.webp`,
    )
  })

  it('round-trips the file name in the URL', () => {
    const digest = photoDigest(bytes('x'))

    expect(parsePhotoFile(photoFile(digest, 'thumb', 'webp'))).toEqual({
      digest,
      size: 'thumb',
      format: 'webp',
    })
  })

  /**
   * The file name reaches an object store, and an object store's key becomes a
   * path. `isValidObjectKey` refuses traversal too — this refuses it a layer
   * earlier, where the shape is known exactly.
   */
  it.each([
    '../../../etc/passwd',
    'ffffffffffffffffffffffffffffffff-full.png',
    'ffffffffffffffffffffffffffffffff-huge.avif',
    'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF-full.avif',
    'abc-full.avif',
    'ffffffffffffffffffffffffffffffff-full.avif.exe',
    '',
  ])('refuses %s as a file name', (name) => {
    expect(parsePhotoFile(name)).toBeNull()
  })
})

describe('the ticket that carries a photo to the pay step', () => {
  const PEPPER = 'test-pepper'
  const DIGEST = photoDigest(bytes('a photo'))
  const CLAIM = { digest: DIGEST, width: 2400, height: 1600 }

  it('verifies what it signed', () => {
    const token = photoToken('event-1', CLAIM, PEPPER)

    expect(photoTokenMatches('event-1', CLAIM, PEPPER, token)).toBe(true)
  })

  /**
   * The reason the ticket is signed at all. A hidden field is a field anybody
   * can edit, and a bare digest would let somebody paste a photo recovered from
   * another umcimbi's URL onto their own contribution.
   */
  it('does not verify across events', () => {
    const token = photoToken('event-1', CLAIM, PEPPER)

    expect(photoTokenMatches('event-2', CLAIM, PEPPER, token)).toBe(false)
  })

  it('does not verify a swapped digest, a wrong pepper or a truncated token', () => {
    const token = photoToken('event-1', CLAIM, PEPPER)
    const other = { ...CLAIM, digest: photoDigest(bytes('another photo')) }

    expect(photoTokenMatches('event-1', other, PEPPER, token)).toBe(false)
    expect(photoTokenMatches('event-1', CLAIM, 'other-pepper', token)).toBe(false)
    expect(photoTokenMatches('event-1', CLAIM, PEPPER, token.slice(0, -1))).toBe(false)
    expect(photoTokenMatches('event-1', CLAIM, PEPPER, '')).toBe(false)
  })

  /**
   * The dimensions are inside the signature, not beside it. They become the
   * space an image reserves in the album before it loads, so an editable pair
   * would be an editable layout — one photo pushing everything else off the
   * page. Not a hole worth leaving open for nothing.
   */
  it('does not verify edited dimensions', () => {
    const token = photoToken('event-1', CLAIM, PEPPER)

    expect(photoTokenMatches('event-1', { ...CLAIM, height: 9999 }, PEPPER, token)).toBe(
      false,
    )
    expect(photoTokenMatches('event-1', { ...CLAIM, width: 1 }, PEPPER, token)).toBe(
      false,
    )
  })

  it('travels as one field', () => {
    const ticket = formatPhotoTicket(CLAIM, photoToken('event-1', CLAIM, PEPPER))
    const parsed = parsePhotoTicket(ticket)

    expect(parsed?.claim).toEqual(CLAIM)
    expect(photoTokenMatches('event-1', CLAIM, PEPPER, parsed?.token ?? '')).toBe(true)
  })

  it.each([
    '',
    '.',
    'nodot',
    '.onlytoken',
    `${'a'.repeat(32)}.token`,
    `${'a'.repeat(32)}.0x600.token`,
    `${'a'.repeat(32)}.800x0.token`,
    `${'a'.repeat(32)}.800x600.`,
    `${'z'.repeat(32)}.800x600.token`,
  ])('refuses %s as a ticket', (ticket) => {
    expect(parsePhotoTicket(ticket)).toBeNull()
  })
})

/**
 * The reader that makes "EXIF confirmed stripped" mean something.
 *
 * These fixtures are assembled by hand rather than by an encoder, so the
 * assertion in `photo-stripping.test.ts` — that this returns nothing for every
 * derivative — is made by something that shares no code with the encoder it is
 * checking. A reader that always returned an empty array would pass that test;
 * it does not pass this one.
 */
describe('the independent metadata reader', () => {
  const pngChunk = (type: string, payload: number[] = []) => [
    ...u32be(payload.length),
    ...[...type].map((char) => char.charCodeAt(0)),
    ...payload,
    ...u32be(0),
  ]

  const png = (...chunks: number[][]) =>
    bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat())

  it('finds a PNG text chunk, a timestamp and an EXIF chunk', () => {
    const image = png(
      pngChunk('IHDR', zeros(13)),
      pngChunk(
        'tEXt',
        [...'Comment'].map((c) => c.charCodeAt(0)),
      ),
      pngChunk('tIME', zeros(7)),
      pngChunk('eXIf', [0x49, 0x49, 0x2a, 0x00]),
      pngChunk('IEND'),
    )

    expect(scanImageMetadata(image)).toEqual([
      { kind: 'text', at: 'tEXt' },
      { kind: 'timestamp', at: 'tIME' },
      { kind: 'exif', at: 'eXIf' },
    ])
  })

  it('finds nothing in a PNG that carries nothing', () => {
    expect(scanImageMetadata(png(pngChunk('IHDR', zeros(13)), pngChunk('IEND')))).toEqual(
      [],
    )
  })

  it('finds EXIF, XMP and an ICC profile in a WebP', () => {
    const chunk = (type: string, size: number) => [
      ...[...type].map((char) => char.charCodeAt(0)),
      ...u32le(size),
      ...zeros(size),
    ]

    const image = bytes(
      'RIFF',
      ...u32le(200),
      'WEBP',
      ...chunk('VP8 ', 8),
      ...chunk('ICCP', 4),
      ...chunk('EXIF', 4),
      ...chunk('XMP ', 4),
    )

    expect(scanImageMetadata(image)).toEqual([
      { kind: 'icc', at: 'ICCP' },
      { kind: 'exif', at: 'EXIF' },
      { kind: 'xmp', at: 'XMP ' },
    ])
  })

  it('finds an EXIF segment and a comment in a JPEG', () => {
    const segment = (marker: number, payload: number[]) => [
      0xff,
      marker,
      ((payload.length + 2) >> 8) & 0xff,
      (payload.length + 2) & 0xff,
      ...payload,
    ]

    const image = bytes(
      0xff,
      0xd8,
      ...segment(
        0xe1,
        [...'Exif\0\0'].map((c) => c.charCodeAt(0)),
      ),
      ...segment(
        0xfe,
        [...'taken at home'].map((c) => c.charCodeAt(0)),
      ),
      // Entropy data follows SOS and is not scanned: marker bytes appear in it
      // by coincidence, and a reader that kept going would report them.
      0xff,
      0xda,
      0xff,
      0xe1,
      0x00,
      0x08,
    )

    expect(scanImageMetadata(image)).toEqual([
      { kind: 'exif', at: 'APP1' },
      { kind: 'comment', at: 'COM' },
    ])
  })
})
