import type { ArchetypeConfig } from '@/domain/archetype'
import { cardKey, cardVersion, type CardFacts } from '@/domain/share'

/**
 * What the link preview says about an event, worked out once.
 *
 * Two callers need exactly the same answer: the page, which writes the `<meta>`
 * tags, and the image route, which draws the card. If they disagreed, the tag
 * would point at a URL the route does not consider current, and every share
 * would regenerate an image nobody caches.
 */

export interface CardSubject {
  readonly id: string
  readonly slug: string
  readonly archetype: string
  readonly title: string
  readonly subtitle: string | null
  readonly place: string | null
  readonly eventDate: Date | null
  readonly organiserName: string | null
  /** Null when the organiser is not verified. Drives the badge and the version. */
  readonly organiserVerifiedAt: Date | null
}

/**
 * "Saturday, 15 August" in en-ZA, in UTC — the date the organiser typed, not
 * the server's idea of today.
 */
export function formatEventDate(date: Date | null): string | null {
  if (date === null) return null

  return new Intl.DateTimeFormat('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
}

/** "Umngcwabo · Saturday, 15 August · KwaMashu". Never an amount, never a count. */
export function cardMeta(archetype: ArchetypeConfig, subject: CardSubject): string {
  return [archetype.kicker, formatEventDate(subject.eventDate), subject.place]
    .filter((part) => part !== null && part !== '')
    .join(' · ')
}

/**
 * `verified` is read from the organiser, not defaulted.
 *
 * It was a hard `false` until M3-02, because there was no honest way to pass
 * `true` — nothing set a verification status. Now something does, and this is
 * where the badge becomes real.
 *
 * It is still not a parameter with a default: a default is something a caller
 * can pass the other way by accident, and this one decides whether a tick
 * appears beside somebody's name in fifty WhatsApp chats.
 *
 * The version hash covers it (M2-07 §2), so an event that gains a badge mints a
 * new image URL and the card already sitting in a chat stops being the current
 * one — which is exactly what has to happen, and needs nobody to remember it.
 */
export function cardFacts(archetype: ArchetypeConfig, subject: CardSubject): CardFacts {
  return {
    title: subject.title,
    subtitle: subject.subtitle,
    organiserName: subject.organiserName,
    archetype: subject.archetype,
    kicker: archetype.kicker,
    place: subject.place,
    eventDate: subject.eventDate === null ? null : subject.eventDate.toISOString(),
    verified: subject.organiserVerifiedAt !== null,
  }
}

export interface CardIdentity {
  /** What the version was computed from, so the drawing agrees with the URL. */
  readonly facts: CardFacts
  readonly version: string
  readonly key: string
  /** Absolute, because a relative `og:image` is ignored by every crawler. */
  readonly url: string
  readonly path: string
}

export function cardIdentity(
  archetype: ArchetypeConfig,
  subject: CardSubject,
  baseUrl: string,
): CardIdentity {
  const facts = cardFacts(archetype, subject)
  const version = cardVersion(facts)
  const path = `/e/${subject.slug}/og/${version}.png`

  return {
    facts,
    version,
    key: cardKey(subject.id, version),
    url: `${baseUrl}${path}`,
    path,
  }
}
