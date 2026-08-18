/**
 * When a notification may be sent, to which channel, and when to try again.
 *
 * Pure arithmetic over clocks and recipients. Nothing here knows what a
 * notification says, what stores it, or who delivers it.
 *
 * Two rules in this file cost money or cost somebody sleep, and both are here
 * rather than in a repository so they can be tested without a database:
 *
 * **The digest cap.** One message an hour to an organiser, per umcimbi. A
 * 200-contribution funeral is 200 billable utility messages unbatched
 * (architecture §8.1) and at most 24 a day batched.
 *
 * **The quiet window.** Digests are non-urgent by construction — that is what
 * makes them digestible — so they are held to 07:00–21:00 South African time. A
 * phone buzzing at three in the morning about contributions to your mother's
 * funeral is a harm this product would otherwise have shipped without noticing.
 * Immediate messages are unaffected: a contributor who has just been told their
 * contribution is confirmed is waiting for that.
 */

export type NotificationChannel = 'whatsapp' | 'sms' | 'email'

export type NotificationKind =
  /** One message summarising what happened on one umcimbi in the last hour. */
  | 'organiser_digest'
  /** Straight to the person it concerns. Not batched, not held. */
  | 'contribution_confirmed'
  | 'claim_confirmed'
  | 'claim_expiring'
  /** Somebody who reported a page, told we have it and when a person will look. */
  | 'report_received'

export type DigestEntryKind =
  'contribution_self_reported' | 'contribution_confirmed' | 'need_claimed'

/** What we hold for somebody. Both may be absent, and often are. */
export interface Recipient {
  readonly phoneE164?: string | null
  readonly email?: string | null
}

/**
 * WhatsApp where there is a number, email where there is not, nothing where
 * there is neither.
 *
 * **A contributor with no number gets nothing, and that is correct.** They have
 * no account and are never asked for an email — M2-05 has a test asserting no
 * email input exists anywhere in the contribution flow (rule 4). Architecture
 * §8.2 says email backs every row; it was written before that rule was as firm
 * as it is. Collecting an address to buy a fallback would trade the property
 * for the convenience. See docs/decisions.md M2-08.
 */
export function channelFor(recipient: Recipient): NotificationChannel | null {
  if ((recipient.phoneE164 ?? '') !== '') return 'whatsapp'
  if ((recipient.email ?? '') !== '') return 'email'

  return null
}

/** Architecture §8.2: max one digest an hour, per organiser per umcimbi. */
export const DIGEST_INTERVAL_MS = 60 * 60 * 1000

/** South Africa keeps UTC+2 all year — no daylight saving, no table to read. */
export const SAST_OFFSET_MINUTES = 120

/** 07:00–21:00 SAST. A digest that arrives at 21:05 waits for the morning. */
export const QUIET_HOURS_START = 21
export const QUIET_HOURS_END = 7

/** The hour of the day in South Africa, 0–23. */
export function sastHour(at: Date): number {
  return new Date(at.getTime() + SAST_OFFSET_MINUTES * 60 * 1000).getUTCHours()
}

export function withinSendWindow(at: Date): boolean {
  const hour = sastHour(at)

  return hour >= QUIET_HOURS_END && hour < QUIET_HOURS_START
}

/**
 * The moment a held digest may go out: now if the window is open, otherwise the
 * next 07:00 South African time.
 *
 * Nothing is dropped by being held — the entries wait in the table and the
 * digest summarises all of them when it goes.
 */
export function nextSendWindow(at: Date): Date {
  if (withinSendWindow(at)) return at

  const local = new Date(at.getTime() + SAST_OFFSET_MINUTES * 60 * 1000)
  const morning = new Date(local)

  morning.setUTCHours(QUIET_HOURS_END, 0, 0, 0)
  // Before 07:00 it is this morning; at or after 21:00 it is tomorrow's.
  if (local.getUTCHours() >= QUIET_HOURS_START) {
    morning.setUTCDate(morning.getUTCDate() + 1)
  }

  return new Date(morning.getTime() - SAST_OFFSET_MINUTES * 60 * 1000)
}

/**
 * When the next digest for one organiser and one umcimbi may be sent.
 *
 * `null` for "never sent one" means now, subject to the window. Otherwise an
 * hour after the last one, and again subject to the window — the two rules
 * compose rather than one overriding the other.
 */
export function digestDueAt(lastSentAt: Date | null, now: Date): Date {
  const earliest =
    lastSentAt === null
      ? now
      : new Date(Math.max(now.getTime(), lastSentAt.getTime() + DIGEST_INTERVAL_MS))

  return nextSendWindow(earliest)
}

export function digestDue(lastSentAt: Date | null, now: Date): boolean {
  return digestDueAt(lastSentAt, now).getTime() <= now.getTime()
}

/** Three tries, then the fallback channel. */
export const MAX_ATTEMPTS = 3

const BACKOFF_MS: readonly [number, number, number] = [
  60 * 1000,
  5 * 60 * 1000,
  25 * 60 * 1000,
]

/**
 * Exponential-ish backoff, and deliberately not aggressive: a BSP that is down
 * is not helped by a retry storm, and none of these messages is worth less
 * twenty-five minutes later.
 *
 * `attempts` is **failures so far, counting the one that just happened** — so
 * the first failure waits a minute. Taking "attempts before this one" would
 * have the caller doing arithmetic at the call site, which is where an off-by-
 * one turns into a message that arrives five minutes late for no reason.
 */
export function nextAttemptAt(attempts: number, now: Date): Date {
  const index = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1
  const delay = index === 0 ? BACKOFF_MS[0] : index === 1 ? BACKOFF_MS[1] : BACKOFF_MS[2]

  return new Date(now.getTime() + delay)
}

export function attemptsExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS
}

/**
 * What one digest is about to say, as counts.
 *
 * **Counts, never amounts.** The organiser sees every amount on their own
 * screen; a WhatsApp message is read on a lock screen, forwarded, and screenshot
 * — and on a bereavement event amounts are hidden by default (§7.3). There is
 * no reading of "batch the notifications" that requires putting a total in one.
 */
export interface DigestCounts {
  readonly selfReported: number
  readonly confirmed: number
  readonly claimed: number
  readonly total: number
}

export function countDigest(kinds: readonly DigestEntryKind[]): DigestCounts {
  const count = (kind: DigestEntryKind) => kinds.filter((each) => each === kind).length

  return {
    selfReported: count('contribution_self_reported'),
    confirmed: count('contribution_confirmed'),
    claimed: count('need_claimed'),
    total: kinds.length,
  }
}
