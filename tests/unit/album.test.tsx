import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { albumCopy } from '@/copy/album'
import type { AlbumEntry } from '@/db/repositories/album'
import type { StrandBead } from '@/db/repositories/strand'
import { ARCHETYPES } from '@/domain/archetype'
import type { ArchetypeKey } from '@/domain/archetype'
import { fromCents } from '@/domain/money'
import { Album } from '@/ui/album'

/**
 * The album — M4-02's two done-criteria and the archetype constraint.
 *
 * **It renders for a funeral as readily as for a wedding.** One shell, no
 * celebratory framing, and — the assertion this file exists for — **no amount,
 * no total and no count of contributions, at any of the seven archetypes**. The
 * strand's size bands are unlabelled precisely so amounts cannot be
 * reverse-engineered (Part C.4); an album that undid that in prose would be
 * worse, because it is the artefact that gets printed and passed around.
 */

const AT = new Date('2026-08-15T09:00:00.000Z')

/**
 * The document without its inlined stylesheet.
 *
 * The album inlines its CSS into the head, so a naive `toContain` on the whole
 * string matches selector names and colour values — `data-unsized` and
 * `--accent` are both in there as CSS whatever the page renders. Every
 * assertion about markup is made against this.
 */
const styleless = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, '')

/**
 * What a reader actually sees.
 *
 * Attributes are not text: `width="2400"` is not the page saying 2400, and an
 * assertion that cannot tell the difference is an assertion that will be
 * silenced by whoever trips it next.
 */
const visibleText = (markup: string) =>
  styleless(markup)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

function entry(over: Partial<AlbumEntry> = {}): AlbumEntry {
  return {
    id: 'e1',
    form: 'cash',
    name: 'Thandi Ngcobo',
    description: null,
    message: null,
    photo: null,
    at: AT,
    ...over,
  }
}

/** The cover's bead for an entry. Carries the amount the entry cannot. */
function bead(from: AlbumEntry, amount: bigint | null = 50_000n): StrandBead {
  return {
    id: from.id,
    form: from.form,
    name: from.name,
    amount: amount === null ? null : fromCents(amount),
    description: from.description,
    message: from.message,
    at: from.at,
    ...(from.members === undefined ? {} : { members: from.members }),
    ...(from.memberCount === undefined ? {} : { memberCount: from.memberCount }),
  }
}

function album(
  entries: readonly AlbumEntry[],
  archetype: ArchetypeKey = 'umngcwabo',
): string {
  return renderToStaticMarkup(
    <Album
      slug="AbCdEf0123456789"
      title="Nokuthula Mthembu"
      organiserName="Nomsa Mthembu"
      place="KwaMashu"
      eventDate={new Date('2026-08-15T00:00:00.000Z')}
      archetype={ARCHETYPES[archetype]}
      beads={entries.map((one) => bead(one))}
      entries={entries}
    />,
  )
}

const many = (count: number): readonly AlbumEntry[] =>
  Array.from({ length: count }, (_, index) =>
    entry({
      id: `e${String(index)}`,
      // Deliberately not numbered: the "no count" assertions read the visible
      // text, and a name carrying its own index would hide a real regression.
      name: 'Nomusa Ngcobo',
      form: index % 4 === 0 ? 'in_kind' : 'cash',
      description: index % 4 === 0 ? 'Chairs × 10' : null,
      message: index % 3 === 0 ? 'Sisemuva kwenu.' : null,
      photo:
        index % 5 === 0
          ? { digest: 'a'.repeat(32), width: 2400, height: 1600 }
          : null,
    }),
  )

