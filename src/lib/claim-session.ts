import {
  formatClaimTicket,
  parseClaimTicket,
  undoToken,
  undoTokenMatches,
} from '@/domain/needs'
import { env } from '@/lib/env'

/**
 * The cookie that says "this browser made that claim".
 *
 * A contributor has no account (CLAUDE.md rule 4), so the right to undo is a
 * capability rather than an identity — and it travels in an `HttpOnly` cookie
 * rather than in the URL. A URL leaks through `Referer`, through history, and
 * through a screenshot on a borrowed phone, which is an explicit part of who
 * uses this product.
 *
 * The item id may appear in a query string. It is not a secret: anybody holding
 * the event link can claim, and the link is the capability. The undo token is a
 * different thing and never leaves this cookie.
 */

const SECURE = env.NODE_ENV === 'production'

/** `__Host-` requires Secure, which http development cannot have (M1-06 §…). */
export const CLAIM_COOKIE = SECURE ? '__Host-isipheko_claim' : 'isipheko_claim_dev'

/**
 * Slightly longer than the 15-second window, so the window is what expires the
 * capability rather than a clock skew between the browser and the server.
 */
export const CLAIM_COOKIE_MAX_AGE_SECONDS = 60

export function claimCookieValue(claimId: string): string {
  return formatClaimTicket(claimId, undoToken(claimId, env.OTP_PEPPER))
}

export const claimCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: SECURE,
  maxAge: CLAIM_COOKIE_MAX_AGE_SECONDS,
} as const

/**
 * The claim this browser is entitled to undo, if any.
 *
 * Returns null for a missing, malformed or forged cookie alike — the caller has
 * no reason to tell them apart, and a message that did would tell somebody
 * probing which of the three they had managed.
 */
export function claimFromCookie(cookieValue: string | undefined): string | null {
  if (cookieValue === undefined || cookieValue === '') return null

  const ticket = parseClaimTicket(cookieValue)
  if (ticket === null) return null

  return undoTokenMatches(ticket.claimId, env.OTP_PEPPER, ticket.token)
    ? ticket.claimId
    : null
}
