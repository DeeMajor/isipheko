/**
 * An independent reader for the metadata a photo is supposed to no longer have.
 *
 * **This exists so that "EXIF confirmed stripped" means something.** A test in
 * which sharp encodes an image and sharp is then asked whether the metadata is
 * gone proves that sharp agrees with itself. This walks the container formats
 * by hand — JPEG segments, PNG chunks, RIFF chunks, ISO-BMFF boxes — and
 * reports what it finds, so the assertion is made by something that shares no
 * code with the thing it is checking.
 *
 * It is deliberately a *reader*, not a stripper. Nothing in the product removes
 * metadata by editing bytes; removal happens by decoding to pixels and encoding
 * again, which is the only approach that cannot leave a segment behind in a
 * format nobody thought about.
 */

export type MarkerKind = 'exif' | 'xmp' | 'icc' | 'comment' | 'text' | 'timestamp'

export interface MetadataMarker {
  readonly kind: MarkerKind
  /** Where it was found, for a failing test's message: `APP1`, `eXIf`, `Exif`. */
  readonly at: string
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let index = offset; index < offset + length && index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index] ?? 0)
  }
  return out
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) +
      ((bytes[offset + 1] ?? 0) << 8) +
      ((bytes[offset + 2] ?? 0) << 16) +
      (bytes[offset + 3] ?? 0) * 0x1000000) >>>
    0
  )
}

/* -------------------------------------------------------------------------- */
/* JPEG                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Segments run from SOI to SOS. Scanning stops at SOS because what follows is
 * entropy-coded pixel data, in which the marker bytes appear by coincidence.
 */
function scanJpeg(bytes: Uint8Array): MetadataMarker[] {
  const found: MetadataMarker[] = []
  let offset = 2

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break

    const marker = bytes[offset + 1] ?? 0

    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    if (marker === 0xd9 || marker === 0xda) break

    const length = u16be(bytes, offset + 2)
    if (length < 2) break

    const payload = offset + 4
    const at = `APP${String(marker - 0xe0)}`

    if (marker === 0xe1) {
      const tag = ascii(bytes, payload, 6)
      if (tag.startsWith('Exif')) found.push({ kind: 'exif', at })
      else if (ascii(bytes, payload, 28).startsWith('http://ns.adobe.com/xap'))
        found.push({ kind: 'xmp', at })
      else found.push({ kind: 'exif', at })
    } else if (marker === 0xe2 && ascii(bytes, payload, 11) === 'ICC_PROFILE') {
      found.push({ kind: 'icc', at })
    } else if (marker === 0xfe) {
      found.push({ kind: 'comment', at: 'COM' })
    }

    offset += 2 + length
  }

  return found
}

/* -------------------------------------------------------------------------- */
/* PNG                                                                         */
/* -------------------------------------------------------------------------- */

const PNG_MARKERS: Readonly<Record<string, MarkerKind>> = {
  eXIf: 'exif',
  tEXt: 'text',
  iTXt: 'text',
  zTXt: 'text',
  tIME: 'timestamp',
  iCCP: 'icc',
}

function scanPng(bytes: Uint8Array): MetadataMarker[] {
  const found: MetadataMarker[] = []
  let offset = 8

  while (offset + 8 <= bytes.length) {
    const length = u32be(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)

    const kind = PNG_MARKERS[type]
    if (kind !== undefined) found.push({ kind, at: type })

    if (type === 'IEND') break
    offset += 12 + length
  }

  return found
}

/* -------------------------------------------------------------------------- */
/* RIFF / WebP                                                                 */
/* -------------------------------------------------------------------------- */

const RIFF_MARKERS: Readonly<Record<string, MarkerKind>> = {
  EXIF: 'exif',
  'XMP ': 'xmp',
  ICCP: 'icc',
}

function scanRiff(bytes: Uint8Array): MetadataMarker[] {
  const found: MetadataMarker[] = []
  let offset = 12

  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4)
    const size = u32le(bytes, offset + 4)

    const kind = RIFF_MARKERS[type]
    if (kind !== undefined) found.push({ kind, at: type })

    // Chunks are padded to an even length.
    offset += 8 + size + (size % 2)
  }

  return found
}

/* -------------------------------------------------------------------------- */
/* ISO-BMFF / AVIF                                                             */
/* -------------------------------------------------------------------------- */

/** Boxes whose payload is more boxes. `meta` is a full box: 4 extra bytes. */
const CONTAINERS = new Set(['meta', 'iinf', 'iprp', 'ipco', 'moov', 'trak', 'mdia'])
const FULL_BOXES = new Set(['meta'])

function scanBmff(bytes: Uint8Array, start: number, end: number): MetadataMarker[] {
  const found: MetadataMarker[] = []
  let offset = start

  while (offset + 8 <= end) {
    const declared = u32be(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)

    // 0 means "to the end of the file"; 1 means a 64-bit size follows, which
    // nothing this size produces.
    const size = declared === 0 ? end - offset : declared
    if (size < 8) break

    if (type === 'Exif') found.push({ kind: 'exif', at: 'Exif' })
    if (type === 'xml ' || type === 'uuid') found.push({ kind: 'xmp', at: type })

    if (type === 'infe') {
      // Full box: version(1) flags(3) item_ID(2) protection(2) item_type(4).
      const itemType = ascii(bytes, offset + 16, 4)
      if (itemType === 'Exif') found.push({ kind: 'exif', at: 'infe/Exif' })
      if (itemType === 'mime') found.push({ kind: 'xmp', at: 'infe/mime' })
    }

    if (CONTAINERS.has(type)) {
      const inner = offset + 8 + (FULL_BOXES.has(type) ? 4 : 0)
      found.push(...scanBmff(bytes, inner, Math.min(offset + size, end)))
    }

    offset += size
  }

  return found
}

