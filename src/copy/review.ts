import type { ReportReason, ReportStatus } from '@/domain/report'

/**
 * The review queue (M3-07) — the screen a person works from.
 *
 * **Internal, and keyed here anyway.** Rule 11 has no exception for screens
 * only staff see: the moment a string is inlined "because nobody outside reads
 * it" is the moment the next internal screen inlines its strings too, and this
 * one in particular is where somebody decides something about a family. It
 * should be written as carefully as the pages that family sees.
 *
 * The voice is the product's voice, not a console's. A reviewer at 22:00 with
 * eleven reports open is exactly the reader who is badly served by
 * `status: RECEIVED` and a UUID.
 *
 * **What this screen must never imply is that closing a report does something.**
 * It does not. It records how far the reading has got. Whatever is decided
 * about an event is done on the event, by a person, and that is stated here
 * rather than left to be inferred (docs/decisions.md M3-06 §1, M3-07 §4).
 */

export const reviewCopy = {
  title: 'Reports',
  lead: 'Oldest promise first. The window on each one is what somebody was told when they filed it.',

  /** Said once, at the top, because it is the thing most easily forgotten. */
  standingRule:
    'Nothing here changes a page. Closing a report records that it was read and decided — if something has to happen to an event, do it on the event.',

  empty: {
    heading: 'Nothing waiting',
    body: 'Every report has been read. This is the ordinary state, not an error.',
  },

  noReviewers:
    'No reviewer numbers are configured, so nobody can open this queue. Set ADMIN_PHONE_NUMBERS.',

  refused: {
    heading: 'Not for this account',
    body: 'This queue is open to the people who answer reports. If that should be you, the list of numbers is set where the app is deployed — not from in here.',
  },

  counts: {
    waiting: (n: number) => (n === 1 ? '1 waiting' : `${String(n)} waiting`),
    overdue: (n: number) =>
      n === 1 ? '1 past its window' : `${String(n)} past their window`,
    onTime: 'All within their window',
  },

  /**
   * Where this page sits in the whole queue (M3-07b).
   *
   * The list took a hundred and said nothing, so a reviewer who scrolled to the
   * bottom believed they had seen everything — **the SLA failing invisibly on
   * the screen built to guarantee it**, and the reports that fell off were the
   * newest ones, whose deadlines had not yet arrived.
   *
   * Said whether or not there is more, because a list that only announces its
   * limit when it has one still ends silently on the day it does not.
   */
  showing: (first: number, last: number, total: number) =>
    total === 1
      ? 'One report, and this is it.'
      : first === 1 && last === total
        ? `All ${String(total)} open reports are on this page.`
        : `Showing ${String(first)} to ${String(last)} of ${String(total)} open reports.`,

  pages: {
    label: 'More reports',
    previous: 'Earlier deadlines',
    next: (n: number) =>
      n === 1 ? 'The next one' : `The next ${String(n)}, by deadline`,
  },

  /** What a person is looking at, in the reporter's terms rather than a code. */
  reasons: {
    'not-who-they-say': 'Not who they say they are',
    'never-happened': 'The umcimbi is not real',
    'asked-for-a-code': 'Asked for a PIN, OTP or card number',
    'money-not-received': 'Money never reached the family',
    'something-else': 'Something else',
  } satisfies Record<ReportReason, string>,

  /**
   * `asked-for-a-code` is the one to pick up first regardless of its deadline:
   * somebody is being phished right now, and the window is a promise about
   * reading rather than a judgement about urgency.
   */
  urgent: 'Somebody is being asked for a code. Read this one first.',

  statuses: {
    received: 'Not yet read',
    reviewing: 'Being read',
    closed: 'Decided',
  } satisfies Record<ReportStatus, string>,

  waiting: (hours: number) =>
    hours < 1
      ? 'Filed in the last hour'
      : hours === 1
        ? 'Waiting 1 hour'
        : `Waiting ${String(hours)} hours`,
  due: (when: string) => `Answer by ${when}`,
  overdue: (when: string) => `Was due ${when}`,

  about: {
    heading: 'What it is about',
    event: (title: string) => `The umcimbi "${title}"`,
    collection: (title: string) => `The collection "${title}"`,
    /** The most valuable kind of report, and it should not read as incomplete. */
    nothingHeld:
      'Nothing we host. This is a link or a message that resolves to nothing — often the clearest sign of a page pretending to be us.',
    typed: 'What they were sent',
  },

  detail: {
    heading: 'In their words',
    none: 'They did not add anything, which is not a problem — the reason above is a report.',
  },

  /**
   * The number, and why it is on this screen and nowhere else.
   *
   * Said in one line rather than assumed, because the next person to build a
   * screen here will otherwise copy the field onto a list without noticing that
   * the reason it exists is the promise, not the record.
   */
  contact: {
    heading: 'Coming back to them',
    why: 'Their number is here because we told them a person would come back to them, and that is not possible without it. It is on this screen only — not in the queue, not in any log.',
    none: 'They left no number. They were told plainly that the reference on screen was the whole of what they would hear, so there is nobody waiting on a call.',
  },

  trail: {
    heading: 'What has happened to this umcimbi',
    none: 'Nothing recorded against it yet.',
    hint: 'From the audit log. It is append-only — this is what happened, not what somebody remembers happening.',
    /** Plain names for the action strings. A reviewer should not read slugs. */
    actions: {
      'event.published': 'Published',
      'contribution.confirmed': 'A contribution confirmed',
      'delivery.confirmed': 'Provisions marked as arrived',
      'handover.confirmed': 'A handover closed',
      'report.filed': 'Somebody reported it',
      'report.triaged': 'A reviewer moved a report along',
      'admin.report.opened': 'A reviewer opened a report about it',
    } as Record<string, string>,
  },

  actions: {
    open: 'Read it',
    back: 'Back to the queue',
    start: 'I am reading this',
    close: 'I have decided this',
    closeHelp:
      'Records that a person read it and decided. Nothing happens to any page — do that separately, on the event, if it is warranted.',
    /** No reopen, and the screen says why rather than leaving a dead end. */
    closed:
      'This one is decided and does not reopen. If it needs looking at again, the trail above is the record and a new decision is a new action on the event.',
  },

  problems: {
    'not-found':
      'That report is not there, or somebody moved it a moment ago. The queue below is current.',
    'not-a-transition':
      'A report goes from not-read, to being-read, to decided, and only that way.',
  },
} as const
