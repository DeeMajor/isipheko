import {
  hashOtpCode,
  hashSessionToken,
  otpExpiresAt,
  rateLimitWindowStart,
  sessionExpiresAt,
  type OtpRequestCounts,
} from '@/domain/auth'

import type { PrismaClient } from '@/db/generated/client'

/**
 * Persistence for one-time codes and sessions.
 *
 * Every function takes the client rather than importing it, so integration
 * tests can hand in a connection bound to a specific role and prove what the
 * application role can and cannot do.
 *
 * The domain decides the rules; this only stores and counts. Nothing here reads
 * a clock either — `now` is passed in, so an expiry test does not take ten
 * minutes.
 */

export async function countRecentOtpRequests(
  db: PrismaClient,
  { phoneE164, ipHash, now }: { phoneE164: string; ipHash: string | null; now: Date },
): Promise<OtpRequestCounts> {
  const since = rateLimitWindowStart(now)

  const [forNumber, forIp] = await Promise.all([
    db.otpChallenge.findMany({
      where: { phoneE164, createdAt: { gt: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    ipHash === null
      ? Promise.resolve([])
      : db.otpChallenge.findMany({
          where: { requestedIpHash: ipHash, createdAt: { gt: since } },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
  ])

  return {
    forNumber: forNumber.map((row) => row.createdAt),
    forIp: forIp.map((row) => row.createdAt),
  }
}

/**
 * Stores the HMAC. The `code` argument is the last point in the system that
 * holds the plaintext — it goes to the SMS sender and nowhere else.
 */
export async function createOtpChallenge(
  db: PrismaClient,
  {
    phoneE164,
    code,
    pepper,
    ipHash,
    now,
  }: {
    phoneE164: string
    code: string
    pepper: string
    ipHash: string | null
    now: Date
  },
): Promise<{ id: string }> {
  const challenge = await db.otpChallenge.create({
    data: {
      phoneE164,
      codeHash: hashOtpCode(code, pepper),
      expiresAt: otpExpiresAt(now),
      requestedIpHash: ipHash,
    },
    select: { id: true },
  })

  return challenge
}

export interface StoredChallenge {
  id: string
  codeHash: string
  expiresAt: Date
  attempts: number
  consumedAt: Date | null
}

/**
 * The newest unconsumed challenge for a number.
 *
 * Newest rather than "any that matches": asking for a second code should
 * invalidate the first in practice, and checking only the latest means an old
 * SMS still lying in an inbox is not a working key.
 */
export async function latestOtpChallenge(
  db: PrismaClient,
  phoneE164: string,
): Promise<StoredChallenge | null> {
  return db.otpChallenge.findFirst({
    where: { phoneE164, consumedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      codeHash: true,
      expiresAt: true,
      attempts: true,
      consumedAt: true,
    },
  })
}

export async function recordFailedAttempt(db: PrismaClient, id: string): Promise<void> {
  await db.otpChallenge.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  })
}

/**
 * Consumes the challenge and returns whether this call was the one that did it.
 *
 * The `consumedAt: null` in the filter is the point: two requests arriving with
 * the same valid code race, and exactly one of them updates a row. The loser
 * gets a count of zero and is treated as a failed attempt.
 */
export async function consumeOtpChallenge(
  db: PrismaClient,
  id: string,
  now: Date,
): Promise<boolean> {
  const { count } = await db.otpChallenge.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: now },
  })

  return count === 1
}

/**
 * The organiser record is created here, on first successful verification —
 * which is the first moment we know the number belongs to somebody. The
 * display name arrives at setup (M1-07); asking for it at sign-in would mean
 * asking only for numbers we do not recognise.
 */
export async function organiserForPhone(
  db: PrismaClient,
  phoneE164: string,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await db.organiser.findUnique({
    where: { phoneE164 },
    select: { id: true },
  })

  if (existing !== null) return { id: existing.id, isNew: false }

  const created = await db.organiser.create({
    data: { phoneE164 },
    select: { id: true },
  })

  return { id: created.id, isNew: true }
}

export async function createSession(
  db: PrismaClient,
  {
    organiserId,
    token,
    ipHash,
    userAgentHash,
    now,
  }: {
    organiserId: string
    token: string
    ipHash: string | null
    userAgentHash: string | null
    now: Date
  },
): Promise<{ id: string }> {
  return db.session.create({
    data: {
      organiserId,
      tokenHash: hashSessionToken(token),
      expiresAt: sessionExpiresAt(now),
      authenticatedAt: now,
      lastSeenAt: now,
      createdIpHash: ipHash,
      userAgentHash,
    },
    select: { id: true },
  })
}

export interface StoredSession {
  id: string
  organiserId: string
  expiresAt: Date
  revokedAt: Date | null
  authenticatedAt: Date
}

/** Looks up by hash. The cookie value itself is never stored to compare against. */
export async function sessionForToken(
  db: PrismaClient,
  token: string,
): Promise<StoredSession | null> {
  return db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      organiserId: true,
      expiresAt: true,
      revokedAt: true,
      authenticatedAt: true,
    },
  })
}

export async function touchSession(
  db: PrismaClient,
  id: string,
  now: Date,
): Promise<void> {
  await db.session.update({ where: { id }, data: { lastSeenAt: now } })
}

export async function revokeSession(
  db: PrismaClient,
  id: string,
  now: Date,
): Promise<void> {
  await db.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now },
  })
}

/** For a lost or stolen phone: every session, including this one. */
export async function revokeAllSessions(
  db: PrismaClient,
  organiserId: string,
  now: Date,
): Promise<number> {
  const { count } = await db.session.updateMany({
    where: { organiserId, revokedAt: null },
    data: { revokedAt: now },
  })

  return count
}
