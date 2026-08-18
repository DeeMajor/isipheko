import { gzipSync } from 'node:zlib'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { StrandBead } from '@/db/repositories/strand'
import { ARCHETYPES } from '@/domain/archetype'
import { fromCents } from '@/domain/money'
import { densityFor } from '@/domain/strand'
import { LedgerStrand } from '@/ui/strand'

/**
 * The strand as markup.
 *
 * The done-criteria for M2-06 are counts — 1, 12, 40, 200 and 400 — and a
 * budget, so this renders at each of them and measures. It also holds the two
 * refusals the element exists to make: **no total, no count, no target**, and
 * **no motion where `animate` is false**.
 */

const NOW = new Date('2026-08-16T12:00:00.000Z')

function bead(index: number, overrides: Partial<StrandBead> = {}): StrandBead {
  const cash = index % 3 !== 0

  return {
    id: `entry-${String(index)}`,
    form: cash ? 'cash' : 'in_kind',
    name: `Person ${String(index)}`,
    amount: cash ? fromCents(BigInt(5_000 + index * 1_700)) : null,
    description: cash ? null : 'Chairs × 10',
    message: index === 0 ? 'Sengikhona. We are with you.' : null,
    at: new Date(NOW.getTime() - index * 60 * 60 * 1000),
    ...overrides,
  }
}

const strandOf = (count: number) =>
  Array.from({ length: count }, (_, index) => bead(index))

function render(count: number, options: { archetype?: keyof typeof ARCHETYPES } = {}) {
  return renderToStaticMarkup(
    <LedgerStrand
      slug="EventSlug0000001"
      archetype={ARCHETYPES[options.archetype ?? 'umshado']}
      beads={strandOf(count)}
      now={NOW}
    />,
  )
}

/** Every `<li>` in the markup — the strand is a list at every density. */
const listItems = (markup: string) => markup.match(/<li\b/g) ?? []

const buttons = (markup: string) => markup.match(/<button\b/g) ?? []

describe('rendering at the counts the criteria name', () => {
  it.each([1, 12, 40, 200, 400])('renders %i contributions', (count) => {
    const markup = render(count)

    expect(listItems(markup)).toHaveLength(count)
    // One button per bead. The panel adds a Close button only when open.
    expect(buttons(markup)).toHaveLength(count)
    expect(markup).toContain('<ul')
  })

  it('draws one cord up to thirty and braids past it', () => {
    expect(render(30)).toContain('strandCord')
    expect(render(31)).toContain('strandBraid')
    expect(render(31)).toContain('strandFrame')
    expect(render(400)).toContain('strandBraid')
  })

  it('says so plainly when nobody has been recorded', () => {
    const markup = renderToStaticMarkup(
      <LedgerStrand slug="EventSlug0000001" archetype={ARCHETYPES.umshado} beads={[]} />,
    )

    expect(markup).toContain('Nobody has been recorded here yet')
    expect(markup).not.toContain('<ul')
  })
})

describe('what the strand must never show', () => {
  it.each([1, 12, 40, 200, 400])('shows no total, count or target at %i', (count) => {
    const markup = render(count)
    const text = markup.replace(/<[^>]*>/g, ' ')

    // No money, anywhere, in any form. The amount picks a diameter and is
    // never printed — not as a total, not per bead.
    expect(text).not.toMatch(/R\s?\d/)
    expect(text).not.toMatch(/\d+\s*(of|van)\s*\d+/)
    expect(text.toLowerCase()).not.toContain('total')
    expect(text.toLowerCase()).not.toContain('target')
    expect(text.toLowerCase()).not.toContain('goal')
    expect(text.toLowerCase()).not.toContain('raised')
    expect(text.toLowerCase()).not.toContain('so far')
    // The number of contributions is not written down either — a strand that
    // announces "400 people" is a count with a picture attached. A quantity
    // inside a description ("Chairs × 10") is a different thing and stays.
    expect(text).not.toMatch(new RegExp(`\\b${String(count)}\\b`))
  })

  it('carries no progress bar markup at any archetype', () => {
    for (const key of Object.keys(ARCHETYPES) as (keyof typeof ARCHETYPES)[]) {
      const markup = render(40, { archetype: key })

      expect(markup).not.toContain('progress')
      expect(markup).not.toContain('<meter')
    }
  })
})

describe('motion', () => {
  it('settles the newest bead where the archetype animates', () => {
    expect(ARCHETYPES.umshado.animate).toBe(true)
    expect(render(12)).toContain('beadNew')
  })

  it('emits none at all on a bereavement page', () => {
    // `animate` is explicitly false there, and the check is `=== true`, so an
    // archetype that merely failed to declare the flag would also get nothing.
    expect(ARCHETYPES.umngcwabo.animate).toBe(false)

    for (const count of [1, 12, 40, 200, 400]) {
      const markup = renderToStaticMarkup(
        <LedgerStrand
          slug="EventSlug0000001"
          archetype={ARCHETYPES.umngcwabo}
          beads={strandOf(count)}
          now={NOW}
        />,
      )

      expect(markup).not.toContain('beadNew')
      expect(markup).not.toContain('animation')
    }
  })

  it('marks one bead at most, however many there are', () => {
    expect(render(400).match(/beadNew/g)).toHaveLength(1)
  })
})

