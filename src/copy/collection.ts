import type { ArchetypeKey } from '../domain/archetype/index.ts'

/**
 * Collections, in words.
 *
 * **The honesty requirement is the whole of Part D2.6, and it is not
 * negotiable:** the collection organiser holds the money, not Isipheko. The
 * contributors are trusting her. Copy that implied otherwise would be the one
 * dishonest thing in an otherwise honest product — and it would be dishonest in
 * the direction that costs somebody money.
 *
 * So `holdsTheMoney` says it plainly, by name, wherever a member is about to
 * put money in, and a test asserts nothing here implies we hold, protect,
 * guarantee or refund anything.
 *
 * Keyed by archetype where the register differs, like every other copy module:
 * a collection for a funeral does not say "celebrate".
 */

export interface ArchetypeCollectionCopy {
  /** What this group is doing, in the register the occasion calls for. */
  readonly purposeLead: string
  /** The line under the group bead on a host event page. */
  readonly beadNote: string
}

const CELEBRATORY: ArchetypeCollectionCopy = {
  purposeLead: 'What are you putting together, and who for?',
  beadNote: 'A group who gave together — one bead, however many people are inside it.',
}

const BEREAVEMENT: ArchetypeCollectionCopy = {
  purposeLead: 'What are you putting together, and which family is it for?',
  beadNote: 'A group who stood together — one bead, however many people are inside it.',
}

export const archetypeCollectionCopy: Record<ArchetypeKey, ArchetypeCollectionCopy> = {
  umshado: CELEBRATORY,
  umembeso: CELEBRATORY,
  umngcwabo: BEREAVEMENT,
  umbuyiso: BEREAVEMENT,
  imbeleko: CELEBRATORY,
  graduation: CELEBRATORY,
  itiye: CELEBRATORY,
}

