/**
 * How often a code may be asked for.
 *
 * Pure arithmetic over timestamps the caller has already counted. The counting
 * happens in Postgres, against the `otp_challenges` rows we are writing anyway
 * — exact, transactional, and no second service to run. Redis arrives with
 * BullMQ in M2 and this can move then; approximate is a poor property for
 * something gating account access.
 */

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** The number in the spec: three codes to one number in an hour. */
export const MAX_OTP_PER_NUMBER_PER_WINDOW = 3

/**
 * A second limit on the requester, because one phone per attacker is not the
 * threat model — enumerating numbers costs nothing if only the number is
 * counted. Higher than the per-number limit: a household, a taxi rank or an
 * office behind one NAT is a real thing and must not be locked out by a
 * neighbour signing in.
 */
export const MAX_OTP_PER_IP_PER_WINDOW = 12

export function rateLimitWindowStart(now: Date): Date {
  return new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)
}

export interface OtpRequestCounts {
  /** Requests for this number inside the window, oldest first. */
  readonly forNumber: readonly Date[]
  /** Requests from this IP inside the window, oldest first. */
  readonly forIp: readonly Date[]
}

export type RateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      readonly reason: 'number' | 'ip'
      /** Seconds until the oldest request leaves the window. Never negative. */
      readonly retryAfterSeconds: number
    }

/**
 * The number limit is checked first, so somebody hammering one number is told
 * about that number rather than about their address.
 *
 * Neither branch says whether the number is registered. The reply to a rate-
 * limited request and the reply to an accepted one are the same sentence
 * (`src/copy/auth.ts`); this decision only controls whether an SMS is sent.
 */
export function checkOtpRateLimit(
  counts: OtpRequestCounts,
  now: Date,
): RateLimitDecision {
  const windowStart = rateLimitWindowStart(now)
  const inWindow = (times: readonly Date[]) =>
    times.filter((time) => time.getTime() > windowStart.getTime())

  const forNumber = inWindow(counts.forNumber)
  const forIp = inWindow(counts.forIp)

  if (forNumber.length >= MAX_OTP_PER_NUMBER_PER_WINDOW) {
    return {
      allowed: false,
      reason: 'number',
      retryAfterSeconds: retryAfter(forNumber, now),
    }
  }

  if (forIp.length >= MAX_OTP_PER_IP_PER_WINDOW) {
    return { allowed: false, reason: 'ip', retryAfterSeconds: retryAfter(forIp, now) }
  }

  return { allowed: true }
}

function retryAfter(times: readonly Date[], now: Date): number {
  const oldest = times.reduce<Date | null>(
    (earliest, time) => (earliest === null || time < earliest ? time : earliest),
    null,
  )
  if (oldest === null) return 0

  const freeAt = oldest.getTime() + RATE_LIMIT_WINDOW_MS
  return Math.max(0, Math.ceil((freeAt - now.getTime()) / 1000))
}