/**
 * Everything metadata-shaped in an image, whatever its container.
 *
 * An empty array is the assertion the upload path has to satisfy, for **every**
 * derivative it stores — the AVIF, the WebP fallback and both thumbnails. A
 * stripped AVIF beside an unstripped WebP is the whole protection lost to the
 * browser that picks second.
 */
export function scanImageMetadata(bytes: Uint8Array): readonly MetadataMarker[] {
  if (bytes.length < 12) return []

  const riff = ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
  if (riff) return scanRiff(bytes)

  if ((bytes[0] ?? 0) === 0xff && (bytes[1] ?? 0) === 0xd8) return scanJpeg(bytes)
  if (ascii(bytes, 1, 3) === 'PNG') return scanPng(bytes)
  if (ascii(bytes, 4, 4) === 'ftyp') return scanBmff(bytes, 0, bytes.length)

  return []
}

/* -------------------------------------------------------------------------- */
/* GPS                                                                         */
/* -------------------------------------------------------------------------- */

export interface GpsFix {
  readonly latitude: number
  readonly longitude: number
}

interface TiffEntry {
  readonly type: number
  readonly count: number
  readonly valueOffset: number
  /** Where the four value bytes sit, for the values that are stored inline. */
  readonly valueAt: number
}

function readIfd(
  bytes: Uint8Array,
  tiff: number,
  ifd: number,
  little: boolean,
): Map<number, TiffEntry> {
  const u16 = (at: number) =>
    little ? (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) : u16be(bytes, at)
  const u32 = (at: number) => (little ? u32le(bytes, at) : u32be(bytes, at))

  const entries = new Map<number, TiffEntry>()
  const count = u16(tiff + ifd)

  for (let index = 0; index < count; index += 1) {
    const at = tiff + ifd + 2 + index * 12
    if (at + 12 > bytes.length) break

    entries.set(u16(at), {
      type: u16(at + 2),
      count: u32(at + 4),
      valueOffset: u32(at + 8),
      valueAt: at + 8,
    })
  }

  return entries
}

function rationalTriple(
  bytes: Uint8Array,
  tiff: number,
  entry: TiffEntry | undefined,
  little: boolean,
): number | null {
  if (entry === undefined || entry.type !== 5 || entry.count < 3) return null

  const u32 = (at: number) => (little ? u32le(bytes, at) : u32be(bytes, at))
  const base = tiff + entry.valueOffset

  let degrees = 0
  for (let part = 0; part < 3; part += 1) {
    const numerator = u32(base + part * 8)
    const denominator = u32(base + part * 8 + 4)
    if (denominator === 0) return null

    degrees += numerator / denominator / 60 ** part
  }

  return degrees
}

/**
 * The coordinates a phone camera wrote into a JPEG, if they are still there.
 *
 * This is the reason the whole task exists. A JPEG straight off a phone carries
 * the position it was taken at, and on a funeral contribution that position is
 * the family's house — published to everyone holding the link. The test that
 * matters puts a real fix in and asserts this returns `null` afterwards.
 *
 * JPEG only. Nothing else we accept carries a GPS IFD in practice, and the
 * derivatives we write carry no EXIF at all — which `scanImageMetadata` is the
 * broader check for.
 */
export function findGpsFix(bytes: Uint8Array): GpsFix | null {
  if ((bytes[0] ?? 0) !== 0xff || (bytes[1] ?? 0) !== 0xd8) return null

  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null

    const marker = bytes[offset + 1] ?? 0
    if (marker === 0xd9 || marker === 0xda) return null

    const length = u16be(bytes, offset + 2)
    if (length < 2) return null

    if (marker === 0xe1 && ascii(bytes, offset + 4, 4) === 'Exif') {
      return gpsFromExif(bytes, offset + 10)
    }

    offset += 2 + length
  }

  return null
}

function gpsFromExif(bytes: Uint8Array, tiff: number): GpsFix | null {
  const order = ascii(bytes, tiff, 2)
  if (order !== 'II' && order !== 'MM') return null

  const little = order === 'II'
  const u32 = (at: number) => (little ? u32le(bytes, at) : u32be(bytes, at))

  const ifd0 = readIfd(bytes, tiff, u32(tiff + 4), little)
  const pointer = ifd0.get(0x8825)
  if (pointer === undefined) return null

  const gps = readIfd(bytes, tiff, pointer.valueOffset, little)

  const latitude = rationalTriple(bytes, tiff, gps.get(0x0002), little)
  const longitude = rationalTriple(bytes, tiff, gps.get(0x0004), little)
  if (latitude === null || longitude === null) return null

  // An ASCII value of four bytes or fewer is stored inline in the entry rather
  // than at an offset, and a hemisphere reference is one character plus a NUL.
  const reference = (entry: TiffEntry | undefined): string =>
    entry === undefined
      ? ''
      : entry.count <= 4
        ? ascii(bytes, entry.valueAt, 1)
        : ascii(bytes, tiff + entry.valueOffset, 1)

  const latRef = reference(gps.get(0x0001))
  const lonRef = reference(gps.get(0x0003))

  return {
    latitude: latRef === 'S' ? -latitude : latitude,
    longitude: lonRef === 'W' ? -longitude : longitude,
  }
}
