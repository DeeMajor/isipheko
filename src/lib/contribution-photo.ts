import { imageProcessor } from '@/adapters/media'
import { objectStore } from '@/adapters/storage'
import {
  MAX_PHOTO_BYTES,
  formatPhotoTicket,
  isAcceptedFormat,
  isPhotoDigest,
  parsePhotoTicket,
  photoDigest,
  photoFile,
  photoKey,
  photoToken,
  photoTokenMatches,
  sniffPhotoFormat,
  type PhotoClaim,
  type PhotoRejection,
} from '@/domain/media'

import { env } from './env'

/**
 * Everything between a file arriving on a form and a key on a contribution row.
 *
 * Order is the whole of it:
 *
 *   1. size, before anything is decoded
 *   2. **magic bytes**, never the extension and never the `content-type` the
 *      browser attached — both of those are written by whoever sent the request
 *   3. decode, orient, cap, strip, re-encode (`ImageProcessor`)
 *   4. store the derivatives; the original bytes are never written anywhere
 *   5. hand back a signed ticket, which is what the form carries forward
 *
 * The original is dropped on purpose. Keeping it "just in case" would keep the
 * GPS with it, in a bucket, indefinitely — which is precisely the thing this
 * task exists to prevent.
 */

export type PhotoOutcome =
  | {
      readonly ok: true
      readonly digest: string
      readonly ticket: string
      /**
       * The full derivative's dimensions, after the cap.
       *
       * Carried out of here so they can be written beside the key: the album
       * (M4-02) lazy-loads four hundred of these and an image with no intrinsic
       * size shifts the layout when it lands.
       */
      readonly width: number
      readonly height: number
    }
  | { readonly ok: false; readonly reason: PhotoRejection }

/**
 * Accept a photo for an event, or say why not.
 *
 * `eventId` is not decoration: the derivatives are stored under it and the
 * ticket is signed against it, so a ticket lifted from one umcimbi cannot
 * attach a photo to a contribution on another.
 */
export async function acceptPhoto(
  file: File,
  eventId: string,
): Promise<PhotoOutcome> {
  if (file.size === 0) return { ok: false, reason: 'empty' }
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, reason: 'too-big' }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // Checked again on the bytes actually received. `File.size` is a promise from
  // the transport, and this is the number that is true.
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, reason: 'too-big' }

  const sniffed = sniffPhotoFormat(bytes)
  if (sniffed === 'heic') return { ok: false, reason: 'heic' }
  if (!isAcceptedFormat(sniffed)) return { ok: false, reason: 'not-an-image' }

  let processed
  try {
    processed = await imageProcessor().process(bytes, sniffed)
  } catch {
    // The message is not surfaced. A decoder's complaint tells somebody probing
    // the endpoint which of their malformed files got furthest.
    return { ok: false, reason: 'unreadable' }
  }

  const full = processed.derivatives.find(
    (derivative) => derivative.size === 'full' && derivative.format === 'avif',
  )

  if (full === undefined) return { ok: false, reason: 'unreadable' }

  const digest = photoDigest(full.bytes)
  const claim = { digest, width: full.width, height: full.height }
  const store = objectStore()

  await Promise.all(
    processed.derivatives.map((derivative) =>
      store.put(photoKey(eventId, digest, derivative.size, derivative.format), {
        bytes: derivative.bytes,
        contentType: `image/${derivative.format}`,
      }),
    ),
  )

  return {
    ok: true,
    digest,
    ticket: formatPhotoTicket(claim, photoToken(eventId, claim, env.OTP_PEPPER)),
    width: full.width,
    height: full.height,
  }
}

/**
 * What a carried ticket is entitled to, or null.
 *
 * Called at the pay step, before anything is written to a row. An unsigned or
 * mis-signed ticket is treated as no photo at all rather than as an error: the
 * only way to hold one is to have edited the form, and a contribution without a
 * photo is a complete contribution.
 */
export function claimFromTicket(ticket: string, eventId: string): PhotoClaim | null {
  const parsed = parsePhotoTicket(ticket)
  if (parsed === null) return null
  if (!isPhotoDigest(parsed.claim.digest)) return null

  return photoTokenMatches(eventId, parsed.claim, env.OTP_PEPPER, parsed.token)
    ? parsed.claim
    : null
}

/** Just the digest, for the callers that only render. */
export function digestFromTicket(ticket: string, eventId: string): string | null {
  return claimFromTicket(ticket, eventId)?.digest ?? null
}

/** The stored key for the full AVIF — what goes on `contributions.photo_key`. */
export function fullPhotoKey(eventId: string, digest: string): string {
  return photoKey(eventId, digest, 'full', 'avif')
}

/**
 * The digest back out of a stored key, for rendering.
 *
 * The column holds a key rather than a digest because a key is what an object
 * store is asked for, and a row that names something unfetchable is worse than
 * a row that names four things.
 */
export function digestFromKey(key: string | null): string | null {
  if (key === null) return null

  const digest = /\/([0-9a-f]{32})-full\.avif$/.exec(key)?.[1]

  return digest ?? null
}

export interface PhotoSources {
  readonly avif: string
  readonly webp: string
}

/**
 * The two URLs a `<picture>` needs.
 *
 * AVIF first with an explicit `type`, WebP as the `<img>` itself. Negotiated by
 * the markup rather than by an `Accept` header, so every URL names exactly one
 * representation — cacheable at the edge without `Vary`, and correct on a proxy
 * that ignores it.
 */
export function photoSources(
  slug: string,
  digest: string,
  size: 'full' | 'thumb',
): PhotoSources {
  const base = `/e/${encodeURIComponent(slug)}/photo`

  return {
    avif: `${base}/${photoFile(digest, size, 'avif')}`,
    webp: `${base}/${photoFile(digest, size, 'webp')}`,
  }
}
