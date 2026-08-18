import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * One-time codes: how they are made, how they are stored, when they die.
 *
 * Pure. The pepper and the current time are arguments — nothing here reads an
 * environment variable or a clock, which is what lets the expiry and lockout
 * rules be tested without waiting ten minutes.
 *
 * **The code itself never leaves this module except to be sent by SMS.** It is
 * not logged, not returned from an action, not written to the database, and not
 * put in an error message. What the database holds is an HMAC of it.
 */

export const OTP_LENGTH = 6

/** Long enough to arrive and be typed, short enough that a stolen SMS ages out. */
export const OTP_TTL_MS = 10 * 60 * 1000

/**
 * Six wrong guesses and the challenge is dead.
 *
 * A six-digit code is a 10^6 space. Unlimited guesses against it is a walk, not
 * an attack — at one attempt per second it falls in under two weeks, and an
 * attacker with a script does it in minutes.
 */
export const MAX_OTP_ATTEMPTS = 6

/**
 * `randomInt` rather than `randomBytes % 1000000`: the modulo is biased, and a
 * biased OTP is a smaller space than it looks. Padded, so `007431` is six
 * digits rather than four.
 */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
}

/**
 * HMAC-SHA256 under a pepper held outside the database.
 *
 * A plain SHA-256 of a six-digit code is not a secret — the whole space
 * precomputes in about a second. The pepper is the only thing that makes a
 * stolen `otp_challenges` row useless, which is why it lives in the
 * environment (KMS later) and not in Postgres.
 */
export function hashOtpCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex')
}

/** Constant-time comparison. A fast reject is an oracle. */
export function otpCodeMatches(
  code: string,
  pepper: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashOtpCode(code, pepper), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function otpExpiresAt(now: Date): Date {
  return new Date(now.getTime() + OTP_TTL_MS)
}

/** Just the shape the rules need — not the Prisma row (rule 6). */
export interface OtpChallengeState {
  readonly expiresAt: Date
  readonly attempts: number
  readonly consumedAt: Date | null
}

export type OtpChallengeStatus =
  'usable' | 'expired' | 'already-used' | 'too-many-attempts'

export function otpChallengeStatus(
  challenge: OtpChallengeState,
  now: Date,
): OtpChallengeStatus {
  if (challenge.consumedAt !== null) return 'already-used'
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) return 'too-many-attempts'
  if (challenge.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'usable'
}