describe('the accent is never a conditional', () => {
  it('renders the same bead structure on a funeral as on a wedding', () => {
    // Strip the geometry and the one motion class, and the two are the same
    // markup: the colour arrives from var(--accent, #16233D) falling back, and
    // nothing asks what kind of umcimbi this is.
    const bare = (markup: string) =>
      markup.replace(/ style="[^"]*"/g, '').replace(/ ?beadNew/g, '')

    expect(bare(render(12, { archetype: 'umngcwabo' }))).toBe(bare(render(12)))
  })

  it('gives every bead one diameter where amounts are hidden', () => {
    const diameters = (markup: string) =>
      new Set(Array.from(markup.matchAll(/--d:(\d+)px/g), (match) => match[1]))

    // Four monotonic sizes would let anybody compare what two people gave,
    // which is what the hidden default exists to prevent (architecture §7.3).
    expect(diameters(render(12, { archetype: 'umngcwabo' })).size).toBe(1)
    expect(diameters(render(12)).size).toBeGreaterThan(1)
  })

  it('names no archetype and no colour in the markup', () => {
    const markup = render(40, { archetype: 'umngcwabo' })

    expect(markup.toLowerCase()).not.toContain('umngcwabo')
    expect(markup.toLowerCase()).not.toContain('bereavement')
    // No colour literal anywhere: the accent arrives as var(--accent, …)
    // falling back, never as a value this component chose.
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('beads are real controls', () => {
  it('is one form of submit buttons, so it works with no script', () => {
    const markup = render(40)

    expect(markup).toContain('method="get"')
    expect(markup).toContain('action="/e/EventSlug0000001#strand"')
    expect(markup).toContain('type="submit"')
    expect(markup).toContain('name="bead"')
    expect(markup).not.toContain('onclick')
  })

  it('opens the bead the query string names, and only that one', () => {
    const markup = renderToStaticMarkup(
      <LedgerStrand
        slug="EventSlug0000001"
        archetype={ARCHETYPES.umshado}
        beads={strandOf(12)}
        openId="entry-0"
        now={NOW}
      />,
    )

    expect(markup).toContain('aria-expanded="true"')
    expect(markup.match(/aria-expanded="true"/g)).toHaveLength(1)
    expect(markup).toContain('Sengikhona. We are with you.')
    expect(markup).toContain('id="bead-entry-0"')
    // The open bead's own button closes it, so nothing needs a script to
    // toggle and nothing else has to know it is open.
    expect(markup).toContain('value=""')
  })

  it('references a panel only while the panel exists', () => {
    expect(render(12)).not.toContain('aria-controls')
  })
})

describe('who a bead is', () => {
  it('withholds the name of somebody who gave quietly, and keeps their words', () => {
    const markup = renderToStaticMarkup(
      <LedgerStrand
        slug="EventSlug0000001"
        archetype={ARCHETYPES.umshado}
        beads={[bead(0, { name: null, message: 'From the family next door.' })]}
        openId="entry-0"
        now={NOW}
      />,
    )

    expect(markup).toContain('Someone')
    expect(markup).toContain('From the family next door.')
  })

  it('reads a group as one act by many people, never one bead each', () => {
    const members = ['Nomsa', 'Thandi', 'Sipho', 'Zanele', 'Musa', 'Ayanda']
    const markup = renderToStaticMarkup(
      <LedgerStrand
        slug="EventSlug0000001"
        archetype={ARCHETYPES.umshado}
        beads={[
          bead(0),
          bead(1, {
            form: 'group',
            name: 'The Ngcobo cousins',
            amount: null,
            description: 'Toward the catering',
            members,
          }),
        ]}
        openId="entry-1"
        now={NOW}
      />,
    )

    // Two beads for two entries — six members do not become six beads.
    expect(listItems(markup)).toHaveLength(2)
    expect(markup).toContain('beadGroup')
    expect(markup).toContain('6 people, one bead')
    for (const member of members) expect(markup).toContain(member)
  })

  it('tells a screen reader who each bead is on a braided strand', () => {
    const markup = render(40)

    expect(markup).toContain('Person 1 — Money')
    expect(markup).toContain('Person 0 — Bringing Chairs × 10')
    expect(markup).toContain('beadHidden')
  })
})

describe('the budget', () => {
  it('stays inside 15KB at two hundred contributions', () => {
    const markup = render(200)
    const gzipped = gzipSync(Buffer.from(markup, 'utf8')).byteLength

    expect(densityFor(200).cords).toBe(3)
    expect(gzipped).toBeLessThanOrEqual(15 * 1024)
  })

  it('grows sub-linearly, because geometry travels as two custom properties', () => {
    const two = gzipSync(Buffer.from(render(200), 'utf8')).byteLength
    const four = gzipSync(Buffer.from(render(400), 'utf8')).byteLength

    expect(four).toBeLessThan(two * 2.5)
  })
})
