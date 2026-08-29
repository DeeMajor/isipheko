/**
 * Sign-in copy. CLAUDE.md rule 11 — no user-facing string is inlined in a
 * component, and this structure is the translation unit.
 *
 * Not keyed by archetype: signing in is not a ceremony, and the words do not
 * change with one. The archetype-keyed sets arrive with Part D.
 *
 * Two rules shape most of what is below. **The reply never reveals whether a
 * number is registered** — the same sentence appears whether we sent a code,
 * refused on the rate limit, or have never seen the number. And **errors say
 * what happened and what to do next**, without apologising and without vagueness.
 */

export const authCopy = {
  signIn: {
    title: 'Sign in',
    intro:
      'We send a code to your phone. No password to remember, and nothing to reset when you forget it.',
    phoneLabel: 'Your phone number',
    phoneHelp: 'A South African mobile number. The code arrives by SMS.',
    phonePlaceholder: '082 123 4567',
    submit: 'Send me a code',
  },

  code: {
    title: 'Enter the code',
    /**
     * Deliberately conditional-sounding. It is the same sentence for a number
     * we know, a number we do not, and a number that has asked three times in
     * the last hour — so the page cannot be used to find out which.
     */
    intro: 'If we can reach that number, a code is on its way. It lasts ten minutes.',
    codeLabel: 'The six-digit code',
    codeHelp:
      'It arrives by SMS. Isipheko will never phone or message you to ask for it.',
    submit: 'Sign me in',
    resend: 'Use a different number',
    /** Sent by SMS. §10: every outbound message says we never ask for it. */
    sms: (code: string) =>
      `${code} is your Isipheko code. It lasts ten minutes. We will never phone or message you to ask for it.`,
  },

  signedIn: {
    /*
     * The three strings on `/account` that were inlined in the component until
     * M1-10. Every one is user-facing, so every one belongs in the translation
     * unit — a string in a `.tsx` is a string a translation pass keyed on
     * `src/copy/` never sees (rule 11).
     */
    title: 'You are signed in',
    body: 'Set up an umcimbi and share it when you are ready.',
    setUp: 'Set up your umcimbi',
    startCollection: 'Start a collection',

    /**
     * The way back (UX-04). `/account` is where every later sign-in lands, and
     * until these lists existed it offered nothing but "set up a new one" —
     * the confirmation queue, the drafts and the collections were all
     * reachable only from a bookmark. An organiser who signs in a week later
     * arrives here to confirm payments; this is the path.
     */
    eventsTitle: 'Your imicimbi',
    collectionsTitle: 'Your collections',
    draftTag: 'Still being set up',
    publishedTag: 'Published',
    collectionOpenTag: 'Open',
    collectionClosedTag: 'Handed over',
    /** An action keeps its name: this is the setup flow, resumed. */
    carryOn: 'Carry on setting it up',
    open: 'Open it',

    signOut: 'Sign out',
    signOutEverywhere: 'Sign out on every device',
  },

  errors: {
    phone: {
      empty: 'Enter your phone number.',
      'not-a-number':
        'That does not look like a phone number. Digits only, like 082 123 4567.',
      'not-south-african':
        'We can only send a code to a South African mobile number at the moment.',
    },
    code: {
      malformed: 'The code is six digits. Check the SMS and enter it again.',
      /**
       * One message for wrong, expired and never-existed. Three messages would
       * tell somebody guessing which of the three they hit, and that is a map
       * of which numbers are real.
       */
      rejected:
        'That code is wrong or has expired. Ask for a new one and it will arrive in a few seconds.',
      exhausted:
        'That code has been tried too many times and is now closed. Ask for a new one to carry on.',
      expiredSession:
        'That took a while and the code has expired. Start again with your number.',
    },
  },
} as const
