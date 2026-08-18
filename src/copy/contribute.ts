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

    photoLabel: 'A photo (optional)',
    photoHelp: 'Only if you have one to hand. JPEG, PNG or WebP, up to 8MB.',
    /**
     * Rule: security copy explains what it protects, never just what it blocks.
     *
     * The thing being protected is an address. A phone writes the place a photo
     * was taken inside the file itself, and on a funeral that place is the
     * family's house — so this says what is taken out and why, in the words
     * somebody would use for it.
     */
    photoSafety:
      'Phones save the place a photo was taken inside the file. We take that out before it is stored, so the page never carries the family\u2019s address or yours.',
    photoAttached: 'Photo added.',
    photoRemove: 'Remove the photo',
    /**
     * Shown only once a photo is attached, because it is only then a real
     * conflict. It states the fact and leaves the choice alone: it is her photo.
     */
    photoAnonymousNote:
      'Your photo shows on the page whichever of these you choose. Only your name and what you gave follow this setting.',
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
    /**
     * **Accurate about confirmation.**
     *
     * This said the bead was already on the strand. It is not: a ledger entry
     * is written when the organiser confirms the payment against her own bank
     * notification, and the strand and the album are both read from the chain
     * (M4-02). A screen that says the record already holds you, when the record
     * does not, is the same shape of dishonesty as a held-balance figure.
     */
    body: 'Your contribution is with the family. It joins the record when they confirm it.',
    foot: 'You can close this page. Nothing else is needed from you.',
    pending:
      'The family will confirm it against their own bank notification. Nothing else is needed from you.',
    photoCaption: 'Your photo joins the record with it.',
    photoAnonymous:
      'You chose to give quietly, and your photo still shows. Your name and what you gave are the parts that stay off the page.',
  },

  errors: {
    amount: 'Enter an amount, like R1 234,56.',
    name: 'Enter the name the family should see.',
    'too-many-phone':
      'That is several payments reported from one number in a short time. Wait a few minutes.',
    'too-many-address':
      'That is a lot of reports from one place. Wait a few minutes and try again.',
    'cross-site': 'That request did not come from this page.',
    'photo-empty': 'No photo came through. Choose the file again, or carry on without one.',
    'photo-too-big':
      'That photo is over 8MB. Choose a smaller one, or carry on without a photo \u2014 everything else you typed is still here.',
    'photo-heic':
      'That is an iPhone photo in a format we cannot read. Send it through WhatsApp or Photos first, which turns it into a JPEG, or carry on without a photo.',
    'photo-not-an-image':
      'That file is not a photo we can read. JPEG, PNG and WebP work.',
    'photo-unreadable':
      'That photo did not come through in one piece. Choose it again.',
    'photo-too-large-request':
      'That was too large to send. Choose a smaller photo, or carry on without one.',
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
