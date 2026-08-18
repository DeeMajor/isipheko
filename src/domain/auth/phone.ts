import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * South African phone numbers, normalised to E.164.
 *
 * One number has to produce one identity however it was typed. `082 123 4567`,
 * `0821234567`, `+27 82 123 4567` and `27821234567` are the same person, and if
 * they are not the same string then the rate limit counts them separately and
 * somebody signs in as a second account by adding a space.
 */

/** `+27` followed by nine digits, first of which is never zero. */
const E164_SA = /^\+27[1-9]\d{8}$/

export type PhoneParseFailure = 'empty' | 'not-a-number' | 'not-south-african'

export type PhoneParseResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: PhoneParseFailure }

/**
 * Returns a result rather than throwing: this reads untrusted form input, where
 * a failure is an expected outcome with copy attached (`src/copy/auth.ts`).
 *
 * Only South African numbers, deliberately. The product is South African, OTP
 * to an international number is expensive and is a common fraud pattern, and
 * accepting one here would mean accepting it everywhere downstream.
 */
export function normalisePhone(input: string): PhoneParseResult {
  const stripped = input.replace(/[\s\-().]/g, '')
  if (stripped === '') return { ok: false, reason: 'empty' }

  const digits = stripped.startsWith('+') ? stripped.slice(1) : stripped
  if (!/^\d+$/.test(digits)) return { ok: false, reason: 'not-a-number' }

  // 0821234567 -> +27821234567
  const e164 = digits.startsWith('0')
    ? `+27${digits.slice(1)}`
    : digits.startsWith('27')
      ? `+${digits}`
      : `+${digits}`

  if (!E164_SA.test(e164)) return { ok: false, reason: 'not-south-african' }

  return { ok: true, value: e164 }
}

/**
 * For the audit log, which records that a number was involved without recording
 * the number (CLAUDE.md rule 8).
 *
 * HMAC rather than a bare hash: the space of South African mobile numbers is
 * about 10^9, so an unpeppered digest is a lookup table somebody builds in an
 * afternoon.
 */
export function hashPhone(phoneE164: string, pepper: string): string {
  return createHmac('sha256', pepper).update(phoneE164).digest('hex')
}

/** Constant-time, so a comparison cannot be turned into an oracle. */
export function phoneHashMatches(
  phoneE164: string,
  pepper: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashPhone(phoneE164, pepper), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
