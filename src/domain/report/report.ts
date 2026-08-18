/**
 * Somebody telling us a page is not what it says it is.
 *
 * **57% of South Africans who report a scam hear nothing back.** That is the
 * finding this whole task exists against, and it makes the acknowledgement the
 * product rather than the form: anybody can put up a form, and a form that
 * swallows a report is worse than no form, because it spends the one moment
 * somebody was willing to act.
 *
 * ## The standing rule
 *
 * **A report does nothing by itself.** It does not flag, hold, hide, or change
 * an event in any way. A person decides; the record records.
 *
 * That is not caution about false positives, it is about what the alternative
 * would be: a form that changed a page would be a way to attack a family. File
 * five reports on a funeral and watch the page change under people who are
 * burying somebody. The reporter is anonymous by design — there is no account
 * and never will be (rule 4) — so anything automatic here is automatic for
 * whoever is willing to press it most.
 *
 * See docs/decisions.md M3-06 §1. The pressure to make this automatic will come
 * back the first time somebody asks why we did not catch something on our own.
 *
 * Pure: shapes, windows and rules. No I/O.
 */

/**
 * Why somebody is reporting, in the words they would use.
 *
 * A short list rather than free text alone, because "what kind of wrong" is the
 * first thing a person reviewing needs and the last thing somebody upset writes
 * clearly. `something-else` is always available and the detail box is never
 * required — a report that says only *"this is not right"* is still a report.
 */
export type ReportReason =
  | 'not-who-they-say'
  | 'never-happened'
  | 'asked-for-a-code'
  | 'money-not-received'
  | 'something-else'

export const REPORT_REASONS: readonly ReportReason[] = [
  'not-who-they-say',
  'never-happened',
  'asked-for-a-code',
  'money-not-received',
  'something-else',
]

export function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value)
}

/** Where a report is in the hands of a person. The screen is M3-07's. */
export type ReportStatus = 'received' | 'reviewing' | 'closed'

/**
 * One working day for a person to have looked.
 *
 * Stated on screen and stored on the record, so it is the same number in both
 * places and neither can drift. **It is deliberately a number a small team can
 * keep**: a window chosen because it sounds reassuring is the same promise the
 * 57% were given.
 *
 * Working days rather than hours: a report filed on Friday evening is answered
 * on Monday, and saying so is better than a deadline that was never going to be
 * met and then quietly was not.
 */
export const RESPONSE_WORKING_DAYS = 1

/**
 * The deadline, skipping weekends.
 *
 * South Africa is UTC+2 with no daylight saving (M2-08 §3), so the conversion
 * is arithmetic. Public holidays are not handled: there are twelve of them and
 * getting one wrong would move a deadline in the direction of promising more
 * than we keep, which is the wrong direction to be wrong in.
 */
export function respondBy(filedAt: Date, workingDays = RESPONSE_WORKING_DAYS): Date {
  const deadline = new Date(filedAt.getTime())
  let remaining = workingDays

  while (remaining > 0) {
    deadline.setUTCDate(deadline.getUTCDate() + 1)
    const day = deadline.getUTCDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }

  return deadline
}

export function isOverdue(respondByAt: Date, status: ReportStatus, now: Date): boolean {
  return status === 'received' && respondByAt.getTime() < now.getTime()
}

/**
 * How many reports one address may file in an hour.
 *
 * Generous, like every other limit here: a church hall on shared wifi is
 * ordinary, and somebody who has just been shown a fake page may well tell us
 * about it twice. What this stops is a script using the form to bury the queue,
 * which would hurt the next person's report rather than ours.
 *
 * Same caveat as M1-06 §5 for the fourth time: the address is only as
 * trustworthy as the proxy in front of it.
 */
export const MAX_REPORTS_PER_ADDRESS_PER_HOUR = 5

export interface DraftReport {
  readonly reason: string
  /** Free text. Never required — a report with no words is still a report. */
  readonly detail: string
  /** What they were sent, when it resolves to nothing we hold. */
  readonly about: string
  /** The only way to come back to them, and optional. */
  readonly phone: string
}

export type ReportRejection = 'no-reason' | 'nothing-said' | 'rate-limited'

export type ReportDecision =
  { readonly ok: true } | { readonly ok: false; readonly reason: ReportRejection }

/**
 * Whether this is a report at all.
 *
 * The bar is deliberately low. A reason is required because it is one tap and
 * it is what a reviewer reads first; beyond that, **something has to say what
 * this is about** — a page we can identify, a link they were sent, or words.
 * An empty form is not a report, and everything else is.
 */
export function checkReport(
  draft: DraftReport,
  { identified, withinLimit }: { identified: boolean; withinLimit: boolean },
): ReportDecision {
  if (!withinLimit) return { ok: false, reason: 'rate-limited' }
  if (!isReportReason(draft.reason)) return { ok: false, reason: 'no-reason' }

  if (!identified && draft.about.trim() === '' && draft.detail.trim() === '') {
    return { ok: false, reason: 'nothing-said' }
  }

  return { ok: true }
}
