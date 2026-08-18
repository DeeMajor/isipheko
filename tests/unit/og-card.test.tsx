import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { shareCopy } from '@/copy/share'

import { ARCHETYPES, type ArchetypeConfig, type ArchetypeKey } from '@/domain/archetype'
import { CARD_HEIGHT, CARD_WIDTH, OgCard, cardAccent, clamp } from '@/ui/og-card'

/**
 * The card as an element tree.
 *
 * Satori turns this into a PNG, and a PNG cannot be asserted on usefully — so
 * what is checked here is what the tree says: no amount, no count, no target,
 * no tick nobody earned, and no colour where an archetype declares none. The
 * rendering itself is checked end to end against the running route.
 */

const FONT_DIR = 'src/assets/fonts'

function render(
  key: ArchetypeKey,
  overrides: Partial<Parameters<typeof OgCard>[0]> = {},
) {
  return renderToStaticMarkup(
    <OgCard
      archetype={ARCHETYPES[key]}
      title="Nokuthula Mthembu"
      subtitle="uMaZondi"
      organiserName="Nomsa Mthembu"
      meta="Umngcwabo · Saturday, 15 August · KwaMashu"
      {...overrides}
    />,
  )
}

describe('the fonts Satori reads', () => {
  it('is exactly the two woff faces, and no woff2', () => {
    // Satori reads ttf, otf and woff — never woff2, which is all the page
    // ships. These live in src/assets/ so no browser ever downloads them and
    // M1-05's "exactly two woff2 files ship" test stays true.
    expect(readdirSync(FONT_DIR).sort()).toEqual([
      'public-sans-latin-400.woff',
      'public-sans-latin-800.woff',
    ])
  })

  it.each([
    [
      'public-sans-latin-400.woff',
      18_488,
      'edb388a938d470f8b44a273d7b4af7078e731f336afac02fc9376bdf0482193d',
    ],
    [
      'public-sans-latin-800.woff',
      18_600,
      '76b2098e6ce75211cc228c67d5885fc22e0dcccca3388112e4a4aa3ff44d12e5',
    ],
  ])('%s is the exact binary that was reviewed', (name, bytes, sha256) => {
    // Same reasoning as M1-05: a swapped font binary produces no error, just a
    // card with different metrics that nobody traces back to the file.
    const file = readFileSync(`${FONT_DIR}/${name}`)

    expect(file.byteLength).toBe(bytes)
    expect(createHash('sha256').update(file).digest('hex')).toBe(sha256)
  })
})

