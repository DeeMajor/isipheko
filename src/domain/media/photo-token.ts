import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * How a photo survives the walk from the *who* step to the *pay* step.
 *
 * The contribution row does not exist until the pay step — a reference code
 * needs something to be unique against — and a file cannot ride in a hidden
 * field. So the bytes are processed and stored the moment they arrive, and what
 * travels forward is a description of what was stored.
 *
 * **A bare digest in a hidden field would be a form anybody can edit.** Paste
 * another event's digest, or one recovered from a URL in a chat, and the next
 * submit attaches somebody else's photo to your contribution. The ticket is
 * therefore signed with an HMAC over the whole claim — the event, the digest
 * and the dimensions together — verified before any of it is written to a row.
 *
 * The dimensions are inside the signature rather than beside it because they
 * end up in the album's markup (M4-02) as the space an image reserves before it
 * loads. Editable dimensions would be an editable layout: not a security hole,
 * but a field somebody could use to make one photo push everything else off the
 * page, and there is no reason to leave it open.
 *
 * Stateless, like the claim undo token it is modelled on
 * (`src/domain/needs/undo.ts`): no column, no row to clean up, and nothing in a
 * database dump beyond a hash of bytes that are already public.
 */

export interface PhotoClaim {
  readonly digest: string
  readonly width: number
  readonly height: number
}

function payload(eventId: string, claim: PhotoClaim): string {
  return `contribution-photo:${eventId}:${claim.digest}:${String(claim.width)}x${String(claim.height)}`
}

export function photoToken(eventId: string, claim: PhotoClaim, pepper: string): string {
  return createHmac('sha256', pepper).update(payload(eventId, claim)).digest('base64url')
}

/** Constant-time. A fast reject on a capability is an oracle. */
export function photoTokenMatches(
  eventId: string,
  claim: PhotoClaim,
  pepper: string,
  presented: string,
): boolean {
  const expected = Buffer.from(photoToken(eventId, claim, pepper), 'utf8')
  const actual = Buffer.from(presented, 'utf8')

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** `<digest>.<width>x<height>.<token>` — one hidden field rather than four. */
export function formatPhotoTicket(claim: PhotoClaim, token: string): string {
  return `${claim.digest}.${String(claim.width)}x${String(claim.height)}.${token}`
}

export function parsePhotoTicket(
  ticket: string,
): { readonly claim: PhotoClaim; readonly token: string } | null {
  const match = /^([0-9a-f]{32})\.(\d{1,5})x(\d{1,5})\.(.+)$/.exec(ticket)
  if (match === null) return null

  const width = Number(match[2])
  const height = Number(match[3])

  // Zero is not a dimension, and a photo with one would reserve no space —
  // which is the failure this whole pair of numbers exists to prevent.
  if (width === 0 || height === 0) return null

  return {
    claim: { digest: match[1] ?? '', width, height },
    token: match[4] ?? '',
  }
}
