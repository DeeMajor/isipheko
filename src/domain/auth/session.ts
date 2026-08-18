import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Sessions, and why they are rows rather than tokens.
 *
 * Architecture §10 requires payout approval to re-authenticate regardless of
 * session age, and a stolen phone needs "sign out everywhere". Neither is
 * possible against a signed token that cannot be withdrawn before it expires.
 * See docs/decisions.md M1-06 — this is a deliberate deviation from the stack
 * table, and not something to "correct" back to a JWT.
 */

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * `__Host-` is not decoration. It makes the browser refuse the cookie unless it
 * is `Secure`, path `/`, and has no `Domain` — which means a subdomain, or
 * anything that got itself served over http, cannot set a session cookie for
 * the site.
 *
 * The one place it costs us is local development over http, where the prefix
 * requires `Secure` and the browser then refuses it. `sessionCookieOptions`
 * takes `secure` for exactly that reason and the name changes with it.
 */
export const SESSION_COOKIE_SECURE = '__Host-isipheko_session'
export const SESSION_COOKIE_INSECURE = 'isipheko_session_dev'

/** The number being verified, held between the two steps of sign-in. */
export const PENDING_COOKIE_SECURE = '__Host-isipheko_pending'
export const PENDING_COOKIE_INSECURE = 'isipheko_pending_dev'

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_INSECURE
}

export function pendingCookieName(secure: boolean): string {
  return secure ? PENDING_COOKIE_SECURE : PENDING_COOKIE_INSECURE
}

export interface SessionCookieOptions {
  readonly httpOnly: true
  readonly sameSite: 'lax'
  readonly path: '/'
  readonly secure: boolean
  readonly maxAge: number
}

/**
 * `httpOnly` so script cannot read it, `sameSite: 'lax'` so it does not ride
 * along on a cross-site POST — which is the CSRF defence for the sign-out and
 * sign-in actions, since they are state-changing and take no other token yet.
 */
export function sessionCookieOptions(
  secure: boolean,
  maxAgeMs: number,
): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

/**
 * 32 bytes from the CSPRNG — 256 bits, unguessable, and not derived from
 * anything about the person.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * SHA-256, no pepper, unlike the OTP: a 256-bit random token has no small space
 * to precompute, so a peppered HMAC would add key management for nothing. What
 * matters is that the database holds the hash, so a dump yields no usable
 * cookie.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sessionTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSessionToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function sessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS)
}

/** Not the Prisma row — the domain does not import Prisma types (rule 6). */
export interface SessionState {
  readonly expiresAt: Date
  readonly revokedAt: Date | null
}

export type SessionStatus = 'active' | 'expired' | 'revoked'

export function sessionStatus(session: SessionState, now: Date): SessionStatus {
  if (session.revokedAt !== null) return 'revoked'
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'active'
}
