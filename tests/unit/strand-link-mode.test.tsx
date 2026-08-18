import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { StrandBead } from '@/db/repositories/strand'
import { ARCHETYPES } from '@/domain/archetype'
import { fromCents } from '@/domain/money'
import { LedgerStrand } from '@/ui/strand'

/**
 * The strand has two modes, and the difference is what the beads are.
 *
 * On the event page a bead is a **submit button** in a `<form method="get">`:
 * opening one is a server round-trip that works with no script at all, and the
 * panel it opens is the only place that bead's words appear.
 *
 * On the album's cover every entry is already further down the same page, so a
 * bead is an **anchor** to the one it stands for. A round-trip there would
 * fetch content the reader can reach by scrolling, and land them back at the
 * top of a page they have already started reading.
 */

const beads = (count: number): readonly StrandBead[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `b${String(index)}`,
    form: index % 3 === 0 ? ('in_kind' as const) : ('cash' as const),
    name: 'Nomusa Ngcobo',
    amount: index % 3 === 0 ? null : fromCents(50_000n),
    description: index % 3 === 0 ? 'Chairs × 10' : null,
    message: 'Sisemuva kwenu.',
    at: new Date('2026-08-15T09:00:00.000Z'),
  }))

const render = (count: number, link: boolean, archetype = 'umshado' as const) =>
  renderToStaticMarkup(
    <LedgerStrand
      slug="AbCdEf0123456789"
      archetype={ARCHETYPES[archetype]}
      beads={beads(count)}
      openId="b1"
      now={new Date('2026-08-16T09:00:00.000Z')}
      {...(link ? { hrefFor: (id: string) => `#entry-${id}` } : {})}
    />,
  )

describe.each([
  ['one cord', 10],
  ['braided', 120],
])('at %s density', (_name, count) => {
  it('is a form of submit buttons on the event page', () => {
    const markup = render(count, false)

    // React writes attributes in its own order, so this asks for the two facts
    // rather than for a string that happens to be how it renders today.
    expect(markup).toContain('<form ')
    expect(markup).toContain('method="get"')
    expect(markup.match(/<button/g)).not.toBeNull()
    expect(markup).not.toContain('href="#entry-')
  })

  it('is anchors on the album’s cover, with no form and nothing to submit', () => {
    const markup = render(count, true)

    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('<button')
    expect(markup.match(/href="#entry-b\d+"/g)).toHaveLength(count)
  })

  /**
   * The geometry is the whole point of reusing the component rather than
   * drawing a second strand. Same cords, same bands, same list.
   */
  it('keeps the same geometry and the same list either way', () => {
    const asForm = render(count, false)
    const asLinks = render(count, true)

    for (const markup of [asForm, asLinks]) {
      expect(markup).toContain('class="strand strand')
      expect(markup.match(/class="beadRow"/g)).toHaveLength(count)
      expect(markup.match(/class="beadDot"/g)).toHaveLength(count)
    }
  })

  /**
   * `?bead=` opens a panel on the event page. On the album the panel's content
   * is the entry the anchor points at, so rendering one here would put the same
   * words on the page twice and put them in the wrong place once.
   */
  it('opens no panel in link mode, even when one is asked for', () => {
    expect(render(count, false)).toContain('beadPanel')
    expect(render(count, true)).not.toContain('beadPanel')
  })

  /**
   * The strand's motion is one bead settling as it arrives. Nothing has just
   * arrived on a record, and `umshado` is an archetype that permits motion —
   * so this is the case where a missing check would show.
   */
  it('settles no bead in link mode at an archetype that allows motion', () => {
    expect(render(count, false)).toContain('beadNew')
    expect(render(count, true)).not.toContain('beadNew')
  })
})
