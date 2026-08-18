import { createHash } from 'node:crypto'

/**
 * Sharing: what the link preview is keyed by, and how the two send buttons
 * build their links.
 *
 * The WhatsApp card is seen by more people than the page (architecture §9.1).
 * Most of the family will decide whether this is real from a thumbnail in a
 * group chat, which is why the card is generated rather than guessed at, and
 * why what it says is pinned by a version.
 *
 * Pure: hashing and string building. `node:crypto` only, which the domain
 * boundary allows for exactly this reason (docs/decisions.md M1-01 §4).
 */

/**
 * Everything the card draws. Change any of it and the card is a different
 * picture, so it gets a different URL.
 */
export interface CardFacts {
  readonly title: string
  readonly subtitle: string | null
  readonly organiserName: string | null
  readonly archetype: string
  readonly kicker: string
  readonly place: string | null
  /** ISO date, or null. Never a `Date`: two clocks would hash differently. */
  readonly eventDate: string | null
  /**
   * Whether the badge is drawn. False everywhere today — verification is
   * M3-01 and the slot renders nothing until M3-02 (see `src/ui/og-card.tsx`).
   * It is in the version because the day it becomes true, every card in every
   * chat has to stop being the old one.
   */
  readonly verified: boolean
}

/**
 * U+001F between fields, as the ledger hash does (M2-01 §2), so a title that
 * happens to contain the separator cannot make two different cards hash alike.
 *
 * Written as an escape rather than the character itself: a raw control byte in
 * source is invisible in review and does not survive a careless editor.
 */
const SEPARATOR = '\u001F'

/**
 * The version that goes in the image URL.
 *
 * Content-addressed on purpose, and it does two jobs at once:
 *
 * **It is the cache key.** Same facts, same key, one generation ever.
 *
 * **It is how WhatsApp is told to look again.** WhatsApp caches a preview
 * against the URL it fetched and will not revisit it on any schedule we
 * control. A changed title mints a new URL, so the next person to receive the
 * link gets the current card rather than the one from before the family fixed
 * the spelling of their mother's name.
 *
 * Sixteen hex characters — 64 bits. This is a cache key, not a secret: it
 * guards nothing, because anybody holding the link already has the page.
 */
export function cardVersion(facts: CardFacts): string {
  const canonical = [
    facts.title,
    facts.subtitle ?? '',
    facts.organiserName ?? '',
    facts.archetype,
    facts.kicker,
    facts.place ?? '',
    facts.eventDate ?? '',
    facts.verified ? 'verified' : 'unverified',
  ].join(SEPARATOR)

  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16)
}

/** `og/<event>/<version>.png` — the object key and the URL path share a shape. */
export function cardKey(eventId: string, version: string): string {
  return `og/${eventId}/${version}.png`
}

/** A version straight out of a URL, before it is used to look anything up. */
export function isCardVersion(value: string): boolean {
  return /^[0-9a-f]{16}$/.test(value)
}

/**
 * The message the organiser sends, and the link at the end of it.
 *
 * One space between them and nothing after, because WhatsApp only makes the
 * preview when it can find the URL — and a full stop after a link is a full
 * stop inside the link on some clients.
 */
export function shareText(message: string, url: string): string {
  return `${message} ${url}`
}

/**
 * `wa.me` rather than `whatsapp://`: it opens the app when the app is there and
 * the web client when it is not, and it is the documented public entry point.
 * No number in it — the organiser chooses who from their own contact list.
 */
export function whatsappUrl(message: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(shareText(message, url))}`
}

/**
 * `sms:` with `?body=` for the person whose relative has no WhatsApp, which on
 * this product is not the edge case it would be elsewhere.
 */
export function smsUrl(message: string, url: string): string {
  return `sms:?body=${encodeURIComponent(shareText(message, url))}`
}
