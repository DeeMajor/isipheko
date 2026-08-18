import { describe, expect, it } from 'vitest'

import { offsetsWithin, paginate, wrapText, type Measured } from '@/domain/print'

/**
 * Flowing a record onto fixed pages.
 *
 * The web album scrolls, so M4-02 never had to answer any of this. Paper does
 * not: something decides where one page stops, and it has to decide the same
 * way every time or two copies of one album are two different books.
 */

const measured = (heights: readonly number[]): Measured<string>[] =>
  heights.map((height, index) => ({ item: `e${String(index)}`, height }))

describe('pagination', () => {
  it('fills a page before starting the next', () => {
    const pages = paginate(measured([100, 100, 100, 100]), {
      usableHeight: 250,
      gap: 20,
    })

    // 100 + 20 + 100 = 220 fits; adding a third would be 340.
    expect(pages).toEqual([['e0', 'e1'], ['e2', 'e3']])
  })

  it('adds no gap before the first entry on a page', () => {
    const pages = paginate(measured([90, 90, 90]), { usableHeight: 200, gap: 20 })

    expect(pages[0]).toEqual(['e0', 'e1'])
    expect(pages[1]).toEqual(['e2'])
  })

  /**
   * **An entry is never split**, and that is the point rather than a
   * simplification.
   *
   * An entry is one person: their name, what they brought, what they said and
   * their photograph. A break through the middle puts a stranger's name at the
   * foot of one page and their words on the next, which is exactly the
   * indignity a record like this exists to avoid. The renderer shrinks the
   * photograph instead — the one part of an entry that can give.
   */
  it('gives an over-tall entry its own page rather than splitting it', () => {
    const pages = paginate(measured([50, 900, 50]), { usableHeight: 300, gap: 10 })

    expect(pages).toEqual([['e0'], ['e1'], ['e2']])
  })

  it('renders one entry as one page and nothing as no pages', () => {
    expect(paginate(measured([40]), { usableHeight: 300, gap: 10 })).toEqual([['e0']])
    expect(paginate([], { usableHeight: 300, gap: 10 })).toEqual([])
  })

  it('keeps every entry, in order, at four hundred', () => {
    const heights = Array.from({ length: 400 }, (_, index) => 60 + (index % 7) * 12)
    const pages = paginate(measured(heights), { usableHeight: 520, gap: 20 })

    const flat = pages.flat()

    expect(flat).toHaveLength(400)
    expect(flat[0]).toBe('e0')
    expect(flat.at(-1)).toBe('e399')
    // Nothing duplicated across a break.
    expect(new Set(flat).size).toBe(400)
  })

  it('never overfills a page', () => {
    const heights = Array.from({ length: 200 }, (_, index) => 40 + (index % 11) * 30)
    const pages = paginate(measured(heights), { usableHeight: 520, gap: 20 })

    const heightOf = new Map(
      measured(heights).map((entry) => [entry.item, entry.height]),
    )

    for (const page of pages) {
      const used = page.reduce(
        (sum, item, index) => sum + (heightOf.get(item) ?? 0) + (index > 0 ? 20 : 0),
        0,
      )

      // A single entry taller than a page is allowed to be — it has nowhere
      // else to go. Anything else must fit.
      if (page.length > 1) expect(used).toBeLessThanOrEqual(520)
    }
  })
})

describe('placing entries down a page', () => {
  it('stacks them with the gap between, and none after the last', () => {
    expect(offsetsWithin(['a', 'b', 'c'], () => 100, 20)).toEqual([0, 120, 240])
  })

  it('is empty for an empty page', () => {
    expect(offsetsWithin([], () => 100, 20)).toEqual([])
  })
})

describe('wrapping', () => {
  // A crude measure: ten points a character. Enough to test the greedy rule
  // without a font, which is the point of the function taking a measurer.
  const width = (run: string) => run.length * 10

  it('breaks greedily at word boundaries', () => {
    // "three four" measures exactly 100 and therefore fits: the rule is
    // "wider than the line", not "as wide as".
    expect(wrapText('one two three four', 100, width)).toEqual([
      'one two',
      'three four',
    ])
    expect(wrapText('one two three four', 95, width)).toEqual([
      'one two',
      'three',
      'four',
    ])
  })

  it('leaves a single long word alone rather than breaking it', () => {
    // Hyphenation needs a dictionary, and a wrong break in a surname is worse
    // than a line that runs a little wide.
    expect(wrapText('Nokuthulakazi', 50, width)).toEqual(['Nokuthulakazi'])
  })

  it('collapses whitespace and answers nothing for nothing', () => {
    expect(wrapText('  one   two  ', 1000, width)).toEqual(['one two'])
    expect(wrapText('   ', 100, width)).toEqual([])
    expect(wrapText('', 100, width)).toEqual([])
  })
})
