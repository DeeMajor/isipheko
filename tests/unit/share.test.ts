import { describe, expect, it } from 'vitest'

import { archetypeShareCopy, shareCopy } from '@/copy/share'
import { ARCHETYPES, type ArchetypeKey } from '@/domain/archetype'
import {
  cardKey,
  cardVersion,
  isCardVersion,
  shareText,
  smsUrl,
  whatsappUrl,
  type CardFacts,
} from '@/domain/share'
import { cardFacts, cardIdentity, cardMeta, formatEventDate } from '@/lib/event-card'

const FACTS: CardFacts = {
  title: 'Nokuthula Mthembu',
  subtitle: 'uMaZondi',
  organiserName: 'Nomsa Mthembu',
  archetype: 'umngcwabo',
  kicker: 'Umngcwabo',
  place: 'KwaMashu, KwaZulu-Natal',
  eventDate: '2026-08-15T00:00:00.000Z',
  verified: false,
}

describe('the card version', () => {
  it('is the same for the same facts, so the card is generated once', () => {
    expect(cardVersion(FACTS)).toBe(cardVersion({ ...FACTS }))
    expect(isCardVersion(cardVersion(FACTS))).toBe(true)
  })

  it('changes when anything the card draws changes', () => {
    const base = cardVersion(FACTS)

    // Every one of these is on the card, and a card that no longer matches the
    // page is a card WhatsApp will keep showing until the URL changes.
    expect(cardVersion({ ...FACTS, title: 'Nokuthula Mthembu ' })).not.toBe(base)
    expect(cardVersion({ ...FACTS, subtitle: null })).not.toBe(base)
    expect(cardVersion({ ...FACTS, organiserName: 'Thandi Ngcobo' })).not.toBe(base)
    expect(cardVersion({ ...FACTS, place: null })).not.toBe(base)
    expect(cardVersion({ ...FACTS, eventDate: null })).not.toBe(base)
    expect(cardVersion({ ...FACTS, kicker: 'Umshado' })).not.toBe(base)
    // The badge is in the version because the day it becomes true, every card
    // already sitting in a chat has to stop being the current one.
    expect(cardVersion({ ...FACTS, verified: true })).not.toBe(base)
  })

  it('cannot be confused by a field that contains the separator', () => {
    // Same trick the ledger hash uses: a title cannot forge a field boundary.
    const shifted = cardVersion({ ...FACTS, title: 'Nokuthula', subtitle: 'Mthembu' })
    const joined = cardVersion({ ...FACTS, title: 'NokuthulaMthembu', subtitle: '' })

    expect(shifted).not.toBe(joined)
  })

  it('refuses anything that is not a version', () => {
    for (const bad of ['', 'abc', '../../etc/passwd', 'A'.repeat(16), '0'.repeat(15)]) {
      expect(isCardVersion(bad), bad).toBe(false)
    }
  })

  it('keys the object store by event and version', () => {
    expect(cardKey('01a00b43', 'deadbeefdeadbeef')).toBe(
      'og/01a00b43/deadbeefdeadbeef.png',
    )
  })
})

describe('the links the organiser taps', () => {
  const url = 'https://isipheko.co.za/e/AbCdEf0123456789'
  const message = 'Sanibonani. Everything for the day is on here.'

  it('puts the link last, with nothing after it', () => {
    // WhatsApp only draws the preview when it can find the URL, and a full stop
    // after a link is part of the link in some clients.
    expect(shareText(message, url).endsWith(url)).toBe(true)
  })

  it('builds a wa.me link with no number in it', () => {
    const link = whatsappUrl(message, url)

    // No recipient: the organiser picks from their own contacts, and a number
    // baked into a share link is somebody's number in a URL.
    expect(link.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(link.split('text=')[1] ?? '')).toBe(shareText(message, url))
  })

  it('builds an sms: link for the relative with no WhatsApp', () => {
    const link = smsUrl(message, url)

    expect(link.startsWith('sms:?body=')).toBe(true)
    expect(decodeURIComponent(link.split('body=')[1] ?? '')).toBe(shareText(message, url))
  })

  it('escapes a message that would otherwise break the query string', () => {
    const link = whatsappUrl('Ampersands & question marks? #hash', url)

    expect(link).not.toContain(' ')
    expect(link).not.toContain('#')
    expect(link.split('?').length).toBe(2)
  })
})

