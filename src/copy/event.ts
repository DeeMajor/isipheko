import type { ArchetypeKey } from '@/domain/archetype'

/**
 * The public event page, taken from `design/event.html` (CLAUDE.md rule 11).
 *
 * **Two strings in the prototype are not true yet and are not shipped as
 * written.** Both are recorded in docs/decisions.md M1-08:
 *
 * 1. The prototype's trust panel says *"Money you send goes to a held Isipheko
 *    account for this ceremony, never to a personal account."* That describes
 *    Mode B, which is gated on a legal opinion (architecture §15 item 1) and
 *    does not exist. Today the organiser is paid directly. Saying otherwise on
 *    the page a contributor reads before paying would be the one dishonest
 *    thing in an otherwise honest product.
 *
 * 2. The prototype shows *"Organiser's ID verified by Isipheko on 12 July"*.
 *    That was refused at M1-08 because nothing was verified. **M3-01 built the
 *    check and M3-02 made it required before publishing**, so it is true now and
 *    it renders — with the date, above the fold.
 *
 *    The unverified wording stays and is not dead code. A published event
 *    implies a verified organiser today, so it should never render; the page
 *    reads the live status rather than assuming, because a page that assumes
 *    will eventually assert something false.
 */

export interface ArchetypeEventCopy {
  readonly needsIntro: string
  readonly strandHeading: string
}

export const archetypeEventCopy: Record<ArchetypeKey, ArchetypeEventCopy> = {
  umshado: {
    needsIntro:
      'You can bring the thing itself, or contribute money toward it. Both count the same. Claim something and it is held for you, so nobody arrives with a second one.',
    strandHeading: 'Who has contributed',
  },
  umembeso: {
    needsIntro:
      'You can bring the thing itself, or contribute money toward it. Both count the same. Claim something and it is held for you, so nobody arrives with a second one.',
    strandHeading: 'Who has contributed',
  },
  umngcwabo: {
    needsIntro:
      'You can bring the thing itself, or put money toward it. Both count the same. Claim something and it is held for you, so nobody arrives with a second one.',
    strandHeading: 'Who has stood with the family',
  },
  umbuyiso: {
    needsIntro:
      'You can bring the thing itself, or put money toward it. Both count the same. Claim something and it is held for you, so nobody arrives with a second one.',
    strandHeading: 'Who has stood with the family',
  },
  imbeleko: {
    needsIntro:
      'You can bring the thing itself, or contribute money toward it. Both count the same. Claim something and it is held for you, so nobody arrives with a second one.',
    strandHeading: 'Who has contributed',
  },
  graduation: {
    needsIntro:
      'You can bring the thing itself, or contribute money toward it. Both count the same. Claim something and it is held for you, so nobody arrives with a second one.',
    strandHeading: 'Who has contributed',
  },
  itiye: {
    needsIntro:
      'You can bring the thing itself, or contribute money toward it. Both count the same. Claim something and it is held for you, so nobody arrives with a second one.',
    strandHeading: 'Who has contributed',
  },
}

