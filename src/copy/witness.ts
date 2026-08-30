import type { InviteRejection } from '@/domain/witness'

/**
 * The invite an umkhaphi opens, and the line that names them on the page.
 *
 * **Being asked is a compliment, not an audit** (Part D). The question comes
 * from `design/setup.html` verbatim — it is the same sentence the organiser was
 * shown when she named them, and a test asserts the two agree so the promise
 * and the delivery cannot drift.
 *
 * **The public display line is authored, not extracted.** `design/event.html`
 * has no abakhaphi block at all, so there was nothing to take. It is written in
 * the register the rest of this copy establishes, and flagged here and in
 * docs/decisions.md M3-03 so a reviewer can tell which strings have a design
 * source and which do not — the same treatment M2-07 §11 gave the English-only
 * share message.
 */

export const witnessCopy = {
  /** What the person holding the link sees first. */
  invite: {
    kicker: 'You have been asked',
    /** The design's sentence, and the only question on the page. */
    question: (organiser: string, kicker: string, title: string) =>
      `${organiser} is arranging ${kicker.toLowerCase()} for ${title}, and has asked you to stand with them as umkhaphi. Will you?`,
    /**
     * What it means, in the words the organiser was given. Nothing here asks
     * for money, an account, or anything else.
     */
    meaning:
      'If you say yes, your name goes on the page beside theirs, and money only moves when one of you agrees with them. Nothing else is asked of you.',
    weight:
      "Being asked to witness a family's umcimbi is not a small thing — it says they trust you with the family's business.",
    accept: 'Yes, I will stand with them',
    decline: 'No, not this time',
    /** Said plainly, because somebody on a borrowed phone deserves to know. */
    noAccount:
      'There is nothing to sign up for and nothing to pay. This link is only for you, and answering it is all it does.',
  },

  accepted: {
    title: 'You are standing with them',
    body: (organiser: string) =>
      `Your name is on the page now, beside ${organiser}'s. That is all this needed.`,
    note: 'Nothing else is asked of you. If you are asked to agree to anything later, it will come from this page and never by a phone call asking for a code.',
  },

  declined: {
    title: 'You have said no',
    /** No persuasion, no second ask, and no guilt. */
    body: 'That is a complete answer and nothing more is needed from you. Being asked was not a small thing, and saying no does not make it one.',
  },

  /** Every way a link can fail to work, saying what happened and what to do. */
  problems: {
    'already-answered':
      'You have already answered this one. If you meant to change it, ask whoever sent it to you for a new link.',
    expired:
      'This link has run out — they last a month. Ask whoever sent it to you for another and it will work.',
    withdrawn: 'This link is no longer live. Ask whoever sent it to you for another one.',
  } satisfies Record<InviteRejection, string>,

  notFound: {
    title: 'That link is not one of ours',
    body: 'Check you have the whole of it — the end is easy to lose when a message wraps. If it still does not work, ask whoever sent it to you.',
  },

  /**
   * The public page. **Authored, not extracted** — see the note above.
   *
   * One line, in the header beside the organiser, because that is exactly what
   * the setup screen promised: *"their names go on the page beside yours."* No
   * count, no status, nobody who declined, and no phone number — a name here
   * means that person agreed to stand with the family, and nothing else is
   * anybody's business.
   */
  public: {
    standingWith: (names: string) => `Standing with them: ${names}`,
    /** For a screen reader, where the word abakhaphi does the work. */
    label: 'Abakhaphi — those who agreed to stand with the family',
  },
} as const

/**
 * "Thandi", "Thandi and Sipho", "Thandi, Sipho and Mandla".
 *
 * Written out rather than reached for from `Intl.ListFormat`, which emits an
 * Oxford comma in `en` and is not reliably the same across ICU versions — the
 * same reason M1-03 §5 hand-rolled the money formatter rather than trusting
 * `Intl.NumberFormat`.
 */
export function nameList(names: readonly string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0] ?? ''

  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
}
