/**
 * The contribution flow. Strings from `design/contribute.html` (rule 11).
 *
 * Two things the design says that this product has to keep saying, because they
 * are the difference between an honest page and a convincing one:
 *
 *   "Nothing here needs an account and nothing is downloaded."
 *   "Nothing is taken from you here. You send it yourself, from your own app."
 *
 * Mode A means we never touch the money. Copy implying otherwise would be the
 * one dishonest thing in an otherwise honest product.
 */
export const contributeCopy = {
  choose: {
    title: 'How would you like to help?',
    intro:
      'Three ways, all the same weight. Nothing here needs an account and nothing is downloaded.',
    money: (verb: string) => `${verb} money`,
    moneyBlurb: 'Goes wherever the family needs it most.',
    item: 'Bring something from the list',
    itemBlurb: 'Take one of the things still needed, or part of it.',
    earmark: (verb: string) => `${verb} money toward one thing`,
    earmarkBlurb: 'Put an amount against a specific need on the list.',
  },

  amount: {
    titlePublic: 'How much would you like to contribute?',
    titleHidden: 'How much would you like to give?',
    introPublic:
      'Any amount helps. Your name and amount show on the strand unless you choose otherwise.',
    introHidden: 'Any amount helps. The family sees the total, not who gave what.',
    label: 'Amount',
    /** M1-03: parseMoney refuses "1,234" as ambiguous, so the shape is shown
     * from the start and most people never meet the error. */
    placeholder: 'R1 234,56',
    help: 'Rands and cents, like R1 234,56.',
    submit: 'Continue',
  },

  who: {
    title: 'Who should we say this is from?',
    introPublic: 'So the couple knows who contributed. Only your name is needed.',
    introHidden: 'So the family knows who stood with them. Only your name is needed.',
    nameLabel: 'Your name',
    namePlaceholder: 'e.g. Thandi Ngcobo',
    phoneLabel: 'Your number (optional)',
    phoneHelp: 'Only so the family can thank you. It is never shown on the page.',
    messageLabel: 'A message for the family (optional)',
    visibilityLabel: 'What the page shows',
    visibilityPublic: 'My name and what I gave',
    visibilityNameOnly: 'My name only',
    visibilityAnonymous: 'Quietly — neither',
    visibilityFoot: 'The family always sees the full record, whatever you choose here.',
    submit: 'Continue',
  },

  pay: {
    title: 'Pay from your banking app',
    intro:
      'Open your bank or PayShap, send the amount to this number with this reference, then come back and tell us.',
    numberStep: 'Step 1 · PayShap number',
    referenceStep: 'Step 2 · Reference',
    amountStep: 'Step 3 · Amount',
    referenceHelp:
      'Capital letters or small, it does not matter. There is no letter O and no zero in this code.',
    copyNumber: 'Copy the number',
    copyReference: 'Copy the reference',
    copied: 'Copied',
    foot: 'Nothing is taken from you here. You send it yourself, from your own app. If you close this page the reference stays valid for fourteen days.',
    submit: "I've paid",

    /**
     * Shown when the organiser has not given us a number yet. Honest about
     * what cannot happen rather than showing a blank where a payment number
     * belongs — somebody paying the wrong account is not recoverable.
     */
    noNumberTitle: 'This page cannot take money yet',
    noNumberBody:
      'The family has not added the number people should pay into. Nothing is wrong with the page — it is simply not finished. You can still bring something from the list.',
  },

  done: {
    title: 'Thank you',
    body: 'Your bead is on the strand. The family will see it when they open the page.',
    foot: 'You can close this page. Nothing else is needed from you.',
    pending:
      'The family will confirm it against their own bank notification. Nothing else is needed from you.',
  },

  errors: {
    amount: 'Enter an amount, like R1 234,56.',
    name: 'Enter the name the family should see.',
    'too-many-phone':
      'That is several payments reported from one number in a short time. Wait a few minutes.',
    'too-many-address':
      'That is a lot of reports from one place. Wait a few minutes and try again.',
    'cross-site': 'That request did not come from this page.',
    generic: 'That did not go through. Nothing was sent from your account.',
  },
} as const

export const payDetailsCopy = {
  title: 'How people pay you',
  intro:
    'Mode A: people pay you directly from their own banking app. Isipheko never holds the money, so this number is what a contributor sees on the pay screen.',
  numberLabel: 'Your PayShap number or cellphone number',
  numberHelp: 'The number people can send money to from their banking app.',
  nameLabel: 'The name on that account',
  nameHelp:
    'Shown beside the number so a contributor can check it matches before they send anything.',
  submit: 'Save',
  saved: 'Saved. Your page can take contributions now.',
  missing:
    'Until this is filled in, the pay step tells contributors the page is not finished.',
} as const