describe('it renders at both ends of the criterion', () => {
  it('renders one entry', () => {
    const markup = album([entry({ message: 'Sisemuva kwenu.' })])

    expect(markup).toContain('Thandi Ngcobo')
    expect(markup).toContain('Sisemuva kwenu.')
    expect(markup.match(/class="entry"/g)).toHaveLength(1)
  })

  it('renders four hundred', () => {
    const markup = album(many(400))

    expect(markup.match(/class="entry"/g)).toHaveLength(400)
    // Every bead on the cover has an entry to point at, and every entry has
    // the anchor that bead names. A cover that pointed nowhere would be a page
    // that scrolls to the top when you tap it.
    expect(markup.match(/id="entry-/g)).toHaveLength(400)
    expect(markup.match(/href="#entry-/g)).toHaveLength(400)
  })

  it('says nothing rather than showing an empty list', () => {
    const markup = album([])

    expect(markup).not.toContain('class="entries"')
    expect(markup).toContain(albumCopy.foot)
  })
})

/**
 * The constraint, checked at every archetype rather than at the two the design
 * files cover. There is no `if (archetype === …)` in the album, so this is what
 * proves the shell is genuinely one shell.
 */
describe('the archetype constraint', () => {
  const archetypes = Object.keys(ARCHETYPES) as ArchetypeKey[]

  it.each(archetypes)('carries no amount at %s', (key) => {
    const text = visibleText(album(many(40), key))

    expect(text).not.toMatch(/R\s?\d/)
    expect(text).not.toMatch(/\d,\d{2}\b/)
  })

  it.each(archetypes)('carries no count of contributions at %s', (key) => {
    const text = visibleText(album(many(40), key))

    // The number of entries appears nowhere a reader can see it: not as a
    // heading, not as a total, not as "40 people". A group bead's own "N
    // people, one bead" is a different thing — it is what rule 14 requires a
    // group to say about itself — and no group is in this fixture.
    expect(text).not.toMatch(/\b40\b/)
  })

  it.each(archetypes)('carries no target, progress or countdown at %s', (key) => {
    const markup = styleless(album(many(10), key))

    expect(markup).not.toContain('<progress')
    expect(markup).not.toMatch(/days? (left|to go)/i)
    expect(markup).not.toMatch(/goal|target|raised|so far/i)
  })

  /**
   * The strand's one moving bead belongs to a live page where something has
   * just arrived. Nothing has just arrived on a record, so nothing settles —
   * at any archetype, including the ones that permit motion elsewhere.
   */
  it.each(archetypes)('moves nothing at %s', (key) => {
    const markup = styleless(album(many(10), key))

    expect(markup).not.toContain('beadNew')
  })

  it('declares no accent on bereavement and one everywhere else', () => {
    expect(styleless(album(many(3), 'umngcwabo'))).not.toContain('--accent')
    expect(styleless(album(many(3), 'umshado'))).toContain('--accent')
  })
})

describe('photos', () => {
  it('lazy-loads every one of them, at the full size', () => {
    const markup = album(many(400))

    const images = markup.match(/<img[^>]*class="entryPhoto"[^>]*>/g) ?? []
    expect(images).toHaveLength(80)

    for (const image of images) {
      expect(image).toContain('loading="lazy"')
      expect(image).toContain('-full.webp')
    }

    expect(markup).toContain('type="image/avif"')
  })

  /**
   * The reason M4-02 added two columns. Without them four hundred lazy images
   * each shift the layout as they land, which on a prepaid bundle is the whole
   * page moving for a minute.
   */
  it('reserves the space before the bytes arrive', () => {
    const markup = album([
      entry({ photo: { digest: 'b'.repeat(32), width: 2400, height: 1600 } }),
    ])

    expect(markup).toContain('width="2400"')
    expect(markup).toContain('height="1600"')
    expect(styleless(markup)).not.toContain('data-unsized')
  })

  it('falls back rather than guessing for a photo stored before the columns', () => {
    const markup = album([
      entry({ photo: { digest: 'c'.repeat(32), width: null, height: null } }),
    ])

    // A guessed ratio is a crop, and cropping somebody's photo of a gravestone
    // to fit a box is not a trade this makes. The CSS contains it instead.
    expect(styleless(markup)).toContain('data-unsized')
    expect(markup).not.toContain('width="')
  })

  it('describes where a photo came from rather than leaving it unlabelled', () => {
    const named = album([
      entry({ photo: { digest: 'd'.repeat(32), width: 800, height: 600 } }),
    ])
    const quiet = album([
      entry({ name: null, photo: { digest: 'd'.repeat(32), width: 800, height: 600 } }),
    ])

    expect(named).toContain(`alt="${albumCopy.photoFrom('Thandi Ngcobo')}"`)
    // Somebody who gave quietly keeps their words and their picture. What they
    // withheld is their name, and the alt text withholds it too.
    expect(quiet).toContain(`alt="${albumCopy.photoFrom('Someone')}"`)
  })
})

describe('what an entry says', () => {
  it('names a group once and lists who was in it, with no breakdown', () => {
    const markup = album([
      entry({
        form: 'group',
        name: 'The Ngcobo cousins',
        members: ['Sipho Ngcobo', 'Lindiwe Ngcobo'],
        memberCount: 5,
      }),
    ])

    expect(markup.match(/class="entry"/g)).toHaveLength(1)
    expect(markup).toContain('The Ngcobo cousins')
    expect(markup).toContain('Sipho Ngcobo')
    // Rule 14's own sentence: how many are inside, without naming the ones who
    // chose not to be named — and never who gave what.
    expect(markup).toContain('5 people, one bead')
    expect(visibleText(markup)).not.toMatch(/R\s?\d/)
  })

  it('keeps a quiet giver’s words and drops only their name', () => {
    const markup = album([entry({ name: null, message: 'Ngiyabonga.' })])

    expect(markup).toContain('Someone')
    expect(markup).toContain('Ngiyabonga.')
    expect(markup).not.toContain('Thandi')
  })

  it('writes the year, because a record is read later', () => {
    expect(album([entry()])).toContain('15 August 2026')
  })

  it('says what it is at the foot, without a total', () => {
    const markup = album(many(5))

    expect(markup).toContain(albumCopy.foot)
    expect(markup).toContain('a correction is written as its own line')
  })
})
