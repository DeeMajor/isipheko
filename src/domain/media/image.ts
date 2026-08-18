import { createHash } from 'node:crypto'

/**
 * What may be attached to a contribution, and what is refused.
 *
 * Pure: sniffing, limits and key shapes only. Nothing here decodes an image —
 * that needs a codec, which lives behind `ImageProcessor` in
 * `src/domain/media/image-processor.ts` and is implemented in
 * `src/adapters/media/` (CLAUDE.md rule 6).
 *
 * **The format is decided by the bytes, never by the name or the browser.**
 * `content-type` on a multipart part is whatever the client wrote there, and an
 * extension is whatever somebody typed. A `.jpg` holding an SVG is a stored
 * XSS; a `.jpg` holding a PDF is a file we would hand back with an image
 * content type. Both are refused here, before anything else looks at them.
 */

/**
 * 8MB. A recent phone camera produces 3–6MB, so this is roomy for a real photo
 * and closed to a video somebody picked by mistake.
 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024

/**
 * The body ceiling, above which the request is refused **without being read**.
 *
 * Three times the photo cap, deliberately: between the two limits a real
 * oversized photo is parsed and rejected with the whole flow's state intact, so
 * the contributor keeps their amount, their name and their message and only
 * loses the photo. Above it there is nothing worth preserving and the body is
 * never buffered.
 */
export const MAX_BODY_BYTES = 3 * MAX_PHOTO_BYTES

/** Long edge of the stored photo. Beyond this nobody sees more detail on a phone. */
export const MAX_PHOTO_EDGE = 2400

/** Long edge of the thumbnail — the done step and the organiser's queue. */
export const THUMB_PHOTO_EDGE = 320

/** What we accept. Everything else, including HEIC, is refused by name. */
export type PhotoFormat = 'jpeg' | 'png' | 'webp'

/**
 * What we found in the first bytes.
 *
 * `heic` is not an accepted format and is still named, because "that is an
 * iPhone photo, save it as a JPEG" is a thing somebody can act on and "we could
 * not read that file" is not.
 */
export type SniffedFormat = PhotoFormat | 'heic' | 'unknown'

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false

  return signature.every((byte, index) => bytes[index] === byte)
}

function fourCC(bytes: Uint8Array, offset: number): string {
  if (bytes.length < offset + 4) return ''

  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  )
}

const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** HEIF brands. `heic`/`heix` are iPhone photos; `mif1`/`msf1` are the base. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim'])

/**
 * Magic bytes, and only magic bytes.
 *
 * AVIF shares the ISO-BMFF container with HEIC and is deliberately **not**
 * accepted as an input: we produce AVIF, and accepting it would mean taking
 * somebody's already-encoded file, which is the one path where metadata could
 * pass through untouched if a re-encode were ever skipped.
 */
export function sniffPhotoFormat(bytes: Uint8Array): SniffedFormat {
  if (startsWith(bytes, JPEG)) return 'jpeg'
  if (startsWith(bytes, PNG)) return 'png'

  if (fourCC(bytes, 0) === 'RIFF' && fourCC(bytes, 8) === 'WEBP') return 'webp'

  // ISO-BMFF: `....ftyp<brand>`. The size field is skipped — the brand is what
  // distinguishes an iPhone photo from anything else in the same container.
  if (fourCC(bytes, 4) === 'ftyp' && HEIF_BRANDS.has(fourCC(bytes, 8))) return 'heic'

  return 'unknown'
}

export function isAcceptedFormat(format: SniffedFormat): format is PhotoFormat {
  return format === 'jpeg' || format === 'png' || format === 'webp'
}

/**
 * Why a photo was refused. Each one maps to a sentence that says what to do
 * next — `src/copy/contribute.ts`, `photoErrors`.
 */
export type PhotoRejection =
  | 'empty'
  | 'too-big'
  | 'heic'
  | 'not-an-image'
  | 'unreadable'

/**
 * The name a photo is served under: 32 hex characters of SHA-256 over the
 * **processed** bytes.
 *
 * Content-addressed for the same reason the OG card is (M2-07 §2): the same
 * photo always lands on the same key, so a retry overwrites identical bytes,
 * and a URL can be served `immutable` because what it names cannot change.
 *
 * Hashed after processing rather than before, so the digest names bytes that
 * have already had their metadata removed. The original is never stored and
 * never named.
 */
export function photoDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32)
}

export function isPhotoDigest(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value)
}

export type PhotoSize = 'full' | 'thumb'
export type DerivativeFormat = 'avif' | 'webp'

export const PHOTO_SIZES = ['full', 'thumb'] as const
export const DERIVATIVE_FORMATS = ['avif', 'webp'] as const

/** The long edge each size is capped to. */
export function edgeFor(size: PhotoSize): number {
  return size === 'full' ? MAX_PHOTO_EDGE : THUMB_PHOTO_EDGE
}

/**
 * `<digest>-<size>.<format>` — the file name in the URL and the tail of the
 * object key, so the two cannot drift apart.
 */
export function photoFile(
  digest: string,
  size: PhotoSize,
  format: DerivativeFormat,
): string {
  return `${digest}-${size}.${format}`
}

/**
 * `photo/<event>/<digest>-<size>.<format>`.
 *
 * Scoped by event, so a key is not a handle to every photo on the platform and
 * a request has to name the umcimbi it belongs to.
 */
export function photoKey(
  eventId: string,
  digest: string,
  size: PhotoSize,
  format: DerivativeFormat,
): string {
  return `photo/${eventId}/${photoFile(digest, size, format)}`
}

export interface ParsedPhotoFile {
  readonly digest: string
  readonly size: PhotoSize
  readonly format: DerivativeFormat
}

/** A file name straight out of a URL, before it is used to look anything up. */
export function parsePhotoFile(value: string): ParsedPhotoFile | null {
  const match = /^([0-9a-f]{32})-(full|thumb)\.(avif|webp)$/.exec(value)
  if (match === null) return null

  return {
    digest: match[1] ?? '',
    size: match[2] as PhotoSize,
    format: match[3] as DerivativeFormat,
  }
}
