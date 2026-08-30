import type { ArchetypeKey } from '@/domain/archetype'

/**
 * Setting up an umcimbi. Strings taken verbatim from `design/setup.html`
 * (CLAUDE.md rule 11 — nothing user-facing is inlined in a component).
 *
 * The per-archetype half is keyed by `ArchetypeKey` because the words genuinely
 * change: *"Her name, or his name"* on a funeral is *"Whose wedding"* on a
 * wedding, and *"The person being buried. Being named is part of it."* is not a
 * sentence that belongs anywhere else.
 */

export interface ArchetypeSetupCopy {
  /** "Wedding", "Funeral" — the word on the choice card. */
  readonly title: string
  /** "Umshado", "Umngcwabo" — the isiZulu word beneath it. */
  readonly zulu: string
  /** "Lindiwe & Sipho" — what the consequence preview shows as a sample. */
  readonly sampleTitle: string
  readonly detailsTitle: string
  readonly nameLabel: string
  readonly nameHelp: string
  readonly namePlaceholder: string
  readonly secondNameLabel: string
  readonly secondNamePlaceholder: string
  readonly dateHelp: string
}

export const archetypeSetupCopy: Record<ArchetypeKey, ArchetypeSetupCopy> = {
  umshado: {
    title: 'Wedding',
    zulu: 'Umshado',
    sampleTitle: 'Lindiwe & Sipho',
    detailsTitle: 'The wedding',
    nameLabel: 'Whose wedding',
    nameHelp: 'Both names, as people say them.',
    namePlaceholder: 'e.g. Lindiwe',
    secondNameLabel: 'And',
    secondNamePlaceholder: 'e.g. Sipho',
    dateHelp: 'The day of the ceremony.',
  },

  // No prototype entry. Union group, so it follows umshado's shape; the
  // wording is the smallest change that makes sense for a gift-giving
  // ceremony, and Part D should review it with the rest of the copy.
  umembeso: {
    title: 'Umembeso',
    zulu: 'Umembeso',
    sampleTitle: 'The Ngcobo umembeso',
    detailsTitle: 'The umembeso',
    nameLabel: 'Whose umembeso',
    nameHelp: 'Both names, as people say them.',
    namePlaceholder: 'e.g. Lindiwe',
    secondNameLabel: 'And',
    secondNamePlaceholder: 'e.g. Sipho',
    dateHelp: 'The day of the ceremony.',
  },

  umngcwabo: {
    title: 'Funeral',
    zulu: 'Umngcwabo',
    sampleTitle: 'Nokuthula Mthembu',
    detailsTitle: 'About her, or him',
    nameLabel: 'Her name, or his name',
    nameHelp: 'The person being buried. Being named is part of it.',
    namePlaceholder: 'e.g. Nokuthula Mthembu',
    secondNameLabel: 'Clan name',
    secondNamePlaceholder: 'e.g. uMaZondi',
    dateHelp: 'If the day is not settled yet, put your best guess and change it later.',
  },

  umbuyiso: {
    title: 'Unveiling',
    zulu: 'Umbuyiso',
    sampleTitle: "MaZondi's stone",
    detailsTitle: 'The unveiling',
    nameLabel: 'Whose stone',
    nameHelp: 'The person being remembered.',
    namePlaceholder: 'e.g. Nokuthula Mthembu',
    secondNameLabel: 'Clan name',
    secondNamePlaceholder: 'e.g. uMaZondi',
    dateHelp: 'Usually a year or more after the funeral.',
  },

  imbeleko: {
    title: 'Welcoming a child',
    zulu: 'Imbeleko',
    sampleTitle: 'Baby Ayanda',
    detailsTitle: 'The imbeleko',
    nameLabel: "The child's name",
    nameHelp: 'You can leave this until the day if the name is not given yet.',
    namePlaceholder: 'e.g. Ayanda',
    secondNameLabel: 'Family name',
    secondNamePlaceholder: 'e.g. Ngcobo',
    dateHelp: 'The day of the ceremony.',
  },

  graduation: {
    title: 'Celebration',
    zulu: 'Umgidi',
    sampleTitle: "Zanele's graduation",
    detailsTitle: 'The celebration',
    nameLabel: 'What are we celebrating',
    nameHelp: 'In the words you would use to tell someone.',
    namePlaceholder: "e.g. Zanele's graduation",
    secondNameLabel: 'Whose',
    secondNamePlaceholder: 'e.g. Zanele Dlamini',
    dateHelp: 'The day of the party.',
  },

  itiye: {
    title: 'Gathering',
    zulu: 'Itiye',
    sampleTitle: 'Mthembu family gathering',
    detailsTitle: 'The gathering',
    nameLabel: 'What to call it',
    nameHelp: 'Whatever the family already calls it.',
    namePlaceholder: 'e.g. Mthembu family gathering',
    secondNameLabel: 'Which family',
    secondNamePlaceholder: 'e.g. Mthembu',
    dateHelp: 'The day everyone comes together.',
  },
}

