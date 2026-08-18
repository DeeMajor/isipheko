import type { SaIdRejection } from '@/domain/identity'
import type { StartRejection, VerificationFailure } from '@/domain/identity'

/**
 * The identity check, in words (rule 11).
 *
 * The explanatory copy — what we check, why it cannot be skipped — already
 * exists in `setupCopy.verify`, taken from `design/setup.html`, and is not
 * repeated here. What is here is everything the check itself needed: the
 * consent, the field, and what each of the ways it can end says to the person
 * standing in front of it.
 *
 * **The consent text is versioned and its exact words are hashed into the
 * record.** Changing a word means bumping {@link CONSENT_VERSION}, so a consent
 * captured in August can still be read back as the sentence that was actually
 * on screen in August. POPIA s11 wants a lawful basis; a record that cannot say
 * what was agreed to is not much of one.
 */

export const CONSENT_KEY = 'identity.consent'

/** Bump this whenever `consentStatement` changes by so much as a word. */
export const CONSENT_VERSION = '2026-08-17'

/**
 * One string, hashed exactly as written. It is rendered as a single paragraph
 * above the checkbox, so what is stored and what was read are the same thing.
 */
export const consentStatement =
  'I am giving Isipheko my South African ID number so it can be checked against ' +
  'the Home Affairs record, to confirm that the name on my umcimbi page is mine. ' +
  'The number is used for that one check. It is not stored, it is never shown on ' +
  'any page, and it is not given to anyone who contributes. What is kept is that ' +
  'the check passed and the date it passed.'

export const verifyCopy = {
  title: 'Confirm it is you',
  lead: 'One check against the Home Affairs record. It takes under a minute and you only do it once.',

  consent: {
    heading: 'What you are agreeing to',
    statement: consentStatement,
    /** The label on the checkbox itself. Short, because the paragraph is above it. */
    accept: 'I have read this and I agree to the check',
  },

  field: {
    /** Asked only where we do not have it yet — a collection organiser who has never set up an event. */
    nameLabel: 'Your name, as Home Affairs has it',
    label: 'Your ID number',
    help: 'Thirteen digits, as it appears on your green book or your card. Spaces are fine.',
  },

  submit: 'Run the check',

  /**
   * The pending page. It reloads itself on a widening interval — a real check
   * can take a hundred and twenty seconds, and this is what somebody reads
   * while it does.
   */
  pending: {
    title: 'Checking with Home Affairs',
    body: 'This page checks again on its own every few seconds. You can leave it open, or come back to it later — the check carries on either way.',
    stillWaiting:
      'Still going. Home Affairs can take up to two minutes, and nothing has gone wrong.',
    /*
     * There is no separate copy for the deadline. A check still pending after
     * four minutes is recorded as `timed-out` and read as a failure, so the
     * words for it live with the other failures — one screen, one voice, and no
     * second string saying nearly the same thing.
     */
  },

  verified: {
    title: 'You are verified',
    body: (on: string) =>
      `Checked against the Home Affairs record on ${on}. Your name carries that from now on, on every page you set up and on every link somebody opens.`,
    note: 'Your ID number was not kept. What is on the record is that the check passed, and when.',
    continue: 'Carry on',
  },

  failed: {
    title: 'That check did not pass',
    /**
     * One line per way it can end, each saying what happened and what to do
     * next. None of them apologise and none of them are vague.
     */
    reasons: {
      'no-match':
        'The number you gave does not match the name on this account at Home Affairs. Check the digits against your green book or your card, and check that the name you set up with is the one on your ID.',
      'name-mismatch':
        'The ID number is real, and the name on it is not the name on this account. Set up under the name Home Affairs has for you — a married name or a shortened first name is usually what does this.',
      'liveness-failed':
        'The photograph taken was not clear enough to compare. Somewhere brighter, and hold still for a moment longer.',
      'face-mismatch':
        'The photograph did not match the one Home Affairs holds. If it is you, try again in better light.',
      deceased:
        'Home Affairs has this ID number marked as deceased. That is an error only they can correct, and it has to be corrected there before this check can pass.',
      'provider-rejected':
        'The check was refused before it ran. Try it again — twice in a row means the fault is on our side rather than in what you typed.',
      'provider-unavailable':
        'The Home Affairs service did not answer. That is on their side and it is usually brief. Try again in a few minutes.',
      'duplicate-identity':
        'This ID number is already in use on Isipheko. If that is not something you did, it is worth finding out why — somebody using your identity is a thing you want to know about.',
      'timed-out':
        'The check did not come back in time. Nothing was taken and nothing about you was stored. Try again.',
    } satisfies Record<VerificationFailure, string>,
    retry: 'Try again',
    /**
     * The report channel is M3-06 and does not exist. Pointing at one that is
     * not there would be the failure M1-08 §5 refused on the event page — a
     * promise nobody can keep, made to somebody who is stuck.
     */
    noChannelYet:
      'There is nowhere on Isipheko to report this yet. When there is, it will be on this page.',
  },

  /** Refusals that happen before a provider is ever called. */
  blocked: {
    'already-verified': 'You are already verified. There is nothing to do here.',
    'already-pending':
      'A check is already running. Give it a moment rather than starting a second one — a second check costs the same as the first and answers the same question.',
    'rate-limited':
      'That is three checks today, which is as many as we run. Each one goes to Home Affairs and each one costs. Come back tomorrow and try again.',
    'no-consent':
      'The check cannot run until you agree to it. Read the paragraph above and tick the box.',
  } satisfies Record<StartRejection, string>,

  /** What the number itself was wrong about, before anybody was asked anything. */
  idErrors: {
    empty: 'Put in your ID number.',
    'wrong-length': 'A South African ID number is thirteen digits. Count what you typed.',
    'not-digits':
      'An ID number is digits only. Spaces and dashes are fine, letters are not.',
    'impossible-date':
      'The first six digits are a date of birth, and those are not one. Check the year, month and day at the start.',
    'unknown-citizenship':
      'The eleventh digit is a 0 or a 1 on every South African ID. Check that one.',
    'check-digit':
      'That is not quite a real ID number — the last digit is a check on the others and it does not add up. One of the thirteen is wrong.',
  } satisfies Record<SaIdRejection, string>,

  /** Shown where somebody is stuck behind the share gate, on the collection screen. */
  fromCollection: 'Confirm it is you',
} as const