describe('the accent', () => {
  it('falls back to ink where an archetype declares none', () => {
    // Satori has no cascade, so `var(--accent, #16233D)` cannot do this work.
    // One function applies the fallback, and nothing asks about the group.
    // The annotation is the one M1-05 §9 records: "absent" and "undefined" are
    // different types, which is the whole mechanism.
    const funeral: ArchetypeConfig = ARCHETYPES.umngcwabo
    expect(funeral.accent).toBeUndefined()
    expect(cardAccent(ARCHETYPES.umngcwabo)).toBe('#16233d')
    expect(cardAccent(ARCHETYPES.umshado)).toBe('#8C2F22')
  })

  it('draws each archetype in its own colour and nothing else', () => {
    for (const key of Object.keys(ARCHETYPES) as ArchetypeKey[]) {
      const markup = render(key)
      const colours = new Set(markup.match(/#[0-9a-fA-F]{6}/g) ?? [])

      // The palette, plus that archetype's accent. No stray colour invented in
      // a component (Part C.2).
      const allowed = new Set([
        '#16233d',
        '#4a5670',
        '#f2f1ed',
        '#ffffff',
        '#d8d6ce',
        cardAccent(ARCHETYPES[key]),
      ])

      for (const colour of colours) {
        expect(
          allowed.has(colour) || allowed.has(colour.toLowerCase()),
          `${key} ${colour}`,
        ).toBe(true)
      }
    }
  })
})

describe('what the card must not carry', () => {
  it('shows no amount, count, target or progress on any archetype', () => {
    for (const key of Object.keys(ARCHETYPES) as ArchetypeKey[]) {
      const text = render(key).replace(/<[^>]*>/g, ' ')

      // A card is forwarded, screenshotted, and read by people who never open
      // the page. Anything on it that can be added up travels further than the
      // strand's own privacy rules reach.
      expect(text, key).not.toMatch(/R\s?\d/)
      expect(text.toLowerCase(), key).not.toContain('total')
      expect(text.toLowerCase(), key).not.toContain('target')
      expect(text.toLowerCase(), key).not.toContain('raised')
      expect(text.toLowerCase(), key).not.toContain('goal')
      expect(text.toLowerCase(), key).not.toContain('donate')
    }
  })

  it('draws no badge until somebody has actually been verified', () => {
    const unverified = render('umshado')

    expect(unverified).not.toContain('<svg')
    expect(unverified.toLowerCase()).not.toContain('verified')
  })

  it('draws the badge once somebody has been verified, and only then', () => {
    // Real since M3-02, and the only thing that turns it on is the organiser's
    // status reaching `cardFacts`.
    const verified = render('umshado', { verified: true })

    expect(verified).toContain('<svg')
    expect(verified).toContain('verified')
  })

  it('draws the tick rather than typing it, because Satori has no font for one', () => {
    // Public Sans carries no U+2713. Satori answers a missing glyph by fetching
    // a font over the network — a request per card, and the exact thing M1-05
    // hardcoded the @font-face rules to prevent. Caught by the e2e suite
    // logging "Failed to download dynamic font" while the test still passed.
    const verified = render('umngcwabo', { verified: true })

    expect(verified).not.toContain('✓')
    // Nothing outside latin: the two committed faces are the whole alphabet
    // this card has.
    expect(verified.replace(/<[^>]*>/g, '')).not.toMatch(/[^\u0000-\u024F·—’“”]/)
  })

  it('puts no verification date on the card, only the tick', () => {
    // The date belongs above the fold on the page, where somebody has come to
    // read. A card is a thumbnail in a chat and every extra word costs the name
    // legibility at the size that matters (M2-07 §7). The meta line's event
    // date is a different thing and stays.
    expect(shareCopy.card.organiserVerified('Nomsa Mthembu')).not.toMatch(/\d/)

    const verified = render('umngcwabo', { verified: true })
    const dates = verified.match(/\d{1,2} August/g) ?? []

    expect(dates).toHaveLength(1)
  })
})

describe('what the card does carry', () => {
  it('is the title, the name and the meta line', () => {
    const text = render('umngcwabo').replace(/<[^>]*>/g, ' ')

    expect(text).toContain('Nokuthula Mthembu')
    expect(text).toContain('uMaZondi')
    expect(text).toContain('Organised by Nomsa Mthembu')
    expect(text).toContain('Umngcwabo · Saturday, 15 August · KwaMashu')
    expect(text).toContain('isipheko.co.za')
  })

  it('survives the parts an event may not have', () => {
    const text = render('itiye', {
      subtitle: null,
      organiserName: null,
      meta: '',
    }).replace(/<[^>]*>/g, ' ')

    expect(text).toContain('Nokuthula Mthembu')
    expect(text).not.toContain('Organised by')
    // No dangling separators where a missing field used to be.
    expect(text).not.toMatch(/·\s*·/)
  })

  it('centres its content, because WhatsApp crops thumbnails from the middle', () => {
    // Anything set against the left edge is the first thing to disappear in a
    // square crop — including a name, which is the thing carrying the card.
    expect(render('umshado')).toContain('text-align:center')
  })

  it('is 1200×630, the size every crawler expects', () => {
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1200, 630])
  })
})

describe('long text', () => {
  it('is cut here rather than by the renderer', () => {
    // Satori's overflow is not a browser's, and a title that overflowed would
    // be found in somebody's chat rather than in review.
    expect(clamp('Nokuthula Mthembu', 64)).toBe('Nokuthula Mthembu')
    expect(clamp('a'.repeat(80), 10)).toBe(`${'a'.repeat(9)}…`)
  })

  it('cuts at a word boundary when there is one to use', () => {
    expect(clamp('Nokuthula Mthembu Zondi Ngcobo', 20)).toBe('Nokuthula Mthembu…')
  })

  it('keeps a very long title inside the card', () => {
    const title =
      'The memorial service and unveiling of the late Nokuthula Mthembu of KwaMashu'
    const text = render('umbuyiso', { title }).replace(/<[^>]*>/g, ' ')

    expect(text).toContain('…')
    expect(text).not.toContain(title)
  })
})
