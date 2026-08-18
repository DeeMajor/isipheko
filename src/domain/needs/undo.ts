import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The fifteen seconds after a claim in which the person who made it can take it
 * back.
 *
 * **Undo is not withdrawal.** Withdrawal is the organiser releasing something
 * back to the board, and it has no window. This is the contributor's "I
 * misclicked", and it belongs to them for fifteen seconds. Collapsing the two
 * would let a contributor release a claim a week later, which is not theirs to
 * do.
 *
 * A contributor has no account and never will (CLAUDE.md rule 4), so the right
 * to undo is a **capability**, not an identity: a token the server issued,
 * returned by the browser, and verifiable without looking anything up.
 */

export const UNDO_WINDOW_MS = 15_000

/**
 * The token is an HMAC of the claim id under a server-held pepper.
 *
 * Stateless on purpose — no column, no row to clean up, and nothing to leak in
 * a database dump beyond an id that is already there. The window is what limits
 * it: a token that never expires is harmless when the thing it authorises stops
 * being possible after fifteen seconds.
 */
export function undoToken(claimId: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`claim-undo:${claimId}`).digest('base64url')
}

/** Constant-time. A fast reject on a capability is an oracle. */
export function undoTokenMatches(
  claimId: string,
  pepper: string,
  presented: string,
): boolean {
  const expected = Buffer.from(undoToken(claimId, pepper), 'utf8')
  const actual = Buffer.from(presented, 'utf8')

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function isWithinUndoWindow(claimedAt: Date, now: Date): boolean {
  const elapsed = now.getTime() - claimedAt.getTime()
  return elapsed >= 0 && elapsed <= UNDO_WINDOW_MS
}

/** Seconds left, for the countdown. Never negative, never above the window. */
export function undoSecondsRemaining(claimedAt: Date, now: Date): number {
  const remaining = UNDO_WINDOW_MS - (now.getTime() - claimedAt.getTime())
  return Math.max(0, Math.ceil(remaining / 1000))
}

/**
 * `<claimId>.<token>` — what the cookie carries.
 *
 * The claim id may appear in a URL; the token must not. A URL leaks through
 * `Referer`, through browser history, and through a screenshot on a borrowed
 * phone, and borrowed phones are an explicit part of who uses this.
 */
export function formatClaimTicket(claimId: string, token: string): string {
  return `${claimId}.${token}`
}

export function parseClaimTicket(
  ticket: string,
): { readonly claimId: string; readonly token: string } | null {
  const separator = ticket.indexOf('.')
  if (separator <= 0) return null

  const claimId = ticket.slice(0, separator)
  const token = ticket.slice(separator + 1)

  if (claimId === '' || token === '') return null

  return { claimId, token }
}