describe('what the card says', () => {
  const subject = {
    id: 'event-1',
    slug: 'AbCdEf0123456789',
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: 'uMaZondi',
    place: 'KwaMashu',
    eventDate: new Date('2026-08-15T00:00:00.000Z'),
    organiserName: 'Nomsa Mthembu',
    organiserVerifiedAt: null,
  }

  it('is the kind, the day and the place — and never a number of anything', () => {
    const meta = cardMeta(ARCHETYPES.umngcwabo, subject)

    expect(meta).toBe('Umngcwabo · Saturday, 15 August · KwaMashu')
    expect(meta).not.toMatch(/R\s?\d/)
    expect(meta.toLowerCase()).not.toContain('raised')
    expect(meta.toLowerCase()).not.toContain('target')
  })

  it('drops the parts that are not there rather than leaving empty separators', () => {
    expect(
      cardMeta(ARCHETYPES.umshado, { ...subject, place: null, eventDate: null }),
    ).toBe('Umshado')
  })

  it('formats the date the organiser typed, in UTC', () => {
    // The server's timezone must not move somebody's funeral to the day before.
    expect(formatEventDate(new Date('2026-08-15T00:00:00.000Z'))).toBe(
      'Saturday, 15 August',
    )
    expect(formatEventDate(null)).toBeNull()
  })

  it('claims verification only where there is some, on every archetype', () => {
    // True or absent, never softened (M1-08 §5). `verified` was a hard `false`
    // until M3-02 because nothing could honestly make it true; it now reads the
    // organiser, and reads nothing else.
    const verifiedAt = new Date('2026-08-12T00:00:00.000Z')

    for (const key of Object.keys(ARCHETYPES) as ArchetypeKey[]) {
      expect(cardFacts(ARCHETYPES[key], { ...subject, archetype: key }).verified).toBe(
        false,
      )
      expect(
        cardFacts(ARCHETYPES[key], {
          ...subject,
          archetype: key,
          organiserVerifiedAt: verifiedAt,
        }).verified,
      ).toBe(true)
    }
  })

  it('mints a different image URL once the badge is earned', () => {
    // The version hashes the facts, and the badge is one of them (M2-07 §2). So
    // a card already sitting in a chat stops being the current one the moment
    // the organiser is verified, and WhatsApp refetches on its own.
    const before = cardIdentity(ARCHETYPES.umngcwabo, subject, 'https://isipheko.co.za')
    const after = cardIdentity(
      ARCHETYPES.umngcwabo,
      { ...subject, organiserVerifiedAt: new Date('2026-08-12T00:00:00.000Z') },
      'https://isipheko.co.za',
    )

    expect(after.version).not.toBe(before.version)
    expect(after.url).not.toBe(before.url)
  })

  it('does not change the card when only the date of the check changes', () => {
    // The card draws a tick, not a date. Two organisers verified on different
    // days get the same picture, and re-running a check must not invalidate
    // every card in every chat for a difference nobody can see.
    const one = cardFacts(ARCHETYPES.umngcwabo, {
      ...subject,
      organiserVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
    })
    const other = cardFacts(ARCHETYPES.umngcwabo, {
      ...subject,
      organiserVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
    })

    expect(one).toEqual(other)
  })

  it('builds an absolute image URL from the origin it was asked about', () => {
    const identity = cardIdentity(ARCHETYPES.umngcwabo, subject, 'https://isipheko.co.za')

    expect(identity.url).toBe(`https://isipheko.co.za${identity.path}`)
    expect(identity.path).toBe(`/e/${subject.slug}/og/${identity.version}.png`)
    expect(identity.key).toBe(`og/${subject.id}/${identity.version}.png`)
  })
})

describe('the message that goes with the link', () => {
  it('exists for every archetype and carries the title', () => {
    for (const key of Object.keys(ARCHETYPES) as ArchetypeKey[]) {
      const message = archetypeShareCopy[key].message('Nokuthula Mthembu')

      expect(message, key).toContain('Nokuthula Mthembu')
      expect(message.length, key).toBeGreaterThan(40)
    }
  })

  it('does not invite anybody to a celebration on a bereavement page', () => {
    for (const key of ['umngcwabo', 'umbuyiso'] as const) {
      const message = archetypeShareCopy[key].message('Nokuthula Mthembu').toLowerCase()

      expect(message, key).not.toContain('helped already')
      expect(message, key).not.toContain('celebrat')
      expect(message, key).toContain('stood with them')
    }
  })

  it('never mentions money, and claims verification only where it is earned', () => {
    const strings = [
      shareCopy.intro,
      shareCopy.previewIntro,
      shareCopy.thumbnailNote,
      ...Object.keys(ARCHETYPES).map((key) =>
        archetypeShareCopy[key as ArchetypeKey].message('Nokuthula Mthembu'),
      ),
    ]

    for (const line of strings) {
      expect(line, line).not.toMatch(/R\s?\d/)
      expect(line.toLowerCase(), line).not.toContain('donat')
    }

    // The message that travels to fifty people says nothing about a check —
    // it is about the umcimbi, and the card carries the tick.
    for (const key of Object.keys(ARCHETYPES) as ArchetypeKey[]) {
      expect(archetypeShareCopy[key].message('Nokuthula Mthembu')).not.toContain(
        'verified',
      )
    }

    // `introVerified` renders once the organiser is verified, which since M3-02
    // is every published event. `intro` is what an unpublished draft still sees.
    expect(shareCopy.introVerified).toContain('verified')
    expect(shareCopy.intro).not.toBe(shareCopy.introVerified)
    expect(shareCopy.intro.toLowerCase()).not.toContain('verified')

    // The line under the chat preview describes what the card does now, rather
    // than what it will do one day. It was refused twice before it was true:
    // once at M1-08 §5 when nothing was checked, once at M3-01 when the check
    // existed and the badge was not wired.
    expect(shareCopy.badgeCarried).toContain('tick')
    expect(shareCopy.badgeCarried.toLowerCase()).not.toContain('not yet')
    expect(shareCopy.badgeCarried.toLowerCase()).not.toContain('when it is')
  })
})
