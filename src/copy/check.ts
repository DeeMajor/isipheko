/**
 * `/check` — the route somebody reaches **by typing it**, to ask whether a page
 * they were sent is real (M3-05, built with M3-04).
 *
 * The whole point is that it does not come from the page being checked. So this
 * screen never sends anybody back to that page, never shows a link to it, and
 * never asks for anything but the code they were told to type.
 *
 * It answers with what the public page already shows and nothing else: the
 * title, the organiser's name, and whether their identity was checked and when.
 * A phone number, an amount or a contributor's name here would make this a way
 * to learn more by asking sideways.
 */

export const checkCopy = {
  title: 'Check an umcimbi',
  lead: 'You were sent a link, or a code, and you want to know whether it is real before you give anything. That is the right instinct and this page exists for it.',

  field: {
    label: 'The code from the page',
    help: 'Six characters after three letters, like MTH-4K7B2X. You can also paste the whole link you were sent.',
  },
  submit: 'Check it',

  found: {
    heading: 'This is a real umcimbi on Isipheko',
    /** Stated as fact or not at all — the M1-08 §5 rule, on the page about facts. */
    verified: (name: string, when: string) =>
      `${name} set it up, and their South African ID was checked against the Home Affairs record on ${when}.`,
    unverified: (name: string) =>
      `${name} set it up. Their identity has not been checked, and until it is we will not say otherwise.`,
    noName: 'The person who set it up has not put their name to it yet.',
    /**
     * The same sentence the event page carries, because the limit of a check is
     * the same wherever it is stated.
     */
    limit:
      'It confirms who the organiser is. It does not, on its own, confirm the ceremony.',
    stillAsk:
      'If the link you were sent does not match what is written here, do not use it. Ask someone in the family you already know, on a number you already had.',
  },

  notFound: {
    heading: 'Nothing here matches that',
    body: 'No umcimbi on Isipheko has that code. Check the characters against what you were sent — 0 and O are the same here, and so are 1, I and L, so it is unlikely to be those.',
    /**
     * Said plainly. Somebody who typed a real code for a page nobody has shared
     * yet gets this answer too, and the alternative — telling them a draft
     * exists — would find a family's page before they were ready to send it.
     */
    orNotShared:
      'A page that has not been shared yet also answers this way. If somebody has sent you a link and this says nothing matches, that is worth stopping over.',
    /**
     * The most valuable report there is (M3-06). Somebody holding a link that
     * resolves to nothing has found the scam case, and this is the moment they
     * know it.
     */
    tellUs:
      'If you were sent a link and nothing here matches it, tell us. A person will look at it within one working day.',
  },

  tooMany: {
    heading: 'That is a lot of checks',
    body: 'Give it a few minutes and try again. If you are checking one link, this is not about you.',
  },

  /**
   * **Nothing here links back to the page being checked**, and that is the
   * discipline rather than an omission: an answer that offered a way through to
   * the umcimbi would let a fake link use this page as a step on the way, and
   * the answer has to be able to stand on its own.
   *
   * The event page does link here (M3-04), under the instruction to type the
   * address yourself. That instruction stays primary, because on a fake page
   * the link would be fake too.
   */
  foot: 'Nothing on this page opens the umcimbi you are asking about. If what you were sent does not match what is written here, the link is the thing to doubt.',
} as const
