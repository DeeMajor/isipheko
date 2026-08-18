import type { ArchetypeKey } from '@/domain/archetype'

/**
 * Sharing the page, and the message that goes with it.
 *
 * **English only, and that is a stated gap rather than an oversight.** M2-07's
 * criterion said "in the organiser's language". There is no locale on an
 * organiser or an event and no isiZulu copy anywhere — `src/copy/` is the
 * translation unit Part D describes, with one language in it. Translations need
 * a first-language speaker (open item 9), so the plan now says English at
 * launch and this file is the thing that gets translated when that happens.
 *
 * The message is keyed by archetype because the register is not the same. You
 * do not send *"Everything for the day is on here"* about a funeral.
 */

export interface ArchetypeShareCopy {
  /**
   * What lands in the chat above the card. `title` is the umcimbi's name, as
   * the organiser typed it.
   */
  readonly message: (title: string) => string
}

export const archetypeShareCopy: Record<ArchetypeKey, ArchetypeShareCopy> = {
  // From `design/setup.html`: "Sanibonani. Everything for … is on here — what
  // is still needed, and who has helped already."
  umshado: {
    message: (title) =>
      `Sanibonani. Everything for ${title} is on here — what is still needed, and who has helped already.`,
  },
  umembeso: {
    message: (title) =>
      `Sanibonani. Everything for ${title} is on here — what is still needed, and who has helped already.`,
  },

  /*
   * Bereavement does not say "helped already" and does not invite anybody to a
   * day. It says where the family is and what is needed, and leaves the rest
   * to the person reading it.
   */
  umngcwabo: {
    message: (title) =>
      `Sanibonani. This is for ${title}. What the family still needs is on here, and who has stood with them.`,
  },
  umbuyiso: {
    message: (title) =>
      `Sanibonani. This is for ${title}. What the family still needs is on here, and who has stood with them.`,
  },

  imbeleko: {
    message: (title) =>
      `Sanibonani. Everything for ${title} is on here — what is still needed, and who has helped already.`,
  },
  graduation: {
    message: (title) =>
      `Sanibonani. Everything for ${title} is on here — what is still needed, and who has helped already.`,
  },
  itiye: {
    message: (title) =>
      `Sanibonani. Everything for ${title} is on here — what is still needed, and who has helped already.`,
  },
}

export const shareCopy = {
  /**
   * The share step's own words.
   *
   * The prototype's intro — *"Every person who opens it sees your verified
   * name"* — is not shipped. Nothing is verified until M3-02, and this is read
   * by an organiser deciding whether to send the link to fifty people. The
   * verified wording is kept below for the day it is true.
   */
  intro:
    'Send it to one group and it spreads on its own. Anyone who opens it sees what is needed and who has already stood with you.',
  introVerified:
    'Send it to one group and it spreads on its own. Every person who opens it sees your verified name.',

  whatsapp: 'Send on WhatsApp',
  sms: 'Send by SMS',
  copy: 'Copy link',
  copied: 'Copied',
  linkLabel: 'The link to your page',

  previewTitle: 'How it will look in the chat',
  previewIntro:
    'More people will see this card than will open the page. Your name has to read at this size.',
  thumbnailNote:
    'At thumbnail size the bead colour and the name are the only things left — which is why they carry the whole card.',

  /**
   * True since M3-02, and the third version of this string.
   *
   * M1-08 §5 refused the prototype's "every person who opens it sees your
   * verified name" because nothing was verified. M3-01 built the check and this
   * said the badge itself was not wired. Both are done, so it now says what the
   * card does — and an event cannot be published unverified, so there is no
   * unverified card to describe.
   */
  badgeCarried:
    'The card carries your name and the tick beside it. That is what most people see before they decide whether to open the link at all — the check you did is what puts it there.',

  /** The card's own words, drawn into the image. */
  card: {
    wordmark: 'Isipheko',
    organiser: (name: string) => `Organised by ${name}`,
    organiserVerified: (name: string) => `Organised by ${name} · verified`,
    /** The domain under the card, as WhatsApp draws it. */
    host: 'isipheko.co.za',
  },

  /**
   * The line under the title in the chat. It is the card's own meta line —
   * kind, date, place — and never a total, a count or an amount: a preview
   * gets forwarded to people who never opened the page.
   */
  description: (meta: string) => (meta === '' ? 'An umcimbi on Isipheko.' : meta),
} as const