export const collectionCopy = {
  /**
   * Said where a member is deciding whether to put money in. Names her, so
   * there is no reading of it that leaves us holding anything.
   */
  holdsTheMoney: (organiserName: string) =>
    `${organiserName} is collecting this money personally, into their own account. Isipheko does not hold it, does not move it, and cannot refund it. You are trusting ${organiserName}, the way you would if they asked you in person.`,

  /** The same fact, for somebody reading the group's page rather than joining. */
  holdsTheMoneyShort: (organiserName: string) =>
    `${organiserName} holds this money, not Isipheko.`,

  /** What we do instead, said without overclaiming it. */
  whatWeDo:
    'What we keep is the record: who put in, what the group brought, and that it reached the family.',

  /**
   * The share gate (rule 13).
   *
   * The second half of this used to say the check was not switched on, which was
   * true until M3-01 built it and left her at a refusal with nothing to do about
   * it. It now says what to do — the gate is unchanged, and the way through it
   * exists.
   */
  shareBlocked:
    'This cannot be shared yet. A collection asks people you know for money in your name, so the link only exists once your identity has been checked. It takes under a minute and you only do it once.',

  /**
   * The same card, read against her actual status (UX-10). A verified
   * organiser used to come back from the check to the sentence above — "once
   * your identity has been checked", already done — beside a "Confirm it is
   * you" button she had already used, and had to guess that the quiet "try"
   * button was now the real one. The card branches on the status instead:
   * done is said as done, and one button does the one thing left.
   */
  shareReady:
    'Your name is confirmed. Nothing else stands between this group and a link.',
  shareGet: 'Get the link',
  /** The unverified card's honest ask — the button M2-10 §10 refused to hide. */
  shareTry: 'Try to get the link',

  /**
   * The handover (M2-11), from `design/collection.html`.
   *
   * The lines about who confirms it are verbatim. They carry the whole of Part
   * D2.4: the family has nothing to do in here, and the difference between a
   * witness's tap and the organiser's own word stays on the record.
   */
  handover: {
    /** Rule 15: the host does nothing in the system. */
    hostDoesNothing:
      'The family does not have to do anything here. Somebody who was there confirms it, and the record closes itself.',

    heading: 'Who confirms it',
    lead: 'One of you who is standing there confirms it. Not the family — the day is theirs to live through, and they have nothing to do in here.',
    body: 'Pick whoever will be present when you hand it over. They tap once, on their own phone, and the record closes with their name against it.',
    /** Nothing moves. It only closes the record — no money passes through us. */
    foot: 'Nothing moves because of this tap. It only closes the record.',
    ask: (firstName: string) => `Ask ${firstName} to confirm on the day`,
    choose: 'Choose who will be there',
    linkLabel: (firstName: string) => `${firstName}'s link`,
    linkNote:
      'Send this to them however you already talk. It works once, on their phone, and does nothing else.',

    myselfHeading: 'If nobody can tap it there',
    myselfBody:
      'Phones die and signal fails at gravesides. Mark it yourself — the record will say it was your word rather than a witness\u2019s, and that difference stays on it.',
    myselfLabel: 'Mark it myself',
    /**
     * **The photo, built at M4-01b** — the deferral M2-11 recorded and M4-01
     * made possible.
     *
     * It was withheld because a JPEG straight off a phone carries the GPS of
     * the house it was taken at, which on a funeral handover is the family's
     * address. M4-01's pipeline strips that, and this uses **that** pipeline
     * rather than a second one.
     *
     * Optional, and said so: she may have no signal, no camera, or nobody
     * willing to be photographed at a graveside. A photo makes her word carry
     * further; its absence is not a failure and the copy does not treat it as
     * one.
     */
    myselfPhotoLabel: 'A photograph, if you have one',
    myselfPhotoHelp:
      'The envelope, the group, the moment — whatever you have. We strip where and when it was taken before storing it, so a picture taken at the house does not carry the address with it. You can close the record without one.',
    myselfPhotoAttached:
      'Your photograph is on the record, beside your word and the day it happened.',

    witnessLead: 'Were you there when it was handed over?',
    witnessBody: (group: string, organiser: string) =>
      `${organiser} is handing over what ${group} put together. Tapping once says you were there when it happened.`,
    witnessConfirm: 'Yes, I was there',
    witnessDone: 'Thank you. The record is closed.',
    witnessDoneBody:
      'Your name is on it, beside the day. Nothing moved because of this tap and nothing else is needed from you.',

    /** The organiser's button that mints the family's optional link (UX-16). */
    hostAsk: 'Get a link for the family',

    hostHeading: 'Did it reach you?',
    hostBody: (group: string) =>
      `${group} say they have handed this over. If it reached you, you can say so in one tap — and if you would rather not, nothing depends on it.`,
    hostConfirm: 'Yes, it reached us',
    hostDone: 'Thank you. That is on the record now.',
    hostNote:
      'You were never required to do anything here. The record was already closed by the people who handed it over.',

    /** What the seal says once it is closed. */
    sealWitness: (name: string) => `Confirmed by ${name}`,
    sealOrganiser: 'Closed on your word',
    sealWitnessBody: (name: string, when: string) =>
      `${name} was there and confirmed it on ${when}. The record is closed and cannot be edited by anyone, including you.`,
    sealOrganiserBody:
      'You marked this yourself, and the record says so. It is worth less than a witness\u2019s tap, and anyone reading it later will see the difference.',
    /** The same sentence, where there is a photograph to say so about. */
    sealOrganiserWithPhotoBody:
      'You marked this yourself and attached a photograph, and the record says both. It is still your word rather than a witness\u2019s, and anyone reading it later will see that too.',

    errors: {
      expired: 'That link has run out. Ask whoever sent it for a new one.',
      'already-used': 'That link has already been used. The record is closed.',
      'not-found': 'That link is not one of ours.',
      'not-confirmable': 'There is nothing to confirm here.',
    },
  },

  /** The one page the group hands over with the money. */
  incwadi: {
    wordmark: 'Isipheko · incwadi',
    forLine: (forWhom: string) => `For ${forWhom}`,
    together: 'Together',
    print: 'Print the incwadi',
    printNote: 'One page. Print two if you want to keep one yourselves.',
    intro:
      'Print this and hand it over with the money. The family keeps it. Years later this page may be gone and the paper will not be.',
    collectedBy: (organiser: string) => `Collected by ${organiser}.`,
    verifiedOn: (when: string) => `ID verified by Isipheko ${when}.`,
    claimedItem: (item: string) =>
      `${item} was taken off the family's list by this group as one item.`,
    confirmedByWitness: (name: string) => `Handed over and witnessed by ${name}.`,
    confirmedByOrganiser: (organiser: string) =>
      `Marked handed over by ${organiser}, on their own word.`,
    acknowledged: 'The family confirmed it reached them.',
    notYet: 'Handover not yet confirmed.',
    quiet: 'Someone',
  },

  /** One bead, one act. Rule 14, said to whoever opens it. */
  /**
   * The organiser's two screens (M1-10).
   *
   * These were inlined in `collections/new/page.tsx` and
   * `collections/[id]/page.tsx` — card titles, field labels and four toasts —
   * and were found by the scan `tests/unit/copy-layer.test.ts` runs, not by
   * reading. Fourteen strings across three screens, where the plan's entry for
   * this task had named two.
   *
   * The organiser side of collections is deliberately plain (M2-10 §2), which
   * is why these are short. Plain is not a reason to keep them out of the
   * translation unit.
   */
  setup: {
    title: 'Start a collection',
    /** The line under the title (UX-16) — inlined until now. */
    intro: 'For when a group of you want to give together and hand over one thing.',
    cardTitle: 'What you are putting together',
    incomplete: 'It needs a name and an occasion before it can start.',
    start: 'Start it',

    occasionLabel: 'The occasion',
    occasionHelp: 'A collection always names one — it drives the words and the tone.',
    nameLabel: 'What the group is called',
    nameHelp: 'e.g. The Ngcobo cousins, or the office collection.',
    forWhomLabel: 'Who it is for',
    /**
     * Free text, and it must stay free text: the moment this is an account we
     * hold, verify or pay into, rule 12 is gone and the regulatory position
     * goes with it.
     */
    bankHintLabel: 'Where people should send it',
    bankHintHelp:
      'In your words — e.g. “Nomsa’s Capitec, ending 4471”. Isipheko never holds this money, so this is only so the group knows where to pay you.',
  },

  manage: {
    linkTitle: 'The link to send round',
    joinedTitle: 'Who has joined',
    nobodyJoined: 'Nobody has joined yet.',

    /**
     * The edit card (UX-09). The bank hint is the string members are told to
     * send money to, and until this card a typo in it was permanent. The
     * occasion is not on it: like an umcimbi's kind, it is the one choice
     * that stays.
     */
    detailsTitle: 'The details',
    detailsIntro:
      'The name, who it is for, and where people send the money. What you save here is what a member sees the moment they look.',
    detailsSave: 'Save the changes',
    detailsSaved: 'Saved. Anyone who opens it sees what you just typed.',
    detailsIncomplete: 'It needs a name. Everything else can be empty.',
    /** The seal's own rule, met at the edit rather than after it. */
    detailsClosed:
      'The record is closed and cannot be edited by anyone, including you. Nothing you typed just now was saved.',

    /** The mark-off list (UX-16) — all of it inlined until now. */
    joinedIntro:
      'Mark somebody off once their money has actually reached you. Only what you have marked counts toward what the family is told the group handed over.',
    itArrived: 'It arrived',
    stillToMark: (waiting: number) =>
      waiting === 1 ? 'One still to mark off.' : `${String(waiting)} still to mark off.`,
    /** The status words a member's row wears once it is not a button. */
    memberStatus: {
      confirmed: 'Arrived',
      withdrawn: 'Withdrew',
    } as Record<string, string>,

    /** What just happened, after a redirect. */
    markedArrived: 'Marked as arrived.',
    linkReady: 'The link is ready.',
    recordClosed: 'The record is closed.',
  },

  members: {
    label: (people: number) =>
      people === 1 ? '1 person, one bead' : `${String(people)} people, one bead`,
    quiet: 'Someone',
  },

  /**
   * The collection's own page (M2-10), taken from `design/collection.html`.
   *
   * The custody panel and the trust block are **verbatim**. They are the
   * sentences somebody reads immediately before deciding to give money to a
   * person on the strength of a link, and they are the ones rule 16 exists for.
   */
  page: {
    kicker: 'Collection',
    heldBy: (organiser: string) => `Held by ${organiser}`,
    /** Only ever rendered when it is true — never softened (M1-08 §5). */
    verifiedOn: (when: string) => `ID verified ${when}`,

    custodyTitle: (organiser: string) => `${organiser} holds this money, not Isipheko.`,
    custodyBody:
      'It goes into their own account and they hand it over on the day. We check that they are who they say they are, and we keep the record of who gave. You are trusting them, the way you would if they collected it in an envelope. We do not hold the money and we cannot get it back for you.',
    custodyLink: 'What that means for you',

    /**
     * **Why there is no button here, when there is one on an umcimbi** (M5-12).
     *
     * M5-02 built a checkout on event pages. Once a contributor has paid with a
     * card on one, *"why can't I do that here?"* is a question this page has to
     * answer — and if it does not, the silence reads as a page that is broken
     * rather than a page that is honest. That is the worst possible outcome for
     * the one screen whose entire job is being believed.
     *
     * **The asymmetry is real and correct, so it is explained rather than
     * hidden.** A card on an event page settles to the family's own account
     * through a licensed provider. A card here would mean us collecting money to
     * pass on to her — which is the activity rule 12 forbids, the question
     * docs/paystack-analysis.md §0.2 puts to a lawyer, and the thing that would
     * put a private individual inside a card-scheme aggregation clause.
     *
     * It says what the arrangement protects rather than what it blocks, and it
     * does not apologise: she holds it, which is the whole point, and it is why
     * nothing can be taken from anybody on this page.
     */
    custodyNoCard: (organiser: string) =>
      `There is no card payment on this page, and there will not be one. Money given here goes straight to ${organiser} — if it came through Isipheko first, we would be holding your money for somebody else, and that is exactly what we do not do. On a family's own umcimbi page you may see a card option, because there the money goes to the family's own account and never to ours.`,

    givingHeading: "What we're giving",
    claimedHeldByUs: 'Held by us',
    /** From the design: "Taken off the family's list as one item, by all eight
     * of us together." The count is the group's, so it is a parameter. */
    claimedBody: (people: number) =>
      `Taken off the list as one item, by all ${String(people)} of us together.`,
    /** Why it beats sending the cash — Part D2.5's argument, in one line. */
    claimedWhy:
      'Better than sending the money: nobody has to go and hire one in the week of the day itself.',
    restTitle: 'Whatever is left over',
    restBody: (forWhom: string) => `Goes to ${forWhom}.`,

    totalLabel: 'In so far',
    /**
     * The total counts what has actually reached her, and the roster lists
     * everybody who joined — so when those differ, the note says so rather than
     * leaving the group to wonder why four names add up to three amounts.
     */
    totalNote: (people: number, marked: number) => {
      const who = people === 1 ? '1 person' : `${String(people)} people`

      return marked === people ? who : `${who} · ${String(marked)} marked off so far`
    },
    /** Beside a member the organiser has not marked off yet. */
    notMarkedOff: 'Not marked off yet',

    membersHeading: (people: number) => `The ${String(people)} of us`,
    /** Attached: there is a host page, and this is what it will look like. */
    membersIntro: (organiser: string, forWhom: string, people: number) =>
      `Everyone here gave to ${organiser} directly. On ${forWhom}'s page this shows as one bead, not ${String(people)} — because it is one act.`,
    /**
     * Standalone: there is no host page to appear on, so the sentence does not
     * promise one. A collection with no event still knows its occasion (Part
     * D2.3) — what it does not have is somewhere to render a bead.
     */
    membersIntroStandalone: (organiser: string) =>
      `Everyone here gave to ${organiser} directly. What the group hands over is one act, and the record says so.`,

    joinLabel: 'Join this collection',
    joinNote: (organiser: string) =>
      `You pay ${organiser} the same way you would pay anyone — no account, no sign-up. Your name goes on the paper record the family keeps.`,

    /** Two different questions, answered separately and plainly. */
    trustHeading: 'Is this real, and who holds the money?',
    trustIntro: 'Two different questions. Here are both answers, plainly.',

    checkedHeading: 'Who Isipheko has checked',
    checkedBody: (organiser: string, when: string) =>
      `${organiser}'s South African ID was verified against the Home Affairs record on ${when}. That is the only thing we can promise you about ${organiser}.`,

    holdsHeading: 'Who holds the money',
    holdsBody: (organiser: string) =>
      `The organiser does. It sits in their personal account until the handover. Isipheko never receives it, never holds it, and cannot refund it. If ${organiser} does not hand it over, that is a matter between the two of you — the same as any collection at work or at church. We say this plainly because you are about to give money on the strength of a link.`,

    weGiveHeading: 'What we do give you',
    weGiveBody: 'Three things that an envelope on a desk does not:',
    weGive: [
      'A record of every name and amount, which the organiser cannot quietly change.',
      'A handover confirmed by one of you who is actually there, not by the organiser alone.',
      'A printed incwadi the family keeps, with every name on it.',
    ],

    occasionHeading: 'How to check the occasion itself',
    occasionBody: (code: string) =>
      `Do not use a number on this page. Ask someone in the family you already know, on a number you already had — or type isipheko.co.za/check into your browser yourself and enter ${code}.`,
    occasionBodyNoCode:
      'Do not use a number on this page. Ask someone in the family you already know, on a number you already had.',

    /** The report channel (M3-06), in the same posture as the event page's. */
    wrongHeading: 'If something looks wrong',
    wrongBody:
      'Then do not put anything in. If you think this is not what it says it is, tell us — type isipheko.co.za/report into your browser yourself, and a person will look at it within one working day.',
  },

  /** Joining, which is the contribution flow's shape and none of its money. */
  join: {
    title: 'Join this collection',
    /** The two step buttons and the way back (UX-16) — inlined in the join
     *  page until now, which kept them out of the translation unit. */
    continue: 'Continue',
    back: 'Back to the collection',
    amountLabel: 'How much are you putting in',
    amountHelp: 'Whatever you can. It shows on the list the group keeps.',
    amountPlaceholder: 'R1 234,56',
    nameLabel: 'Your name',
    nameHelp: 'This is what the family sees on the record.',
    phoneLabel: 'Your number (optional)',
    phoneHelp: 'Only so the organiser can reach you about the handover.',
    quietlyLabel: 'Show my name to the group',
    quietlyHelp:
      'The group always sees the amount — the total has to add up for them. Turning this off keeps your name off the record the family is given.',
    handTitle: (organiser: string) => `Send it to ${organiser}`,
    handBody: (organiser: string) =>
      `Pay ${organiser} the way you already would — they are collecting it personally. Isipheko does not take it and cannot pass it on for you.`,
    handMissing:
      'The organiser has not said where to send it yet. Ask them before you send anything.',
    submit: "I've sent it",
    doneTitle: 'You are on the list',
    doneBody: (organiser: string) =>
      `${organiser} will mark it off when it reaches them. Your name goes on the record the family keeps, with everybody else's.`,
    errors: {
      amount: 'That amount is not one we can read. Try it like R250 or 250.',
      name: 'The group needs a name to put on the list.',
      'not-open': 'This collection is not taking anybody new right now.',
      'cross-site': 'That request did not come from this page.',
    },
  },
} as const
