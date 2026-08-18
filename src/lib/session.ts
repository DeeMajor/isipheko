import { cookies } from 'next/headers'

import { prisma } from '@/db/client'
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  sessionForToken,
  touchSession,
} from '@/db/repositories/auth'
import {
  SESSION_TTL_MS,
  generateSessionToken,
  pendingCookieName,
  sessionCookieName,
  sessionCookieOptions,
  sessionStatus,
} from '@/domain/auth'
import { env } from '@/lib/env'

/**
 * The session cookie, and the organiser behind it.
 *
 * The cookie holds 32 random bytes; the database holds their SHA-256. A dump of
 * `sessions` therefore yields nothing anybody can present. Revocation is a
 * column, which is the whole reason this is a table and not a JWT — see
 * docs/decisions.md M1-06.
 */

/**
 * `__Host-` requires `Secure`, and `Secure` cookies are refused over plain
 * http, which is how local development is served. So the prefix and the flag
 * move together and the name changes with them — a dev cookie cannot be
 * mistaken for a production one.
 */
const secureCookies = env.NODE_ENV === 'production'

export const OTP_PENDING_TTL_MS = 15 * 60 * 1000

export async function startSession(
  organiserId: string,
  { ipHash, userAgentHash }: { ipHash: string | null; userAgentHash: string | null },
  now: Date = new Date(),
): Promise<void> {
  const token = generateSessionToken()

  await createSession(prisma, { organiserId, token, ipHash, userAgentHash, now })

  const jar = await cookies()
  jar.set(sessionCookieName(secureCookies), token, {
    ...sessionCookieOptions(secureCookies, SESSION_TTL_MS),
  })
}

export interface CurrentSession {
  readonly sessionId: string
  readonly organiserId: string
  readonly authenticatedAt: Date
}

/**
 * Returns null for absent, unknown, expired and revoked alike. The caller has
 * no reason to distinguish them, and a message that did would tell somebody
 * holding a stale cookie which of the four they are holding.
 */
export async function currentSession(
  now: Date = new Date(),
): Promise<CurrentSession | null> {
  const jar = await cookies()
  const token = jar.get(sessionCookieName(secureCookies))?.value
  if (token === undefined || token === '') return null

  const session = await sessionForToken(prisma, token)
  if (session === null) return null

  if (sessionStatus(session, now) !== 'active') return null

  await touchSession(prisma, session.id, now)

  return {
    sessionId: session.id,
    organiserId: session.organiserId,
    authenticatedAt: session.authenticatedAt,
  }
}

export async function endSession(now: Date = new Date()): Promise<string | null> {
  const session = await currentSession(now)
  const jar = await cookies()

  jar.delete(sessionCookieName(secureCookies))
  if (session === null) return null

  await revokeSession(prisma, session.sessionId, now)
  return session.organiserId
}

/** For a lost or stolen phone. Ends this session too — that is the point. */
export async function endAllSessions(
  organiserId: string,
  now: Date = new Date(),
): Promise<number> {
  const ended = await revokeAllSessions(prisma, organiserId, now)

  const jar = await cookies()
  jar.delete(sessionCookieName(secureCookies))

  return ended
}

/**
 * The number being verified, held between the two steps of sign-in.
 *
 * In a cookie rather than the URL: a phone number in a query string is a phone
 * number in the access log, in the `Referer` header of anything the page loads,
 * and in the browser history of a borrowed device. It is `httpOnly`, so the
 * step-two form cannot be pointed at somebody else's number by editing the DOM.
 */
export async function setPendingPhone(phoneE164: string): Promise<void> {
  const jar = await cookies()
  jar.set(pendingCookieName(secureCookies), phoneE164, {
    ...sessionCookieOptions(secureCookies, OTP_PENDING_TTL_MS),
  })
}

export async function pendingPhone(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(pendingCookieName(secureCookies))?.value ?? null
}

export async function clearPendingPhone(): Promise<void> {
  const jar = await cookies()
  jar.delete(pendingCookieName(secureCookies))
}
