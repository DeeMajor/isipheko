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

/** A stored photo, before anybody decides what to do with the fact. */
export type StoredPhoto =
  | {
      readonly ok: true
      readonly digest: string
      readonly width: number
      readonly height: number
    }
  | { readonly ok: false; readonly reason: PhotoRejection }

/**
 * Size, sniff, decode, strip, re-encode, store. **The only stripper there is.**
 *
 * Extracted at M4-01b, when the collection handover needed the same pipeline
 * from a different surface. M4-01 §2 is firm that there must not be a second
 * one — the reader that proves the metadata is gone is independent of the
 * encoder on purpose, and a second path would need its own proof or would
 * quietly have none.
 *
 * `scopeId` is the event or the collection the derivatives are stored under. It
 * is not decoration: a key is not a handle to every photo on the platform, and a
 * request has to name what it belongs to.
 */
async function processAndStore(file: File, scopeId: string): Promise<StoredPhoto> {
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
  const store = objectStore()

  await Promise.all(
    processed.derivatives.map((derivative) =>
      store.put(photoKey(scopeId, digest, derivative.size, derivative.format), {
        bytes: derivative.bytes,
        contentType: `image/${derivative.format}`,
      }),
    ),
  )

  return { ok: true, digest, width: full.width, height: full.height }
}

/**
 * Accept a photo for a contribution, or say why not.
 *
 * The row does not exist yet — it is created at the pay step, two screens later
 * — so what comes back is an **HMAC-signed ticket** bound to the event rather
 * than a key in a hidden field, which is a field anybody can edit (M4-01 §3).
 */
export async function acceptPhoto(file: File, eventId: string): Promise<PhotoOutcome> {
  const stored = await processAndStore(file, eventId)
  if (!stored.ok) return stored

  const claim = { digest: stored.digest, width: stored.width, height: stored.height }

  return {
    ok: true,
    digest: stored.digest,
    ticket: formatPhotoTicket(claim, photoToken(eventId, claim, env.OTP_PEPPER)),
    width: stored.width,
    height: stored.height,
  }
}

/**
 * Accept a photograph of a handover, and answer with the key to record (M4-01b).
 *
 * **No ticket, because there is nothing to carry it across.** A contribution
 * photo is taken two screens before the row exists, so it travels as a signed
 * claim. A handover is one authenticated POST by the organiser against a
 * collection that already exists, so the key goes straight onto the row inside
 * the same transaction that closes the record.
 *
 * That is why this is a different function and not a flag: the contributor's
 * path needs a capability and hers does not, and giving her one would be a
 * capability nobody needs issued.
 */
export async function acceptHandoverPhoto(
  file: File,
  collectionId: string,
): Promise<{ ok: true; key: string } | { ok: false; reason: PhotoRejection }> {
  const stored = await processAndStore(file, collectionId)
  if (!stored.ok) return stored

  return { ok: true, key: photoKey(collectionId, stored.digest, 'full', 'avif') }
}

/**
 * Accept a photograph attached to a need claim, and answer with the key and its
 * dimensions (M4-02b).
 *
 * **Scoped by event, like every other contribution photo**, and that is not a
 * detail: `/e/[slug]/photo/[file]` builds its key from the event id, so a photo
 * stored under anything else would be written successfully and then be
 * unreachable from the album it exists for. Found by asking what would serve it.
 *
 * The claim row is written in the same request, so — like the handover and
 * unlike the contributor's flow — there is nothing to carry across and no
 * ticket to sign.
 *
 * The dimensions travel because the album lazy-loads and an image with no
 * intrinsic size shifts the layout as it lands (M4-02).
 */
export async function acceptClaimPhoto(
  file: File,
  eventId: string,
): Promise<
  | { ok: true; key: string; width: number; height: number }
  | { ok: false; reason: PhotoRejection }
> {
  const stored = await processAndStore(file, eventId)
  if (!stored.ok) return stored

  return {
    ok: true,
    key: photoKey(eventId, stored.digest, 'full', 'avif'),
    width: stored.width,
    height: stored.height,
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
