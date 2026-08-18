import type { ReportReason, ReportRejection } from '@/domain/report'

/**
 * Telling us a page is wrong (M3-06).
 *
 * **57% of South Africans who report a scam hear nothing back**, so what this
 * screen must not do is take a report and go quiet. Every string here is
 * written against that: what happens next, when, and what we can and cannot do.
 *
 * Two things it deliberately does not promise:
 *
 * - **That anything happens to the page.** A report does nothing by itself, and
 *   saying it does would be untrue and would make the form a weapon against a
 *   family (see docs/decisions.md M3-06 §1).
 * - **That a message will reach them.** No BSP exists, so the acknowledgement
 *   that arrives today is the reference on this screen. The copy says exactly
 *   that rather than describing a message somebody would then wait for.
 */

export const reportCopy = {
  title: 'Tell us something is wrong',
  lead: 'If a page is not what it says it is, this is where to say so. It takes a moment and you do not need an account.',

  aboutHeading: 'What is it about?',
  aboutKnown: (title: string) => `You are reporting ${title}.`,
  aboutUnknown:
    'If you have a link or a code, put it here. If the link does not open anything at all, that is worth telling us on its own — it is often the clearest sign.',
  aboutLabel: 'The link or code you were sent',

  reasonHeading: 'What is wrong?',
  reasons: {
    'not-who-they-say': 'The person is not who the page says they are',
    'never-happened': 'The umcimbi is not real, or is not happening',
    'asked-for-a-code': 'Somebody asked me for a PIN, an OTP or a card number',
    'money-not-received': 'I gave money and the family never got it',
    'something-else': 'Something else',
  } satisfies Record<ReportReason, string>,

  detailLabel: 'Anything you want to add',
  detailHelp:
    'In your own words. You do not have to explain it well, and you can leave it empty.',

  phoneLabel: 'Your number, if you want us to come back to you',
  phoneHelp:
    'Optional. We use it once, to tell you what happened with this report, and for nothing else.',
  phoneNone:
    'Leave it blank and we still act on what you have told us — you just will not hear the outcome.',

  submit: 'Send this report',

  filed: {
    heading: 'We have it',
    /** The acknowledgement that actually arrives: a reference, now, on screen. */
    reference: (reference: string) => `Your reference is ${reference}.`,
    keep: 'Write it down or take a picture of this screen. It is how you refer to this report if you talk to us about it.',
    when: (by: string) => `A person will have looked at this by ${by}.`,
    /**
     * The truth about the message, rather than a message somebody waits for.
     * When a provider exists this is what will have been sent; today it is held.
     */
    reachable: 'We have your number and will use it once, to tell you what came of this.',
    unreachable:
      'You did not leave a number, so this screen is the whole of what you will hear. That is why the reference matters.',
    /**
     * What a report does and does not do. Said here because somebody who has
     * just reported a page will otherwise assume the page has changed, go back,
     * find it unchanged, and conclude nothing happened.
     */
    whatHappens:
      'Nothing changes on the page because of this. A person reads what you sent and decides — we do not take a page down because somebody asked us to, in either direction.',
    thanks:
      'Reporting something takes a minute nobody owes anybody. It is the main way this stays worth trusting.',
  },

  problems: {
    'no-reason': 'Choose what is wrong, and send it again.',
    'nothing-said':
      'Tell us something about it — the link you were sent, or what happened, in any words at all.',
    'rate-limited':
      'That is several reports in a short time. Give it an hour, or if there is a lot to say, put it in one report.',
  } satisfies Record<ReportRejection, string>,

  /** Where the panel sends somebody, in the same posture as /check (M3-04). */
  linkLabel: 'isipheko.co.za/report',
} as const
