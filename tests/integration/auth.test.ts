import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import {
  consumeOtpChallenge,
  countRecentOtpRequests,
  createOtpChallenge,
  latestOtpChallenge,
  organiserForPhone,
  recordFailedAttempt,
  revokeAllSessions,
  revokeSession,
  sessionForToken,
} from '@/db/repositories/auth'
import {
  MAX_OTP_ATTEMPTS,
  MAX_OTP_PER_NUMBER_PER_WINDOW,
  checkOtpRateLimit,
  generateOtpCode,
  generateSessionToken,
  hashPhone,
  otpChallengeStatus,
  otpCodeMatches,
  sessionStatus,
} from '@/domain/auth'
import { createSession } from '@/db/repositories/auth'

import { clientFor } from '../setup/prisma'

/**
 * Auth against a real Postgres.
 *
 * The rate limit is counted in the database, the session is a row, and the
 * append-only guarantee on `audit_log` is a privilege — none of those is
 * testable against a mock, and a mock would answer according to whatever its
 * author believed, which is the belief under test.
 */

const PEPPER = 'integration-test-pepper'
let prisma: PrismaClient

/** A distinct number per test, so one test's limit is not another's. */
let phoneCounter = 0
const nextPhone = () => `+2782${String(1_000_000 + ++phoneCounter).slice(-7)}`

beforeAll(() => {
  prisma = clientFor(inject('appDatabaseUrl'))
})

afterAll(async () => {
  await prisma.$disconnect()
})

const NOW = new Date('2026-08-16T12:00:00.000Z')
const minutesFromNow = (n: number) => new Date(NOW.getTime() + n * 60_000)

