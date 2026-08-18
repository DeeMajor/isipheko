import { describe, expect, it } from 'vitest'

import {
  MAX_OTP_ATTEMPTS,
  MAX_OTP_PER_IP_PER_WINDOW,
  MAX_OTP_PER_NUMBER_PER_WINDOW,
  OTP_LENGTH,
  OTP_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  SESSION_TTL_MS,
  checkOtpRateLimit,
  generateOtpCode,
  generateSessionToken,
  hashOtpCode,
  hashPhone,
  hashSessionToken,
  normalisePhone,
  otpChallengeStatus,
  otpCodeMatches,
  otpExpiresAt,
  phoneHashMatches,
  sessionCookieName,
  sessionCookieOptions,
  sessionExpiresAt,
  sessionStatus,
  sessionTokenMatches,
} from '@/domain/auth'

const PEPPER = 'test-pepper-not-the-real-one'
const NOW = new Date('2026-08-16T12:00:00.000Z')
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000)

describe('phone normalisation', () => {
  it.each([
    ['0821234567', '+27821234567'],
    ['082 123 4567', '+27821234567'],
    ['082-123-4567', '+27821234567'],
    ['(082) 123 4567', '+27821234567'],
    ['+27821234567', '+27821234567'],
    ['+27 82 123 4567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['  0821234567  ', '+27821234567'],
  ])('reads %o as %s', (input, expected) => {
    // One number has to produce one identity however it was typed. If it does
    // not, the rate limit counts a space as a different person.
    expect(normalisePhone(input)).toEqual({ ok: true, value: expected })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['not a phone', 'not-a-number'],
    ['082123456a', 'not-a-number'],
    ['08212345', 'not-south-african'],
    ['08212345678', 'not-south-african'],
    ['+447700900000', 'not-south-african'],
    ['+27021234567', 'not-south-african'],
  ])('rejects %o as %s', (input, reason) => {
    expect(normalisePhone(input)).toEqual({ ok: false, reason })
  })

  it('hashes for the audit log, and the hash is not the number', () => {
    const hash = hashPhone('+27821234567', PEPPER)

    expect(hash).not.toContain('27821234567')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(phoneHashMatches('+27821234567', PEPPER, hash)).toBe(true)
    expect(phoneHashMatches('+27821234568', PEPPER, hash)).toBe(false)
  })

  it('produces a different hash under a different pepper', () => {
    // The pepper is what makes a stolen hash useless: ~10^9 South African
    // mobile numbers is an afternoon's precomputation without one.
    expect(hashPhone('+27821234567', PEPPER)).not.toBe(
      hashPhone('+27821234567', 'another-pepper'),
    )
  })
})

describe('one-time codes', () => {
  it('is always six digits, including when it starts with zeros', () => {
    for (let i = 0; i < 2_000; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/)
    }
  })

  it('uses the whole space, with leading zeros intact', () => {
    // `randomBytes % 1000000` is biased and `String(n)` drops leading zeros —
    // either bug shrinks the space without looking like it has.
    const codes = new Set(Array.from({ length: 5_000 }, generateOtpCode))

    expect(codes.size).toBeGreaterThan(4_500)
    expect([...codes].some((code) => code.startsWith('0'))).toBe(true)
  })

  it('stores an HMAC, never the code', () => {
    const hash = hashOtpCode('123456', PEPPER)

    expect(hash).not.toContain('123456')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches only the right code, and only under the right pepper', () => {
    const hash = hashOtpCode('123456', PEPPER)

    expect(otpCodeMatches('123456', PEPPER, hash)).toBe(true)
    expect(otpCodeMatches('123457', PEPPER, hash)).toBe(false)
    expect(otpCodeMatches('123456', 'other-pepper', hash)).toBe(false)
  })

  it('survives a malformed stored hash without throwing', () => {
    // timingSafeEqual throws on a length mismatch. A corrupt row must be a
    // failed match, not a 500 on the sign-in page.
    expect(otpCodeMatches('123456', PEPPER, 'not-a-hash')).toBe(false)
    expect(otpCodeMatches('123456', PEPPER, '')).toBe(false)
  })

  it('expires ten minutes out', () => {
    expect(otpExpiresAt(NOW)).toEqual(minutes(10))
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000)
    expect(OTP_LENGTH).toBe(6)
  })

  describe('challenge status', () => {
    const usable = { expiresAt: minutes(10), attempts: 0, consumedAt: null }

    it('is usable while it is fresh, unused and unexhausted', () => {
      expect(otpChallengeStatus(usable, NOW)).toBe('usable')
    })

    it('expires exactly at its expiry, not a moment after', () => {
      expect(otpChallengeStatus({ ...usable, expiresAt: NOW }, NOW)).toBe('expired')
      expect(otpChallengeStatus({ ...usable, expiresAt: minutes(-1) }, NOW)).toBe(
        'expired',
      )
    })

    it('is dead after six wrong guesses', () => {
      // Six digits with unlimited guesses is a walk, not an attack.
      expect(otpChallengeStatus({ ...usable, attempts: MAX_OTP_ATTEMPTS - 1 }, NOW)).toBe(
        'usable',
      )
      expect(otpChallengeStatus({ ...usable, attempts: MAX_OTP_ATTEMPTS }, NOW)).toBe(
        'too-many-attempts',
      )
    })

    it('cannot be used twice', () => {
      expect(otpChallengeStatus({ ...usable, consumedAt: NOW }, NOW)).toBe('already-used')
    })

    it('reports already-used ahead of anything else', () => {
      // A consumed code that is also expired and exhausted is still, first and
      // foremost, spent.
      expect(
        otpChallengeStatus(
          { expiresAt: minutes(-30), attempts: 99, consumedAt: minutes(-5) },
          NOW,
        ),
      ).toBe('already-used')
    })
  })
})

