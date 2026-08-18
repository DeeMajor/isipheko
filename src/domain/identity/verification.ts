import type { VerificationFailure, VerificationOutcome } from './verifier.ts'

/**
 * The rules around a check: who may start one, how often, how a pending answer
 * is chased, and when a pending answer has waited long enough to be called
 * something else.
 *
 * Pure. Nothing here talks to a provider or a database — it decides, and
 * `src/lib/identity.ts` acts.
 */

export type OrganiserVerificationStatus = 'unverified' | 'pending' | 'verified' | 'failed'

/**
 * Three checks per organiser per day.
 *
 * This is the first thing in the product where a retry loop spends real money:
 * roughly R30 a call at VerifyNow's rate (§7.1), so a form somebody can hammer
 * is a bill somebody can run up. Three is enough for a typo, a correction, and
 * one more — and a fourth attempt in a day is a conversation rather than a
 * button.
 */
export const MAX_ATTEMPTS_PER_WINDOW = 3
export const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000

export type StartRejection =
  'already-verified' | 'already-pending' | 'rate-limited' | 'no-consent'

export type StartDecision =
  { readonly ok: true } | { readonly ok: false; readonly reason: StartRejection }

/**
 * Whether this organiser may start a check now.
 *
 * `already-pending` is a refusal rather than a restart: a second check while one
 * is in flight is a second bill for the same answer, and the first one is about
 * to arrive.
 */
export function canStartVerification({
  status,
  attemptsInWindow,
  hasConsent,
}: {
  status: OrganiserVerificationStatus
  attemptsInWindow: number
  hasConsent: boolean
}): StartDecision {
  if (status === 'verified') return { ok: false, reason: 'already-verified' }
  if (status === 'pending') return { ok: false, reason: 'already-pending' }

  // POPIA s11 needs a lawful basis and consent is the practical one (§7.3). It
  // is captured in the same submission, so this is the belt on a structural
  // brace: a verification row cannot exist without a consent row, because the
  // foreign key is NOT NULL.
  if (!hasConsent) return { ok: false, reason: 'no-consent' }

  if (attemptsInWindow >= MAX_ATTEMPTS_PER_WINDOW) {
    return { ok: false, reason: 'rate-limited' }
  }

  return { ok: true }
}

/**
 * How long the page waits before reloading itself, given how long the check has
 * already been running.
 *
 * The check is never blocked on: submission returns immediately and the pending
 * page reloads on a widening interval (§5.6 asks for exactly this shape on the
 * bank-account check, which can take 120 seconds). A 120-second pending is
 * therefore just more reloads, and the numbers below are chosen so that case
 * costs about a dozen of them rather than sixty.
 */
export function nextPollSeconds(elapsedMs: number): number {
  if (elapsedMs < 10_000) return 2
  if (elapsedMs < 30_000) return 3
  if (elapsedMs < 60_000) return 5
  if (elapsedMs < 120_000) return 8

  return 13
}

/**
 * The floor between two calls to the provider, whoever asks.
 *
 * Reloading is cheap; a provider call is not, and an organiser with the page
 * open on a phone and a laptop would otherwise double the traffic against
 * somebody's rate limit. The row carries `last_polled_at` and this is what it
 * is compared against.
 */
export const MIN_PROVIDER_POLL_INTERVAL_MS = 2_000

/**
 * When a pending check stops being pending and becomes a failure.
 *
 * Comfortably past the 120 seconds §5.6 documents as a real answer — four
 * minutes is a provider that is not going to answer, and telling somebody to
 * keep watching a page for longer than that is not honest. The record says
 * `timed-out`, which is distinguishable from a check that came back negative:
 * one is our problem to retry, the other is theirs to correct.
 */
export const PENDING_DEADLINE_MS = 4 * 60 * 1000

export function hasTimedOut(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() > PENDING_DEADLINE_MS
}

export function shouldPollProvider(
  lastPolledAt: Date | null,
  now: Date,
  minIntervalMs: number = MIN_PROVIDER_POLL_INTERVAL_MS,
): boolean {
  if (lastPolledAt === null) return true

  return now.getTime() - lastPolledAt.getTime() >= minIntervalMs
}

export type CheckStatus = 'pending' | 'verified' | 'failed'

export type OutcomeApplication =
  | { readonly apply: false }
  | { readonly apply: true; readonly status: 'verified' }
  | {
      readonly apply: true
      readonly status: 'failed'
      readonly reason: VerificationFailure
    }

/**
 * What a provider's answer does to a record that already has a status.
 *
 * **Terminal once.** A verified check that is polled again — a stale tab, a
 * duplicate callback — cannot be turned into a failure, and a failed one cannot
 * quietly become a pass. The record of a check is evidence with a retention
 * period (§7.3); a later answer is a *new* check, not an edit to this one.
 */
export function applyOutcome(
  current: CheckStatus,
  outcome: VerificationOutcome,
): OutcomeApplication {
  if (current !== 'pending') return { apply: false }
  if (outcome.status === 'pending') return { apply: false }

  return outcome.status === 'verified'
    ? { apply: true, status: 'verified' }
    : { apply: true, status: 'failed', reason: outcome.reason }
}

/**
 * Whether a failure is worth another try today.
 *
 * A provider that was unavailable, or a check that timed out, says nothing
 * about the person — retrying is the right move. `no-match` and `deceased` say
 * the Home Affairs record disagrees, and running the same number again produces
 * the same answer for another R30; that path leads to the report channel
 * (M3-06), not to a retry button.
 */
export function isRetryable(reason: VerificationFailure): boolean {
  return (
    reason === 'provider-unavailable' ||
    reason === 'timed-out' ||
    reason === 'liveness-failed' ||
    reason === 'face-mismatch'
  )
}
