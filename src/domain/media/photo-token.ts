import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * How a photo survives the walk from the *who* step to the *pay* step.
 *
 * The contribution row does not exist until the pay step — a reference code
 * needs something to be unique against — and a file cannot ride in a hidden
 * field. So the bytes are processed and stored the moment they arrive, and what
 * travels forward is the digest they were stored under.
 *
 * **A bare digest in a hidden field would be a form anybody can edit.** Paste
 * another event's digest, or one recovered from a URL in a chat, and the next
 * submit attaches somebody else's photo to your contribution. The digest is
 * therefore carried with an HMAC over the pair `(event, digest)` — signed by
 * the server that stored it, bound to the umcimbi it was stored for, and
 * verified before it is written to a row.
 *
 * Stateless, like the claim undo token it is modelled on
 * (`src/domain/needs/undo.ts`): no column, no row to clean up, and nothing in a
 * database dump beyond a hash of bytes that are already public.
 */

export function photoToken(eventId: string, digest: string, pepper: string): string {
  return createHmac('sha256', pepper)
    .update(`contribution-photo:${eventId}:${digest}`)
    .digest('base64url')
}

/** Constant-time. A fast reject on a capability is an oracle. */
export function photoTokenMatches(
  eventId: string,
  digest: string,
  pepper: string,
  presented: string,
): boolean {
  const expected = Buffer.from(photoToken(eventId, digest, pepper), 'utf8')
  const actual = Buffer.from(presented, 'utf8')

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** `<digest>.<token>` — one hidden field rather than two. */
export function formatPhotoTicket(digest: string, token: string): string {
  return `${digest}.${token}`
}

export function parsePhotoTicket(
  ticket: string,
): { readonly digest: string; readonly token: string } | null {
  const separator = ticket.indexOf('.')
  if (separator <= 0) return null

  const digest = ticket.slice(0, separator)
  const token = ticket.slice(separator + 1)

  if (digest === '' || token === '') return null

  return { digest, token }
}
