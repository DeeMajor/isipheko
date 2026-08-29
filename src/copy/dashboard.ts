import type { PayoutConditionId } from '@/domain/payout'

/**
 * The organiser's dashboard (M3-08), from `design/dashboard.html`.
 *
 * ## Three lines of the design are not shipped as written
 *
 * The reference screens are the copy source of truth, and this one contains
 * three things that are not true of what exists. All three would be copied
 * faithfully by somebody working from the file, which is why they are named
 * here as well as in docs/decisions.md M3-08 §2.
 *
 * 1. **The R1 test deposit.** *"Add your account and we send R1 to it. Tell us
 *    the reference on that R1."* Part F replaces the mechanism with Stitch BAV,
 *    which checks the account against the holder's verified name directly. The
 *    replacement remedy below is Part F's wording.
 * 2. **The countdown on a funeral.** The design's bereavement variant reads
 *    *"Saturday 15 August · KwaMashu · in 4 days"*. Rule 1 forbids countdowns
 *    on bereavement and `allowsCountdown` exists to say so — the tail is
 *    appended by the page only where the archetype permits it.
 * 3. **"Money sits in a held Isipheko account until you ask for it."** That is
 *    Mode B, which is gated on a legal opinion and is not built. Under Mode A
 *    the contributor pays the organiser directly and the money is already in
 *    her own account. What ships is below, and it says so plainly.
 *
 * ## The rule this screen is written against
 *
 * No figure here may be presented as a balance we hold or as an amount ready to
 * be paid out. An organiser who acts on a number this screen showed her — makes
 * a promise, buys something — has been failed in a way an apology does not fix.
 * Same discipline as M1-08 §5: true or absent, never softened.
 */

