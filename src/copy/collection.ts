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
    `${organiserName} is collecting this herself, into her own account. Isipheko does not hold it, does not move it, and cannot refund it. You are trusting her, the way you would if she asked you in person.`,

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
    lead: 'One of you who is standing there confirms it. Not the family — they are burying their mother and have nothing to do in here.',
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
     * The photo the design offers is not built. Evidence upload needs M4-01's
     * EXIF stripping, and a JPEG straight off a phone carries the GPS of the
     * house it was taken at — on a funeral handover, the family's address. It
     * attaches in M4-01 to a record that already exists (docs/decisions.md
     * M2-11).
     */
    myselfNoPhoto:
      'A photo of the handover will be part of this later. For now the record carries your word and the day it happened.',

    witnessLead: 'Were you there when it was handed over?',
    witnessBody: (group: string, organiser: string) =>
      `${organiser} is handing over what ${group} put together. Tapping once says you were there when it happened.`,
    witnessConfirm: 'Yes, I was there',
    witnessDone: 'Thank you. The record is closed.',
    witnessDoneBody:
      'Your name is on it, beside the day. Nothing moved because of this tap and nothing else is needed from you.',

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
      `Marked handed over by ${organiser}, on her own word.`,
    acknowledged: 'The family confirmed it reached them.',
    notYet: 'Handover not yet confirmed.',
    quiet: 'Someone',
  },

  /** One bead, one act. Rule 14, said to whoever opens it. */
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
      'It goes into her own account and she hands it over on the day. We check that she is who she says she is, and we keep the record of who gave. We do not hold the money and we cannot get it back for you. You are trusting her, the way you would if she collected it in an envelope.',
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
      `${organiser}'s South African ID was verified against the Home Affairs record on ${when}. That is the only thing we can promise you about her.`,

    holdsHeading: 'Who holds the money',
    holdsBody: (organiser: string) =>
      `She does. It sits in her personal account until the handover. Isipheko never receives it, never holds it, and cannot refund it. If ${organiser} does not hand it over, that is a matter between her and you — the same as any collection at work or at church. We say this plainly because you are about to give money on the strength of a link.`,

    weGiveHeading: 'What we do give you',
    weGiveBody: 'Three things that an envelope on a desk does not:',
    weGive: [
      'A record of every name and amount, which she cannot quietly change.',
      'A handover confirmed by one of you who is actually there, not by her alone.',
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
      `Pay ${organiser} the way you already would — she is collecting it herself. Isipheko does not take it and cannot pass it on for you.`,
    handMissing:
      'The organiser has not said where to send it yet. Ask her before you send anything.',
    submit: "I've sent it",
    doneTitle: 'You are on the list',
    doneBody: (organiser: string) =>
      `${organiser} will mark it off when it reaches her. Your name goes on the record the family keeps, with everybody else's.`,
    errors: {
      amount: 'That amount is not one we can read. Try it like R250 or 250.',
      name: 'The group needs a name to put on the list.',
      'not-open': 'This collection is not taking anybody new right now.',
      'cross-site': 'That request did not come from this page.',
    },
  },
} as const
