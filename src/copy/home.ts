/**
 * The home page (M1-09) and the 404 beside it.
 *
 * ## The only screen a stranger reaches without a link
 *
 * Every other public page in this product is opened from something somebody was
 * sent. This one is opened by typing the address — which means the two people
 * who arrive here are somebody deciding whether to set an umcimbi up, and
 * **somebody who was sent a link they do not trust and correctly refuses to use
 * a number on it** (M3-04). The page has to serve both without pretending they
 * are the same visit.
 *
 * ## What it may not do
 *
 * No target, no counter, no total, no progress, no motion, no testimonial. A
 * funeral is one of the six archetypes and this is the front door people arrive
 * from one through — *"R2.4m raised"* above a link to a page about a death is
 * the failure rule 1 exists to prevent, one level up from where it is enforced.
 *
 * **No archetype, so no accent.** The home page belongs to no ceremony, declares
 * no `--accent`, and renders indigo through `var(--accent, #16233D)`. Rule 2
 * working with nothing written to make it work.
 *
 * ## Custody, said on the front page
 *
 * Two different answers, and the page gives both rather than the reassuring
 * average of them: on an umcimbi the money reaches the family's own account, and
 * on a collection it goes to the organiser and never touches us at all (rules 12
 * and 16). A front page implying custody we do not have would be the one
 * dishonest thing in the product.
 */

export const homeCopy = {
  title: 'Isipheko',

  /**
   * The word first, because it is the argument.
   *
   * *Isipheko* is from *ukupheka*, to cook. The custom is about arriving with
   * provisions — a tent, chairs, twenty kilograms of meat — and money is one
   * form of that rather than the point of it. Somebody who reads only the top of
   * this page should still know that bringing a thing counts the same as
   * sending an amount, because that is what separates this from a donation page.
   */
  lead: 'From ukupheka, to cook.',
  intro:
    'When a family holds an umcimbi — a wedding, a funeral, an unveiling, a welcome for a child — people arrive with something. Money, or a tent, or the chairs, or the meat. Isipheko keeps the record of who stood with them, and lets people say what they are bringing so that nobody arrives with a second one.',

  bring: {
    heading: 'Money or the thing itself',
    body: 'Somebody can send an amount, or claim something off the family’s list and bring it. Both go on the same record and count the same. The family says what is needed; nobody has to guess, and nobody chooses for the person giving.',
  },

  record: {
    heading: 'A record nobody can quietly change',
    body: 'Every contribution is written once and never edited. A correction is a new line saying what was wrong, not a rubbing-out — so what the record says today is what it will say in five years, to the family and to everyone who gave.',
  },

  /** Both roles, and the difference between them is about money. */
  start: {
    heading: 'Two ways to start',

    event: {
      title: 'Set up your umcimbi',
      body: 'For the family holding it. You say what the day needs, ask one or two people to stand with you, and share one link. Contributions reach your own bank account — Isipheko never holds them.',
      action: 'Set up your umcimbi',
    },

    /**
     * Second and quieter, deliberately (Part D2.7): collections are how people
     * arrive and the ceremony is why they stay, and a group-pot app that also
     * does ceremonies is undifferentiated.
     *
     * The custody sentence is not softened. She holds the money; we never touch
     * it and neither does the host (rules 12 and 16).
     */
    collection: {
      title: 'Rally a group',
      body: 'For a guest bringing cousins, colleagues or a congregation together to give as one. You collect it into your own account and hand it over yourself. Isipheko never receives it, never holds it, and cannot pass it on for you — the people giving are trusting you, and the page says so.',
      action: 'Start a collection',
    },

    /**
     * Both destinations sign in first, and saying so before the tap is the
     * difference between a step somebody expected and a phone-number field that
     * appears out of nowhere (M1-09 §3).
     */
    signInNote:
      'Both start with your phone number and a code. There is no password to remember and no email address to give.',
  },

  /**
   * The second visitor, and the whole reason this page is load-bearing.
   *
   * The instruction is the same one the trust panel gives and for the same
   * reason (M3-04 §2): a number on a page cannot verify that page. What is
   * different here is that somebody who typed this address has **already** done
   * the hard part, so this is where the route has to be short.
   */
  check: {
    heading: 'Were you sent a link?',
    body: 'If somebody sent you an umcimbi and you want to know whether it is real before you give anything, you can check it here. Do not use a number on the page itself — if the page were fake, the number would be too.',
    action: 'isipheko.co.za/check',
    reportLead: 'If you think a page is not what it says it is, tell us:',
    reportAction: 'isipheko.co.za/report',
    reportNote: 'A person looks at every report within one working day.',
  },

  /**
   * The global 404 (M1-09 §4).
   *
   * There was none: an unmatched address produced the framework's default page,
   * which explains nothing and offers nowhere to go. **A link that resolves to
   * nothing is the scam case** — it is precisely what somebody holding a forged
   * link finds — so this is the one 404 in the product that has somewhere to
   * send people, and it sends them to the same two routes the trust panel does.
   *
   * It does not say "the link may be wrong" and stop, the way the event-page
   * 404 does. That one is answering about a specific umcimbi that may simply not
   * be shared yet. This one is answering about an address that has never existed.
   */
  notFound: {
    title: 'There is nothing at this address',
    body: 'No page on Isipheko has ever been at this address. If you followed a link to get here, the link is wrong — or it was made to look like ours.',
    checkLead: 'If you were sent an umcimbi and want to know whether it is real:',
    homeAction: 'Go to the front page',
  },

  footer: 'Isipheko · from ukupheka, to cook. People have always arrived with something.',
} as const