export const dashboardCopy = {
  /** The strip above the title, so a shared screenshot is not mistaken for the public page. */
  viewNote: 'Your view as organiser',

  /**
   * The way out to the page itself (UX-04). The dashboard is where an
   * organiser lands from her account screen, and until these existed the
   * public page and the share step were reachable from here only through a
   * bead or a bookmark — an organiser who lost the WhatsApp message had no way
   * to send her own link again.
   */
  links: {
    publicPage: 'Open the public page',
    shareAgain: 'Send the link again',
    finishSetup: 'Carry on setting it up',
    /** The screen UX-07 built — the "change any of them later" the setup flow
     *  always promised. */
    editDetails: 'Change the details',
  },

  /**
   * What just happened, after a redirect. Inlined in the dashboard component
   * until M1-10 — a toast is as user-facing as anything on the page.
   */
  toasts: {
    confirmed: 'Recorded on the ledger.',
    listUpdated: 'Your list has been updated.',
    /** Echoes the contributor side's own words (`needsCopy.undoneBody`). */
    released: 'Put back on the list. Somebody else can take it now.',
    /** After the details edit (UX-07). The card versioning does the rest. */
    detailsSaved: 'Saved. The page shows it now.',
  },

  queue: {
    heading: 'Waiting for you',
    /** Counts read better as words at the low end, where most events live. */
    intro: (waiting: number) =>
      waiting === 1
        ? 'One person has told us something. '
        : `${String(waiting)} people have told us something. `,
    tail: 'Check each against your own bank message, then say yes. It is the only thing on this page that needs you today.',

    paymentTag: 'Says they paid',
    deliveryTag: 'Bringing something',

    saidTheySent: (who: string, amount: string) => `${who} says they sent ${amount}`,
    isBringing: (who: string, what: string) => `${who} is bringing the ${what}`,
    reference: (code: string) => `Reference ${code}`,

    /**
     * What to look for in her own banking app. The whole confirmation model
     * rests on her checking rather than trusting the screen — Mode A has no
     * payment rail, so this page knows only what somebody typed into it.
     */
    checkAgainst: (amount: string, who: string, code: string) =>
      `Look for ${amount} from ${who} with reference ${code}. It usually shows within ten minutes.`,

    confirmPayment: "Yes, it's in my account",
    confirmDelivery: 'It has arrived',

    /**
     * There is no unconfirm. Said here, before the tap, rather than discovered
     * after it — a correction is a reversal entry (rule 3) and that is a
     * different thing from an undo.
     */
    confirmNote:
      'Once you say yes it is on the record. A mistake is corrected by adding a correction, not by rubbing it out — so check the amount before you tap.',

    empty: {
      heading: 'Nothing is waiting for you',
      body: 'Everything people have told us about has been checked off. You can put the phone down.',
    },
  },

  board: {
    heading: 'Where things stand',
    intro: (settled: number, total: number, outstanding: number) =>
      `${String(settled)} of the ${String(total)} things on your list are settled. These are the ${String(outstanding)} that are not.`,
    allSettled: 'Everything on your list has arrived. Nothing here needs you.',
    emptyList:
      'There is nothing on your list yet. You can add what the family needs from the setup steps.',

    open: {
      title: 'Nobody has taken this',
      note: 'The only part of the list still completely open.',
    },
    promised: {
      title: 'Promised, not yet here',
      note: 'Held in someone’s name. Mark them off as they arrive — or release one that is no longer coming, and it goes back on the list for somebody else.',
    },
    arrived: {
      title: 'Here already',
      note: 'Nothing more needed on these.',
    },
    /**
     * Built in M2-04 and unreachable until now: a contributor could suggest
     * something the family forgot and no organiser could ever see it.
     */
    suggested: {
      title: 'Someone suggested this',
      note: 'Not on your list until you say so, and not shown to anybody else until then.',
    },

    countOf: (n: number) => (n === 1 ? '1 thing' : `${String(n)} things`),
    partly: (claimed: number, required: number, label: string) =>
      `${String(claimed)} of ${String(required)} ${label.toLowerCase()} taken · ${String(required - claimed)} still needed`,
    heldBy: (who: string) => `Promised by ${who}`,
    arrivedFrom: (who: string) => `Brought by ${who}`,
    nobody: 'Nobody has taken this yet',
    suggestedBy: (who: string) => `Suggested by ${who}`,

    markArrived: 'Mark as arrived',
    /**
     * The control `needsCopy.tooLateBody` always promised (UX-05). Quiet,
     * beside "Mark as arrived", because the ordinary answer to a promise is
     * that it arrives; the group note above the rows says when to use it.
     */
    release: 'Release it back to the list',
    addToList: 'Add it to the list',
    leaveOff: 'Leave it off',
  },

  record: {
    heading: 'The record',
    intro:
      'Every bead is one person. Filled beads are money, open beads are something brought.',
    /** Amounts are the organiser’s alone on an event that hides them. */
    introPrivate:
      'Every bead is one person. Filled beads are money, open beads are something brought. Amounts stay hidden from everyone but you.',
    empty: 'Nobody has been recorded here yet.',
  },

  money: {
    heading: 'Where the money is',

    /**
     * **The Mode A truth, and the most important sentence on the screen.**
     *
     * The design says the money sits in a held Isipheko account. It does not —
     * people pay the organiser directly, and a screen implying otherwise would
     * be inviting her to wait for money she already has.
     */
    intro:
      'People pay you directly, so this money is already in your own account. What is below is the record of it — what has been confirmed, and what is new enough that a payment could still be reversed.',

    /**
     * **The hosted truth, and it is the opposite of the sentence above** (M5-03).
     *
     * On a hosted event the contributor pays on the page and the money is with
     * the payment service — not with Isipheko, and not yet in her bank account.
     * Leaving the ledger-only sentence there would tell an organiser she
     * already has money she does not have, on the screen where she decides
     * what to do with it. That is the failure M3-08 §1 was written about,
     * pointing the other way.
     *
     * It was the one sentence that could not wait for M5-08, because it is the
     * one an organiser acts on. **The rest of the section followed at M5-08**:
     * `raisedNote`, `settlingNote` and `available` are all keyed now, and every
     * mode-dependent string in this block reads the same `hosted` flag.
     */
    introHosted:
      'People pay on this page, so this money is with the payment service — not with Isipheko, and not yet in your bank account. What is below is the record of it: what has been confirmed, and what is new enough that a payment could still be reversed.',

    raised: 'Confirmed on the record',

    /**
     * **Ledger-only.** She checked each one against her own bank message and
     * said yes, so "confirmed by you" is the literal account of what happened.
     */
    raisedNote: (count: number) =>
      count === 1
        ? 'One person’s money, confirmed by you.'
        : `${String(count)} people’s money, confirmed by you.`,

    /**
     * **Hosted, and the same class of untruth as `intro` was** (M5-03 §7).
     *
     * On a hosted event she confirmed nothing — the payment did, and a hosted
     * contribution never reaches her confirmation queue at all (M5-03 §8).
     * Telling her she confirmed this money is telling her she checked something
     * she never saw, directly under the figure she acts on. Mode-keyed like the
     * sentence above it rather than softened into one line true of neither.
     */
    raisedNoteHosted: (count: number) =>
      count === 1
        ? 'One person’s money, confirmed when the payment cleared.'
        : `${String(count)} people’s money, confirmed as each payment cleared.`,

    settling: 'Still inside the 72 hours',
    settlingNone: 'Nothing came in within the last 72 hours.',
    settlingNote: (amount: string, clears: string) =>
      `${amount} arrived in the last 72 hours and clears on ${clears}. Everything older is settled.`,
    /** Keyed for the same reason `available` is: "settled" is the wrong word. */
    settlingNoteHosted: (amount: string, clears: string) =>
      `${amount} arrived in the last 72 hours and clears on ${clears}. Everything older is past that window.`,

    /**
     * **Ledger-only.** The contributor paid her directly, so a payment past the
     * reversal window is money that is settled in her own account. One fact,
     * one word for it.
     */
    available: 'Settled',
    availableNote: (amount: string) =>
      `${amount} is past the window in which a payment can be reversed.`,

    /**
     * **Hosted, and the third and last of M3-08's money strings** (M5-08).
     *
     * *"Settled"* is two facts wearing one label. On a ledger-only event they
     * are the same fact and the label is fine. On a hosted event **past the
     * reversal window** and **paid to your bank** come apart, and "Settled" is
     * heard as the second while meaning the first — under a figure an organiser
     * decides what to promise on.
     *
     * **The honest hosted label names one fact, because only one is true.**
     * Nothing moves money out on a hosted event: `payouts` is empty and M5-03 §5
     * explains why it must stay that way until there is a payout row to explain
     * a debit. So the note says where the money still is rather than implying it
     * has arrived somewhere.
     *
     * **The second fact arrives with M5-10** — settlement reconciliation, which
     * is what first makes *paid to your bank* true of anything. It is a label
     * and a note added beside these, not a rewrite of them.
     */
    availableHosted: 'Past the reversal window',
    availableNoteHosted: (amount: string) =>
      `${amount} can no longer be reversed. It is still with the payment service — nothing has been paid out to your bank yet.`,

    /** No total, no target, no progress. The record is not a scoreboard. */
    inKindNote:
      'Things people brought are not counted here. They are on the list above and on the record below, which is where they belong.',
  },

  payout: {
    heading: 'Taking the money out',

    /**
     * Why the section exists at all when nothing can be requested.
     *
     * It is not a preview of a feature. These four conditions are what will be
     * asked of her, and knowing them before the day she needs money is the
     * difference between a delay she understood and one that arrived as a
     * refusal.
     */
    intro:
      'Nothing is paid out through Isipheko yet, so there is nothing here to ask for. When there is, these four things have to be true first — not to slow you down, but so that if anything goes wrong there is still time to stop it. They are here now so that none of them is a surprise on the day.',

    /** Said once, plainly, so the list is not read as a form she has failed. */
    notAJudgement:
      'None of this is a judgement about you. Every organiser passes through the same four.',

    conditions: {
      identity: {
        titleMet: 'Your name is verified',
        titleUnmet: 'Your name needs verifying',
        protects:
          'Checked against Home Affairs. This is what stops someone else setting up a page in your family’s name and taking what people meant for you.',
        met: (on: string) => `Done on ${on}. Nothing more needed.`,
        /** The one remedy on this screen with somewhere to go. */
        remedy:
          'It takes a few minutes and one photograph of nothing. You cannot publish without it either, so it is the first thing to get out of the way.',
        action: 'Verify my name',
      },
      bank: {
        titleMet: 'Your bank account is verified',
        titleUnmet: 'Your bank account needs verifying',
        protects:
          'We check the account belongs to the same verified name. It means money cannot be redirected to a stranger’s account, even by someone who gets into this page.',
        met: 'Checked against your verified name.',
        /**
         * Part F, verbatim. **Not the R1 test deposit** in the design file:
         * Stitch BAV checks the account against the holder’s SA ID directly,
         * with no deposit to wait for and no reference to hunt for.
         */
        remedy:
          'Add your account number and we check it against your verified name with your bank. Usually a few seconds.',
        /**
         * There is no button, and the copy says why rather than leaving a dead
         * end. A control opening a screen that cannot verify anything would be
         * worse than the gap it hides.
         */
        notYet:
          'You cannot do this yet — the check is not connected. Nothing is waiting on you.',
      },
      hold: {
        titleMet: 'Nothing is inside the 72-hour window',
        titleUnmet: (amount: string) => `${amount} is still settling`,
        protects:
          'Anything given in the last 72 hours waits before it can leave. If a card is reversed, or someone gives by mistake, or a payment turns out to be fraud, this is the window in which it can still be undone — before it is your problem to fix.',
        met: 'Everything on the record is past it.',
        remedy: (clears: string, available: string) =>
          `This clears on ${clears}. The rest — ${available} — is already past the window.`,
      },
      witness: {
        titleMet: 'No second signature needed',
        titleUnmet: (who: string) => `${who} would need to agree`,
        titleUnmetNobody: 'One of your abakhaphi would need to agree',
        protects: (threshold: string) =>
          `Over ${threshold}, one of your abakhaphi agrees too. Two people, not one — so nobody can ever say afterwards that you moved the family’s money alone.`,
        met: (threshold: string) =>
          `Below ${threshold}, so this one does not apply. It is here so you know it exists.`,
        remedy: (who: string) =>
          `One tap would send ${who} the amount and what it is for, and ${who} taps yes.`,
        remedyNobody:
          'Ask somebody to be umkhaphi first — the setup steps are where you name them.',
        notYet: 'Nothing to ask for yet, because there is no payout to agree to.',
      },
    } satisfies Record<PayoutConditionId, unknown>,
  },
} as const
