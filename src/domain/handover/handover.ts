import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The handover — implementation plan Part D2.4, and the emotional peak of the
 * product.
 *
 * A group puts money and a printed record into a family's hands. **The host
 * does nothing in the system** (rule 15): they are burying their mother and
 * have nothing to do in here, so the confirmation cannot depend on them.
 *
 * Three ways it can close, in order of what the record is worth:
 *
 * 1. **A witness** — one of the group, standing there, taps once on their own
 *    phone. The record closes with their name against it.
 * 2. **The organiser, on her own word.** Phones die and signal fails at
 *    gravesides. The record says it was her word rather than a witness's, and
 *    **that difference stays on it** — which is the point, not an apology.
 * 3. **The host acknowledges**, optionally, later. It is never required and it
 *    changes nothing except the record's own account of itself.
 *
 * Pure: hashing, clocks and labels. `node:crypto` only, which the domain
 * boundary allows for exactly this (docs/decisions.md M1-01 §4).
 */

export type HandoverTokenKind = 'witness' | 'host'

/**
 * How long a handover link lives.
 *
 * Long enough that it can be sent a week before the day and still work on the
 * morning; short enough that a link forwarded into a group chat is not a live
 * capability a year later. The umcimbi is the unit of time here, not the
 * calendar.
 */
export const HANDOVER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 32 bytes from the CSPRNG, base64url — the same shape as a session token
 * (M1-06) and for the same reason: 256 bits has no small space to guess and
 * nothing about it is derived from the person.
 */
export function generateHandoverToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * SHA-256, no pepper — same call as the session token. A 256-bit random value
 * cannot be precomputed, so a peppered HMAC would add key management for
 * nothing. What matters is that the database holds the hash: **a dump yields no
 * usable link.**
 */
export function hashHandoverToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function handoverTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashHandoverToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function handoverTokenExpiresAt(now: Date): Date {
  return new Date(now.getTime() + HANDOVER_TOKEN_TTL_MS)
}

/** Only what the rules need — never the Prisma row (rule 6). */
export interface HandoverTokenState {
  readonly kind: HandoverTokenKind
  readonly expiresAt: Date
  readonly redeemedAt: Date | null
}

export type TokenRejection = 'expired' | 'already-used'

/**
 * Whether a link can still be tapped.
 *
 * Single use is the whole of the mitigation for a capability that lives in a
 * URL: a link forwarded on, screenshotted, or left in a browser's history
 * confirms nothing a second time. Expiry is the rest of it.
 */
export function checkHandoverToken(
  token: HandoverTokenState,
  now: Date,
): { readonly ok: true } | { readonly ok: false; readonly reason: TokenRejection } {
  if (token.redeemedAt !== null) return { ok: false, reason: 'already-used' }
  if (token.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }

  return { ok: true }
}

/**
 * How the record describes the way it was closed.
 *
 * A witness's tap and an organiser's own word are **not the same thing**, and
 * the incwadi says which it was for as long as the paper lasts. The design is
 * explicit about this: *"It is worth less than a witness's tap, and anyone
 * reading it later will see the difference."*
 */
export type ConfirmationKind = 'witness' | 'organiser' | 'host'

export function confirmationRank(kind: ConfirmationKind): number {
  // Only used to decide what the seal says when more than one thing happened.
  // A host acknowledgement never displaces the account of who actually closed
  // the record — it is an extra line, not a better one.
  return kind === 'witness' ? 2 : kind === 'organiser' ? 1 : 0
}

/**
 * Whether a host acknowledgement is still meaningful.
 *
 * Only after the handover is closed: acknowledging a handover that has not
 * happened would be the family confirming something nobody has done, and the
 * link is optional precisely so nothing waits on it (rule 15).
 */
export function canAcknowledge(handoverStatus: string): boolean {
  return (
    handoverStatus === 'witness_confirmed' || handoverStatus === 'organiser_evidenced'
  )
}