describe('rate limiting', () => {
  const times = (count: number, minutesAgo: number) =>
    Array.from({ length: count }, () => new Date(NOW.getTime() - minutesAgo * 60_000))

  it('allows three codes to one number in an hour', () => {
    expect(MAX_OTP_PER_NUMBER_PER_WINDOW).toBe(3)
    expect(RATE_LIMIT_WINDOW_MS).toBe(60 * 60 * 1000)

    expect(checkOtpRateLimit({ forNumber: times(2, 10), forIp: [] }, NOW)).toEqual({
      allowed: true,
    })
  })

  it('refuses the fourth', () => {
    const decision = checkOtpRateLimit({ forNumber: times(3, 10), forIp: [] }, NOW)

    expect(decision.allowed).toBe(false)
    expect(decision).toMatchObject({ reason: 'number' })
  })

  it('says when the limit lifts, counted from the oldest request', () => {
    const decision = checkOtpRateLimit(
      { forNumber: [minutes(-50), minutes(-20), minutes(-5)], forIp: [] },
      NOW,
    )

    // The oldest was 50 minutes ago, so the window frees in 10.
    expect(decision).toEqual({
      allowed: false,
      reason: 'number',
      retryAfterSeconds: 10 * 60,
    })
  })

  it('forgets requests older than the window', () => {
    expect(checkOtpRateLimit({ forNumber: times(3, 61), forIp: [] }, NOW)).toEqual({
      allowed: true,
    })
  })

  it('limits the requester as well as the number', () => {
    // One phone per attacker is not the threat model: enumerating numbers costs
    // nothing if only the number is counted.
    const decision = checkOtpRateLimit(
      { forNumber: [], forIp: times(MAX_OTP_PER_IP_PER_WINDOW, 5) },
      NOW,
    )

    expect(decision).toMatchObject({ allowed: false, reason: 'ip' })
  })

  it('leaves room for a household behind one address', () => {
    // A taxi rank, an office or a family on one NAT must not lock each other
    // out, so the IP limit is well above the per-number one.
    expect(MAX_OTP_PER_IP_PER_WINDOW).toBeGreaterThan(MAX_OTP_PER_NUMBER_PER_WINDOW * 3)
  })

  it('names the number limit first when both are hit', () => {
    const decision = checkOtpRateLimit(
      { forNumber: times(3, 5), forIp: times(MAX_OTP_PER_IP_PER_WINDOW, 5) },
      NOW,
    )

    expect(decision).toMatchObject({ reason: 'number' })
  })
})

describe('sessions', () => {
  it('mints 256 bits of randomness, never repeated', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, generateSessionToken))

    expect(tokens.size).toBe(1_000)
    for (const token of tokens) {
      expect(Buffer.from(token, 'base64url').byteLength).toBe(32)
    }
  })

  it('stores a hash, so a database dump yields no usable cookie', () => {
    const token = generateSessionToken()
    const hash = hashSessionToken(token)

    expect(hash).not.toContain(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(sessionTokenMatches(token, hash)).toBe(true)
    expect(sessionTokenMatches(generateSessionToken(), hash)).toBe(false)
  })

  it('expires in thirty days', () => {
    expect(sessionExpiresAt(NOW)).toEqual(new Date(NOW.getTime() + SESSION_TTL_MS))
  })

  it.each([
    ['active', { expiresAt: minutes(10), revokedAt: null }, 'active'],
    ['expired', { expiresAt: minutes(-1), revokedAt: null }, 'expired'],
    ['revoked', { expiresAt: minutes(10), revokedAt: minutes(-1) }, 'revoked'],
  ])('reads a %s session correctly', (_name, session, expected) => {
    expect(sessionStatus(session, NOW)).toBe(expected)
  })

  it('reports revoked ahead of expired', () => {
    // "Sign out everywhere" has to be visible as itself in the audit trail,
    // even once the session would have lapsed anyway.
    expect(sessionStatus({ expiresAt: minutes(-10), revokedAt: minutes(-20) }, NOW)).toBe(
      'revoked',
    )
  })

  it('is httpOnly, lax and path-scoped', () => {
    const options = sessionCookieOptions(true, SESSION_TTL_MS)

    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('lax')
    expect(options.path).toBe('/')
    expect(options.secure).toBe(true)
    expect(options.maxAge).toBe(SESSION_TTL_MS / 1000)
  })

  it('only wears the __Host- prefix when it is also Secure', () => {
    // The browser refuses a __Host- cookie that is not Secure, and refuses a
    // Secure cookie over http — so the prefix and the flag move together, and
    // a development cookie cannot be mistaken for a production one.
    expect(sessionCookieName(true)).toBe('__Host-isipheko_session')
    expect(sessionCookieName(true).startsWith('__Host-')).toBe(true)
    expect(sessionCookieName(false).startsWith('__Host-')).toBe(false)
    expect(sessionCookieOptions(false, SESSION_TTL_MS).secure).toBe(false)
  })
})