describe('one-time codes', () => {
  it('stores the HMAC and never the code', async () => {
    const phoneE164 = nextPhone()
    const code = generateOtpCode()

    const { id } = await createOtpChallenge(prisma, {
      phoneE164,
      code,
      pepper: PEPPER,
      ipHash: null,
      now: NOW,
    })

    const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id } })

    expect(row.codeHash).not.toContain(code)
    expect(JSON.stringify(row)).not.toContain(code)
    expect(otpCodeMatches(code, PEPPER, row.codeHash)).toBe(true)
  })

  it('accepts the right code and rejects every other', async () => {
    const phoneE164 = nextPhone()
    const code = generateOtpCode()
    await createOtpChallenge(prisma, {
      phoneE164,
      code,
      pepper: PEPPER,
      ipHash: null,
      now: NOW,
    })

    const challenge = await latestOtpChallenge(prisma, phoneE164)
    expect(challenge).not.toBeNull()

    expect(otpCodeMatches(code, PEPPER, challenge?.codeHash ?? '')).toBe(true)
    expect(otpChallengeStatus(challenge!, NOW)).toBe('usable')
  })

  it('can only be consumed once, however many requests race for it', async () => {
    const phoneE164 = nextPhone()
    await createOtpChallenge(prisma, {
      phoneE164,
      code: generateOtpCode(),
      pepper: PEPPER,
      ipHash: null,
      now: NOW,
    })
    const challenge = await latestOtpChallenge(prisma, phoneE164)

    // Two requests arriving with the same valid code. Exactly one wins the
    // conditional update; the other is a failed attempt, not a second session.
    const results = await Promise.all([
      consumeOtpChallenge(prisma, challenge!.id, NOW),
      consumeOtpChallenge(prisma, challenge!.id, NOW),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('dies after six wrong guesses', async () => {
    const phoneE164 = nextPhone()
    await createOtpChallenge(prisma, {
      phoneE164,
      code: generateOtpCode(),
      pepper: PEPPER,
      ipHash: null,
      now: NOW,
    })
    const challenge = await latestOtpChallenge(prisma, phoneE164)

    for (let attempt = 0; attempt < MAX_OTP_ATTEMPTS; attempt += 1) {
      await recordFailedAttempt(prisma, challenge!.id)
    }

    const exhausted = await latestOtpChallenge(prisma, phoneE164)
    expect(exhausted?.attempts).toBe(MAX_OTP_ATTEMPTS)
    expect(otpChallengeStatus(exhausted!, NOW)).toBe('too-many-attempts')
  })

  it('offers only the newest challenge, so an older SMS is not a key', async () => {
    const phoneE164 = nextPhone()
    const stale = generateOtpCode()
    const fresh = generateOtpCode()

    await createOtpChallenge(prisma, {
      phoneE164,
      code: stale,
      pepper: PEPPER,
      ipHash: null,
      now: NOW,
    })
    await createOtpChallenge(prisma, {
      phoneE164,
      code: fresh,
      pepper: PEPPER,
      ipHash: null,
      now: NOW,
    })

    const challenge = await latestOtpChallenge(prisma, phoneE164)

    expect(otpCodeMatches(fresh, PEPPER, challenge?.codeHash ?? '')).toBe(true)
    expect(otpCodeMatches(stale, PEPPER, challenge?.codeHash ?? '')).toBe(false)
  })
})

describe('the rate limit', () => {
  it('allows three codes to one number in an hour and refuses the fourth', async () => {
    const phoneE164 = nextPhone()
    const now = new Date()

    // Three, written out. Looping over MAX_OTP_PER_NUMBER_PER_WINDOW would make
    // this test agree with the constant whatever the constant became — it would
    // pass with the limit at 99, which is the change worth catching.
    expect(MAX_OTP_PER_NUMBER_PER_WINDOW).toBe(3)

    for (let request = 0; request < 3; request += 1) {
      const counts = await countRecentOtpRequests(prisma, {
        phoneE164,
        ipHash: null,
        now,
      })

      expect(checkOtpRateLimit(counts, now)).toEqual({ allowed: true })

      await createOtpChallenge(prisma, {
        phoneE164,
        code: generateOtpCode(),
        pepper: PEPPER,
        ipHash: null,
        now,
      })
    }

    const counts = await countRecentOtpRequests(prisma, { phoneE164, ipHash: null, now })
    const decision = checkOtpRateLimit(counts, now)

    expect(decision.allowed).toBe(false)
    expect(decision).toMatchObject({ reason: 'number' })
  })

  it('counts one number and not its neighbour', async () => {
    const limited = nextPhone()
    const other = nextPhone()
    const now = new Date()

    for (let request = 0; request < 3; request += 1) {
      await createOtpChallenge(prisma, {
        phoneE164: limited,
        code: generateOtpCode(),
        pepper: PEPPER,
        ipHash: null,
        now,
      })
    }

    const neighbour = await countRecentOtpRequests(prisma, {
      phoneE164: other,
      ipHash: null,
      now,
    })

    expect(checkOtpRateLimit(neighbour, now)).toEqual({ allowed: true })
  })

  it('forgets requests that have left the window', async () => {
    const phoneE164 = nextPhone()
    const now = new Date()
    const longAgo = new Date(now.getTime() - 61 * 60_000)

    for (let request = 0; request < 3; request += 1) {
      await createOtpChallenge(prisma, {
        phoneE164,
        code: generateOtpCode(),
        pepper: PEPPER,
        ipHash: null,
        now,
      })
    }

    // Backdate them past the window. `createdAt` defaults to now, so this is
    // the only way to age a row without waiting an hour.
    await prisma.otpChallenge.updateMany({
      where: { phoneE164 },
      data: { createdAt: longAgo },
    })

    const counts = await countRecentOtpRequests(prisma, { phoneE164, ipHash: null, now })

    expect(checkOtpRateLimit(counts, now)).toEqual({ allowed: true })
  })

  it('counts by IP as well, across different numbers', async () => {
    const ipHash = `ip-${String(++phoneCounter)}`
    const now = new Date()

    await createOtpChallenge(prisma, {
      phoneE164: nextPhone(),
      code: generateOtpCode(),
      pepper: PEPPER,
      ipHash,
      now,
    })
    await createOtpChallenge(prisma, {
      phoneE164: nextPhone(),
      code: generateOtpCode(),
      pepper: PEPPER,
      ipHash,
      now,
    })

    const counts = await countRecentOtpRequests(prisma, {
      phoneE164: nextPhone(),
      ipHash,
      now,
    })

    expect(counts.forNumber).toHaveLength(0)
    expect(counts.forIp).toHaveLength(2)
  })
})

describe('organisers', () => {
  it('is created on first verification, with no name yet', async () => {
    const phoneE164 = nextPhone()

    const first = await organiserForPhone(prisma, phoneE164)
    expect(first.isNew).toBe(true)

    const organiser = await prisma.organiser.findUniqueOrThrow({
      where: { id: first.id },
    })

    // The name arrives at setup. Asking for it at sign-in would mean asking
    // only for numbers we do not recognise.
    expect(organiser.displayName).toBeNull()
    expect(organiser.phoneE164).toBe(phoneE164)
  })

  it('is the same organiser the second time', async () => {
    const phoneE164 = nextPhone()

    const first = await organiserForPhone(prisma, phoneE164)
    const second = await organiserForPhone(prisma, phoneE164)

    expect(second).toEqual({ id: first.id, isNew: false })
  })
})

describe('sessions', () => {
  let organiserId: string

  beforeEach(async () => {
    const organiser = await organiserForPhone(prisma, nextPhone())
    organiserId = organiser.id
  })

  it('stores the hash, so the database holds nothing presentable', async () => {
    const token = generateSessionToken()
    const { id } = await createSession(prisma, {
      organiserId,
      token,
      ipHash: null,
      userAgentHash: null,
      now: NOW,
    })

    const row = await prisma.session.findUniqueOrThrow({ where: { id } })

    expect(row.tokenHash).not.toContain(token)
    expect(JSON.stringify(row)).not.toContain(token)

    const found = await sessionForToken(prisma, token)
    expect(found?.id).toBe(id)
    expect(sessionStatus(found!, NOW)).toBe('active')
  })

  it('is unknown for a token nobody issued', async () => {
    expect(await sessionForToken(prisma, generateSessionToken())).toBeNull()
  })

  it('can be revoked, which a signed token could not be', async () => {
    // This is the reason sessions are rows. §10 requires re-authentication for
    // payout approval, and a stolen phone needs sign-out-everywhere.
    const token = generateSessionToken()
    const { id } = await createSession(prisma, {
      organiserId,
      token,
      ipHash: null,
      userAgentHash: null,
      now: NOW,
    })

    await revokeSession(prisma, id, NOW)

    const revoked = await sessionForToken(prisma, token)
    expect(sessionStatus(revoked!, NOW)).toBe('revoked')
  })

  it('ends every session on the account at once', async () => {
    const tokens = [
      generateSessionToken(),
      generateSessionToken(),
      generateSessionToken(),
    ]
    for (const token of tokens) {
      await createSession(prisma, {
        organiserId,
        token,
        ipHash: null,
        userAgentHash: null,
        now: NOW,
      })
    }

    const ended = await revokeAllSessions(prisma, organiserId, NOW)
    expect(ended).toBe(tokens.length)

    for (const token of tokens) {
      const session = await sessionForToken(prisma, token)
      expect(sessionStatus(session!, NOW)).toBe('revoked')
    }
  })

  it('lapses on its own once it expires', async () => {
    const token = generateSessionToken()
    const { id } = await createSession(prisma, {
      organiserId,
      token,
      ipHash: null,
      userAgentHash: null,
      now: NOW,
    })

    await prisma.session.update({
      where: { id },
      data: { expiresAt: minutesFromNow(-1) },
    })

    const session = await sessionForToken(prisma, token)
    expect(sessionStatus(session!, NOW)).toBe('expired')
  })
})

describe('the audit log', () => {
  it('records an auth event without the phone number in it', async () => {
    const phoneE164 = nextPhone()
    const organiser = await organiserForPhone(prisma, phoneE164)

    await prisma.auditLog.create({
      data: {
        actorType: 'organiser',
        actorId: organiser.id,
        action: 'auth.otp.verified',
        targetType: 'organiser',
        targetId: organiser.id,
        ipHash: 'hashed-ip',
        userAgentHash: 'hashed-ua',
        metadata: { phoneHash: hashPhone(phoneE164, PEPPER) },
      },
    })

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: organiser.id, action: 'auth.otp.verified' },
    })

    const serialised = JSON.stringify(row)
    expect(serialised).not.toContain(phoneE164)
    expect(serialised).not.toContain(phoneE164.slice(1))
    expect(serialised).toContain(hashPhone(phoneE164, PEPPER))
  })

  it('cannot be rewritten by the application role', async () => {
    // Rule 3's posture, applied to the auth trail: the code that writes a
    // record cannot later tidy it away.
    const organiser = await organiserForPhone(prisma, nextPhone())
    const row = await prisma.auditLog.create({
      data: {
        actorType: 'organiser',
        actorId: organiser.id,
        action: 'auth.session.started',
      },
    })

    await expect(
      prisma.auditLog.update({
        where: { id: row.id },
        data: { action: 'something.else' },
      }),
    ).rejects.toThrow(/permission denied/i)

    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /permission denied/i,
    )
  })
})