export const eventCopy = {
  needs: {
    heading: "What's needed",
  },

  strand: {
    /** Shown until somebody has been recorded. Empty states invite an action. */
    empty: 'Nobody has been recorded here yet.',

    /** Verbatim from `design/event.html`, identical across its two variants. */
    intro:
      'Filled beads are money. Open beads with a bar are something brought. A ringed bead is a group who gave together — one bead, however many people are inside it. Tap any of them.',

    /**
     * A bead for somebody who gave quietly. Not "Anonymous" — that reads as a
     * status, and this is a person who chose to stand at the back.
     */
    quietly: 'Someone',

    money: 'Money',
    bringing: (what: string) => `Bringing ${what}`,
    together: (people: number) => `${String(people)} together`,
    /** Rule 14: one bead per collection, and the panel says so in words. */
    membersLabel: (people: number) => `${String(people)} people, one bead`,
    groupMeta: (what: string) => `One collection · ${what}`,

    when: (days: number) => {
      if (days === 0) return 'just now'

      return days === 1 ? '1 day ago' : `${String(days)} days ago`
    },

    close: 'Close',
    /** The accessible name of a bead, which is the person and what they did. */
    beadLabel: (who: string, what: string) => `${who} — ${what}`,
  },

  organiser: {
    by: (name: string) => `Organised by ${name}`,
    /**
     * Above the fold, under the organiser's name, with the date on it. Short
     * because it sits in the header; the full sentence is in the trust panel
     * for anybody who came looking for it.
     */
    badge: (when: string) => `ID verified ${when}`,
    /** For a screen reader, where a tick on its own says nothing. */
    badgeLabel: (name: string, when: string) =>
      `${name}'s identity was verified on ${when}`,
    /**
     * What the page says when nobody has been checked. A badge nobody earned is
     * worth less than no badge and costs more, so this is what renders instead —
     * and it should now be unreachable on a published page, because publishing
     * requires the check (M3-02). Kept because the page reads the status rather
     * than assuming it.
     */
    unverified:
      'This organiser has not been verified yet. Ask someone you already know before you give.',
    verified: (name: string, when: string) =>
      `${name}'s South African ID was verified against the Home Affairs record on ${when}.`,
  },

  safety: {
    line: 'Isipheko will never ask for your PIN, OTP or card details.',
    check: 'How to check this yourself',
    /**
     * The compact panel carried through the contribution flow (M3-04).
     *
     * The full panel lives on the event page, and somebody in the middle of
     * paying has navigated away from it — which is precisely the moment they
     * are looking at a phone number they are about to send money to. So the two
     * sentences that matter most travel with them, and the address is here in
     * full because that is the one they should type.
     */
    stillReal: 'Not sure this is real?',
    stillRealBody:
      'Do not use a number on this page. If the page were fake, the number would be too. Type isipheko.co.za/check into your browser yourself and enter the code above.',
  },

  trust: {
    heading: 'Is this real?',
    intro:
      'A fair question. A link asking for money looks the same whether it is honest or not. Here is what we can tell you, and how to check it without taking our word for it.',

    checkedHeading: 'What Isipheko has checked',
    /**
     * True since M3-02. This line said "Nothing yet… that check is coming" from
     * M1-08 until the check existed and publishing required it.
     */
    checkedVerified: (name: string, when: string) =>
      `${name}'s South African ID was checked against the Home Affairs record on ${when}, and this page could not have been published without it.`,
    checkedNothing:
      'Nothing yet. We have not verified who set this page up, and we will say so here plainly until we have.',
    checkedNote:
      'It confirms who the organiser is. It does not, on its own, confirm the ceremony.',

    yourselfHeading: 'How to check this yourself',
    yourselfIntro:
      'Do not use a number on this page. If the page were fake, the number would be too. Check by a route that does not come from this link:',
    yourselfAsk:
      'Ask someone in the family you already know, on a number you already had.',
    yourselfSender: 'Ask whoever sent you this where they got it, and who they spoke to.',
    yourselfCheck: (code: string) =>
      `Type isipheko.co.za/check into your browser yourself and enter the code ${code}. Do not tap a link to get there.`,
    /**
     * The link, **under the instruction and never instead of it** (M3-04).
     *
     * The two are in tension and the tension is the point: on a fake page a link
     * to "check" goes wherever the faker wants, which is exactly what the
     * sentence above says. What settles it is that somebody determined to check
     * and given no link will search for it and land on whatever ranks — worse
     * than a link we control on a page that is genuine, which is nearly all of
     * them.
     *
     * **Labelled with the literal address**, not "check this event": a label
     * that shows where it goes teaches the shape of the real one, which is what
     * helps somebody recognise a fake later.
     */
    yourselfCheckLink: 'isipheko.co.za/check',

    neverHeading: 'What we will never ask you',
    /**
     * The prototype's version ends "Money you send goes to a held Isipheko
     * account for this ceremony, never to a personal account." That is Mode B
     * and it is not built. What is written here is what is true today.
     */
    neverBody:
      'Isipheko will never ask for your PIN, your OTP, your card number or your online banking password. Not by phone, not by WhatsApp, not on this page. Anyone who asks is not from Isipheko.',
    /**
     * **Ledger-only.** Nothing on this page takes a payment: the contributor
     * pays the organiser from their own banking app and comes back to say so,
     * so the sentence is the literal truth of what the page can do.
     */
    moneyBody:
      'Nothing on this page can take money from you yet. When contributing opens, you will be told exactly where your money goes before you send it.',
    /**
     * **Hosted, and the reason this string is keyed at all** (M5-02b).
     *
     * M5-02 built a checkout reachable from this page. The sentence above then
     * became false on a hosted event — in the panel that exists to be believed,
     * on the screen before the one that takes the money, read by a stranger
     * deciding whether this is a scam. `src/ui/public-page.tsx` had no mode to
     * branch on and rendered it unconditionally.
     *
     * What replaces it says where the money actually goes, because that is what
     * the sentence was promising to tell somebody later. It goes to the family's
     * own account through a licensed payment service; **Isipheko never holds
     * it**, which is the same fact `collectionCopy` states for a collection and
     * the same one M5-03 §7 put on the dashboard.
     *
     * **No timetable is promised.** When it reaches the family is a settlement
     * question nobody has answered (docs/remaining-work.md A1), and a page that
     * says "within two days" would be inventing one.
     */
    moneyBodyHosted:
      'You can contribute on this page. Your money goes to the family’s own bank account through a licensed payment service — Isipheko never holds it and cannot take it out. You will see exactly what you are sending before you send it.',

    wrongHeading: 'If something looks wrong',
    /**
     * **Half of the prototype's sentence is now true and half never will be.**
     *
     * It promised *"Report the page from isipheko.co.za and we will hold every
     * payment on it until a person has looked."* M3-04 removed both halves
     * because neither was true. M3-06 built the report channel, so the first
     * half is restored — with the window on it, which is the part that matters
     * given that 57% of people who report a scam hear nothing back.
     *
     * The payment hold stays out. **No payment passes through us to hold**: the
     * organiser is paid directly (Mode A), and Mode B is gated on the legal
     * opinion (§15 item 1). Restoring that half would be the M1-08 §5 failure on
     * the panel that exists to be believed.
     *
     * Typed instruction primary, link beneath, labelled with the address — the
     * same discipline as `/check` (M3-04 §2).
     */
    wrongBody:
      'Then do not give anything. Nothing is owed by opening this, and you can stop at any point. If you think this page is not what it says it is, tell us — type isipheko.co.za/report into your browser yourself, and a person will look at it within one working day.',
  },

  footer:
    'Isipheko · from ukupheka, to cook. People have always arrived with something. This is only the door.',

  notFound: {
    title: 'That page is not here',
    body: 'The link may be wrong, or the family may not have shared it yet. Ask whoever sent it to you.',
  },
} as const