export const setupCopy = {
  kind: {
    title: 'What are you setting up?',
    intro:
      'The page changes to suit it — the words, the colour, and what it does and does not show.',
    /**
     * This said "You can change this later" for four milestones, and no screen
     * ever offered the change (UX-07). Changing the kind of a live event
     * re-keys its copy, its colour, its visibility default and the bereavement
     * guards, and is deliberately not offered — so the honest sentence is that
     * this is the one choice that stays, said where the choice is made. The
     * consequence preview below it is what makes choosing carefully possible.
     */
    foot: 'Everything else can be changed later. This one choice cannot, so take a moment with it.',
    submit: (title: string) => `Continue with ${title.toLowerCase()}`,
    submitEmpty: 'Choose one to continue',
    consequenceTitle: 'What this means',
  },

  details: {
    intro: 'Three things, and you can change any of them later.',
    organiserNameLabel: 'Your name',
    organiserNameHelp:
      'The name people know you by. It appears on the page as the person arranging this.',
    organiserNamePlaceholder: 'e.g. Nomsa Mthembu',
    optional: 'Optional',
    dateLabel: 'Which day',
    placeLabel: 'Where',
    placePlaceholder: 'e.g. KwaMashu, KwaZulu-Natal',
    placeHelp: 'The area is enough. You do not have to put the street on a public page.',
    submit: 'Continue',
    /** The edit screen's own button (UX-07): the action names what it does. */
    saveChanges: 'Save the changes',
    /**
     * The refusal of an empty name, in this step's own words (UX-07). The
     * first version of the details screen rendered `needs.empty` — "Add at
     * least one thing to carry on" — under the title field, which is the
     * needs step's sentence about a different problem.
     */
    noTitle: 'It needs a name to carry on. Nothing else is required yet.',
    footNamed: 'Nothing is public yet.',
    footUnnamed: 'The name is the only thing needed to carry on.',
    /**
     * The edit screen on a published page (UX-07). The link preview minting a
     * new card is M2-07 §2's machinery finally doing the job it was built for.
     */
    footPublished:
      'This page is live. What you change here shows the moment you save it, and the link preview updates itself for the next person to receive it.',
  },

  needs: {
    title: "What's needed",
    introHidden:
      'We have started this from what families usually need. Change what is wrong, take out what you do not need, add what we have missed. You do not have to think of it all yourself.',
    introPublic:
      'We have started this from what is usually needed. Change anything, remove anything, add what we have missed.',
    labelAria: 'What is needed',
    noteAria: 'How much is needed',
    notePlaceholder: 'How much, or how many',
    templateNote: 'Suggested — edit or remove it',
    remove: 'Remove',
    add: 'Add something else',
    submit: 'Continue',
    foot: 'People can bring the thing itself or put money toward it. You do not choose that for them.',
    footNote: 'Nothing is public yet. You can add to this list any time.',
    empty: 'Add at least one thing to carry on.',
    /**
     * A note with nothing it belongs to (UX-08). The row used to be filtered
     * out with the blanks, silently — somebody who typed the note first and
     * tapped "Add something else" lost it with no sign anything happened. A
     * need item is its label, so the note still cannot be kept on its own;
     * the refusal is explicit instead.
     */
    unlabelled:
      'One row had a note and nothing it belongs to, so it has not been kept. Put the thing in the empty row below, then its note.',
    /**
     * A removed row with a live claim stays (UX-03). Taking it off the list
     * would take somebody's promise off the record — the claim, with its
     * message and photograph, is deleted with the row and cannot be got back.
     * The way through is UX-05's release, on the umcimbi screen, which only
     * exists for a claim that has not arrived: something already brought stays
     * on the record.
     */
    claimed: (label: string) =>
      `${label} stays on the list — somebody has claimed it or already brought it, and taking it off would take their name off the record. Everything else you changed has been saved. A claim that is no longer coming can be released from your umcimbi screen; something already brought stays.`,
  },

  witnesses: {
    title: 'Who stands with you?',
    lead: 'Ask one or two people to stand with you as abakhaphi. Their names go on the page beside yours.',
    body: "Being asked to witness a family's umcimbi is not a small thing — it says you trust them with the family's business. Most people are honoured to be asked. Pick the ones the family would nod at.",
    ordinals: ['First umkhaphi', 'Second umkhaphi', 'Third umkhaphi'],
    nameLabel: 'Their name',
    phoneLabel: 'Their number',
    firstHint: 'Often an elder, an aunt, or the person the family already turns to.',
    laterHint: 'Someone in another household, so it is not all one roof.',
    add: 'Ask someone else too',
    addThird: 'Ask a third person',
    remove: 'Remove',
    /** The dashboard's card title, inlined in that component until M1-10. */
    heading: 'Abakhaphi',
    /** Its empty state, inlined in the same place. */
    noneAsked: 'Nobody has been asked yet.',

    askTitle: 'What they will be asked',
    /**
     * **The quote is verbatim from `design/setup.html` and is the invite page's
     * own words** — `tests/unit/witness.test.ts` asserts the two agree, so the
     * promise made here and the question actually asked cannot drift.
     *
     * The frame around it changed in M3-03. It used to open *"We send them one
     * message: …"*, which was future tense while nothing could be sent and
     * became false the moment there was a link: **we send nothing**, and she
     * passes it on herself, the way she does the handover link (M2-11 §7). Same
     * class of correction as M1-08 §5.
     */
    askQuote: (organiser: string, kicker: string, title: string) =>
      `${organiser} is arranging ${kicker.toLowerCase()} for ${title}, and has asked you to stand with them as umkhaphi. Will you?`,
    askBody:
      'You get a link for each of them to send however you already talk — WhatsApp, a message, or in person with the phone in your hand. Nothing goes out from us. This is what the link asks them:',
    askAfter:
      'If they say yes, their name goes on the page beside yours, and money only moves when one of them agrees with you. Nothing else is asked of them.',
    submit: 'Continue',
    foot: 'They are asked, not added. Nothing goes out until they agree.',
    empty: 'Add someone to continue.',
    /**
     * A named person with a number that does not parse (UX-08). The row used
     * to vanish silently on save. It still cannot be kept — a witness with no
     * reachable number can never be asked — so the refusal names them and
     * says what to do. The number itself is not echoed back: it was wrong,
     * and repeating a wrong number teaches nothing the field cannot.
     */
    badPhone: (name: string) =>
      `${name}'s number does not look like a South African cellphone number, so they have not been added yet. Check the number and add them again below.`,

    /** The organiser's own view of who has answered (M3-03). The heading was
     *  inlined in the step until UX-16's widened scan caught it. */
    askedHeading: 'Who you have asked',
    statusInvited: 'Not answered yet',
    statusAccepted: 'Said yes',
    statusDeclined: 'Said no',
    ask: (firstName: string) => `Get a link for ${firstName}`,
    linkLabel: (firstName: string) => `The link for ${firstName}`,
    linkNote:
      'Send it to them however you normally would. It works once, and it lasts a month.',
    declinedNote:
      'They said no, which people do, and it is not a small thing to have been asked. Remove them and ask somebody else if you want a second name on the page.',
  },

  verify: {
    title: 'One check, then you can share it',
    lead: 'Before we let a single person be asked for money, your name has to be confirmed. Not because we doubt you — because the people you are about to send this to have every reason to doubt a link.',
    body: 'Scam pages look exactly like real ones. The one thing a scammer will not do is put a verified name against it. That badge is what lets your aunt give without phoning three people first.',
    checkTitle: 'What we check',
    checks: [
      'That the ID number you give belongs to you, against the Home Affairs record.',
      'Nothing about your money, your bank, or your credit record. We do not look and we cannot see it.',
      'Your name and the date of the check are what appears on the page. The number never does.',
    ],
    whyTitle: 'Why this one cannot be skipped',
    why: [
      'Anyone can make a page in ten minutes. If we let unverified pages ask for money, the fastest people to use Isipheko would be the ones taking it — and within a month nobody would trust a link with our name on it, including yours.',
      'The badge is not for us. It is the answer to the question your relatives will ask each other before they give: is this really Nomsa? Without it, every one of them has to phone someone to find out, and the ones who cannot reach anyone simply do not give.',
      'It is also your protection. If someone later copies this page to their own account, the verified name is what shows theirs is the fake one.',
    ],
    whyClose:
      'You can build the whole page without it — the list, the abakhaphi, the wording. This is only asked at the last step, before the first person is asked for anything.',
    idNote:
      'Your ID number is used once, for this check, and is never shown on the page or given to anyone who contributes.',
    /**
     * `notYet` and `notYetBody` — "the Home Affairs check is not switched on
     * yet" — were true at M1-07 and are false now that M3-01 has built it.
     * Removed rather than left sitting in the copy file, the same treatment
     * `eventCopy.needs.notYet` got in M2-04 §8.
     */
    submit: 'Continue to sharing',
  },

  share: {
    title: "It's ready. Send it.",
    /*
     * **There is no `intro` here, and its absence is the point** (M1-10).
     *
     * This block used to carry one, word for word the verified sentence
     * `shareCopy` withholds until an organiser actually is verified — and it
     * said it unconditionally, with nothing reading `organiserVerified`. It was
     * never rendered, so it never lied to anybody; it was one import away from
     * doing so, in the file somebody would reach for first.
     *
     * The share step's words are `shareCopy.intro` and `shareCopy.introVerified`,
     * chosen on the badge. One sentence, one place, one condition.
     */
    publish: 'Publish and get the link',
    linkLabel: 'The link to your page',
    copy: 'Copy link',
    view: 'Open the page',
    draftNote: 'Nothing is public until you publish.',
  },

  blockers: {
    'already-published': 'This umcimbi is already published.',
    'no-title': 'It needs a name before it can go anywhere.',
    'no-needs': 'Add at least one thing that is needed, then you can publish.',
    'no-witnesses': 'Ask at least one person to stand with you, then you can publish.',
    /**
     * The gate M3-02 added. It says what to do next rather than what is wrong:
     * the check takes under a minute and the button beside this goes straight
     * to it.
     */
    'not-verified':
      'One thing left: your name has to be confirmed before anybody can be asked for money. It takes under a minute and you only do it once.',
  },

  /**
   * The disclosure beside the blocked publish button.
   *
   * A question, answered where it is asked, rather than a screen she has to
   * come back from — and the answer is `verify.why`, which explains rather than
   * demands. A native `<details>`, so it costs no JavaScript.
   */
  whyNotSkip: "Why can't I skip this?",
  verifyNow: 'Confirm it is you',
} as const
