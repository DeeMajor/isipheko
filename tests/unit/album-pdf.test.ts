import { inflateSync } from 'node:zlib'

import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import { PdfLibAlbumRenderer } from '@/adapters/pdf'
import { ARCHETYPES, type ArchetypeKey } from '@/domain/archetype'
import {
  BLEED_MM,
  TRIM_HEIGHT_MM,
  TRIM_WIDTH_MM,
  albumVersion,
  isAlbumVersion,
  mm,
  toMm,
  type AlbumVersionSubject,
  type PrintableAlbum,
  type PrintableEntry,
} from '@/domain/print'

/**
 * The preflight, as far as one can be run without a print shop.
 *
 * **This is not a real preflight and the plan says so.** A genuine one runs a
 * printer's own profile against the file at their counter, and no test here can
 * stand in for that. What it can do is assert every structural property such a
 * check looks at — the boxes, the bleed, the embedded subset fonts, the image
 * encoding, the absence of transparency — so that what remains unverified is
 * only the colour conversion, which is the printer's to make (M4-03 §4).
 *
 * Run against a really-generated document, at one entry and at four hundred.
 */

const renderer = new PdfLibAlbumRenderer()

const GENERATED_AT = new Date('2026-08-18T09:00:00.000Z')

let photo: Uint8Array

beforeAll(async () => {
  photo = new Uint8Array(
    await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#4A7C59' },
    })
      .jpeg()
      .toBuffer(),
  )
})

function entry(index: number, withPhoto: boolean): PrintableEntry {
  return {
    id: `e${String(index)}`,
    name: 'Nomusa Ngcobo',
    what: index % 4 === 0 ? 'Bringing Chairs × 10' : 'Money',
    message:
      index % 3 === 0
        ? 'Sisemuva kwenu. We are thinking of the whole family today.'
        : null,
    members: [],
    membersLabel: null,
    when: '15 August 2026',
    photo:
      withPhoto && index % 5 === 0
        ? { jpeg: photo, width: 1200, height: 800 }
        : null,
  }
}

function album(
  count: number,
  {
    archetype = 'umngcwabo',
    photos = true,
  }: { archetype?: ArchetypeKey; photos?: boolean } = {},
): PrintableAlbum {
  return {
    archetype: ARCHETYPES[archetype],
    cover: {
      title: 'Nokuthula Mthembu',
      kicker: 'Who has stood with the family',
      organiserName: 'Nomsa Mthembu',
      meta: 'Saturday, 15 August · KwaMashu',
      intro: 'Everyone who stood with the family, in the order they came.',
      beads: Array.from({ length: Math.min(count, 400) }, (_, index) => ({
        x: (index % 5) * 12 - 24,
        y: Math.floor(index / 5) * 4,
        diameter: 4,
        form: index % 4 === 0 ? ('in_kind' as const) : ('cash' as const),
      })),
      strandHeight: mm(60),
    },
    entries: Array.from({ length: count }, (_, index) => entry(index, photos)),
    colophon: [
      'This book is the record of an umcimbi, printed from Isipheko.',
      'A5, 148 × 210mm trimmed, 3mm bleed on every edge. Colours are RGB.',
    ],
    generatedAt: GENERATED_AT,
  }
}

const asLatin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

/**
 * Everything in the file, as searchable text.
 *
 * `pdf-lib` writes object streams and deflates content streams, so a naive scan
 * of the bytes finds none of the things a preflight looks for — no `/FontFile2`
 * and no colour operators, because both are inside a compressed object. This
 * inflates every Flate stream and concatenates the lot, which is the closest a
 * test gets to opening the file in a tool.
 */
function readable(bytes: Uint8Array): string {
  const raw = asLatin1(bytes)
  const parts: string[] = [raw]

  // Every stream payload, inflated where it will inflate. Dictionaries are
  // deliberately not parsed: `<<...>>` nests, and a lazy match for the closing
  // pair silently truncates exactly the object streams that hold the font
  // entries — which is how this test first passed against nothing.
  const markers = /stream\r?\n/g

  for (const marker of raw.matchAll(markers)) {
    const start = (marker.index ?? 0) + marker[0].length
    const end = raw.indexOf('endstream', start)
    if (end === -1) continue

    try {
      parts.push(
        inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'),
      )
    } catch {
      // Not deflated — an embedded JPEG, say. It is already in `raw`.
    }
  }

  return parts.join('\n')
}

describe.each([
  ['one entry', 1],
  ['four hundred entries', 400],
])('at %s', (_label, count) => {
  let bytes: Uint8Array
  let raw: string

  beforeAll(async () => {
    bytes = await renderer.render(album(count))
    raw = readable(bytes)
  }, 120_000)

  it('is a PDF that loads', async () => {
    expect(asLatin1(bytes).startsWith('%PDF-')).toBe(true)

    const document = await PDFDocument.load(bytes)
    // Cover, at least one page of entries, colophon.
    expect(document.getPageCount()).toBeGreaterThanOrEqual(3)
  })

  /**
   * The three boxes, on **every** page. A trim box on the cover and nothing on
   * page nine is a file that imposes wrong halfway through the book.
   */
  it('sets a media, bleed and trim box on every page', async () => {
    const document = await PDFDocument.load(bytes)

    for (const page of document.getPages()) {
      const media = page.getMediaBox()
      const bleed = page.getBleedBox()
      const trim = page.getTrimBox()

      expect(toMm(media.width)).toBeCloseTo(TRIM_WIDTH_MM + BLEED_MM * 2, 3)
      expect(toMm(media.height)).toBeCloseTo(TRIM_HEIGHT_MM + BLEED_MM * 2, 3)

      expect(toMm(trim.width)).toBeCloseTo(TRIM_WIDTH_MM, 3)
      expect(toMm(trim.height)).toBeCloseTo(TRIM_HEIGHT_MM, 3)

      // The trim sits 3mm inside the sheet on every side — which is the bleed.
      expect(toMm(trim.x)).toBeCloseTo(BLEED_MM, 3)
      expect(toMm(trim.y)).toBeCloseTo(BLEED_MM, 3)

      expect(toMm(bleed.width)).toBeCloseTo(toMm(media.width), 3)
    }
  })

  /**
   * A font referenced but not embedded is the single most common preflight
   * failure there is: the press substitutes something, and a page that was
   * checked in one typeface prints in another.
   */
  it('embeds every font and references no standard one', () => {
    expect(raw).toContain('/FontFile2')
    expect(raw).toContain('/BaseFont /PublicSans')

    for (const standard of ['Helvetica', 'Times-Roman', 'Courier', 'Arial']) {
      expect(raw).not.toContain(`/BaseFont /${standard}`)
    }
  })

  /**
   * **A known deviation, asserted so it cannot be forgotten.**
   *
   * A subset font is supposed to carry a six-letter tag on its name —
   * `AAAAAA+PublicSans`. `pdf-lib` subsets the glyphs properly but names the
   * result `PublicSans-Regular-979`, with no tag. Some commercial preflights
   * flag that, and this test exists to record it rather than to hide it: if a
   * future pdf-lib starts emitting the tag, this fails and the note in
   * docs/decisions.md M4-03 §3 comes out.
   */
  it('names its subsets the way pdf-lib does, without the conventional tag', () => {
    expect(raw).not.toMatch(/\/BaseFont\s*\/[A-Z]{6}\+/)
  })

  /**
   * No transparency and no soft masks. Both are legal PDF and both are what a
   * commercial preflight flags first, because flattening them at the RIP is
   * where colour shifts and hairlines appear.
   */
  it('carries no transparency', () => {
    expect(raw).not.toContain('/SMask')
    expect(raw).not.toContain('/Transparency')
    expect(raw).not.toContain('/CA ')
    expect(raw).not.toContain('/ca ')
  })

  it('says what it is, including that it is RGB', async () => {
    const document = await PDFDocument.load(bytes)

    expect(document.getTitle()).toBe('Nokuthula Mthembu')
    // A colour space discovered at the press is discovered too late.
    expect(document.getSubject()).toContain('RGB')
    // Creator is the application; Producer is the library that wrote the file.
    // Naming ourselves as the Producer would misname the field a printer reads
    // when they need to know what made a document.
    expect(document.getCreator()).toBe('Isipheko')
    expect(document.getProducer()).toContain('pdf-lib')
    expect(document.getCreationDate()?.getTime()).toBe(GENERATED_AT.getTime())
  })

  /**
   * The rule from M4-02 §3, and it matters more here: this is the artefact that
   * gets printed and passed around. `PrintableEntry` has no amount field and
   * `PrintableBead` carries a diameter rather than a value, so the number the
   * band was computed from never crosses into the renderer at all.
   */
  it('has no way to carry an amount', () => {
    const one = entry(0, true)

    expect(Object.keys(one)).not.toContain('amount')
    expect(Object.keys(one)).not.toContain('amountCents')

    const bead = album(1).cover.beads[0]
    expect(Object.keys(bead ?? {})).not.toContain('amount')
    expect(Object.keys(bead ?? {}).sort()).toEqual(['diameter', 'form', 'x', 'y'])
  })

  it('renders the same bytes twice for the same album', async () => {
    const again = await renderer.render(album(count))

    // Not a nicety: an album that renders differently each time is one whose
    // content-addressed URL lies about what is behind it.
    expect(readable(again).length).toBe(raw.length)
  }, 120_000)
})

describe('photographs', () => {
  it('embeds them as JPEG, which is what a PDF can hold', async () => {
    const raw = readable(await renderer.render(album(5)))

    // AVIF and WebP are what M4-01 stores and neither can go in a PDF, so the
    // orchestration transcodes. DCTDecode is the filter that says JPEG.
    expect(raw).toContain('/DCTDecode')
    expect(raw).toContain('/Subtype /Image')
  })

  it('renders an album with no photographs at all', async () => {
    const bytes = await renderer.render(album(3, { photos: false }))
    const document = await PDFDocument.load(bytes)

    expect(document.getPageCount()).toBeGreaterThanOrEqual(3)
    expect(readable(bytes)).not.toContain('/DCTDecode')
  })
})

/**
 * One shell for seven archetypes, on paper as on screen.
 *
 * The accent is the print equivalent of `var(--accent, #16233D)`: bereavement
 * declares none and gets indigo, with nothing in the renderer asking what
 * archetype it is (rule 2).
 */
describe('the archetype constraint', () => {
  const archetypes = Object.keys(ARCHETYPES) as ArchetypeKey[]

  it.each(archetypes)('renders at %s', async (key) => {
    const document = await PDFDocument.load(
      await renderer.render(album(6, { archetype: key })),
    )

    expect(document.getPageCount()).toBeGreaterThanOrEqual(3)
  })

  it('paints a bereavement cover in ink and a wedding cover in its accent', async () => {
    const funeral = readable(await renderer.render(album(3, { archetype: 'umngcwabo' })))
    const wedding = readable(await renderer.render(album(3, { archetype: 'umshado' })))

    // #16233D — the ink, which is what an archetype declaring no accent falls
    // back to. #8C2F22 is Union's.
    const ink = '0.08627450980392157 0.13725490196078433 0.23921568627450981'
    const union = '0.5490196078431373 0.1843137254901961 0.13333333333333333'

    expect(funeral).toContain(ink)
    expect(funeral).not.toContain(union)
    expect(wedding).toContain(union)
  })
})

describe('the version a file is named after', () => {
  const one = {
    id: 'a',
    name: 'Thandi Ngcobo',
    description: null,
    message: 'Sisemuva kwenu.',
    photoDigest: null,
  } satisfies AlbumVersionSubject['entries'][number]

  const subject: AlbumVersionSubject = {
    title: 'Nokuthula Mthembu',
    organiserName: 'Nomsa Mthembu',
    archetype: 'umngcwabo',
    entries: [one],
  }

  it('is stable for the same record', () => {
    expect(albumVersion(subject)).toBe(albumVersion(subject))
    expect(isAlbumVersion(albumVersion(subject))).toBe(true)
  })

  /**
   * The property that matters on paper: a family who printed in August and
   * again in October should hold two different books at two different
   * addresses, not one URL that changed underneath them.
   */
  it.each<[string, AlbumVersionSubject]>([
    ['a new entry', { ...subject, entries: [one, { ...one, id: 'b' }] }],
    ['a changed message', { ...subject, entries: [{ ...one, message: 'Ngiyabonga.' }] }],
    ['an added photo', { ...subject, entries: [{ ...one, photoDigest: 'a'.repeat(32) }] }],
    ['a renamed umcimbi', { ...subject, title: 'Somebody Else' }],
    ['a quiet giver becoming named', { ...subject, entries: [{ ...one, name: null }] }],
  ])('changes on %s', (_what, changed) => {
    expect(albumVersion(changed)).not.toBe(albumVersion(subject))
  })

  it('does not run two fields together', () => {
    // The classic canonicalisation bug: without a separator, "ab" + "c" and
    // "a" + "bc" hash the same, and two different records share one file.
    const first = albumVersion({
      ...subject,
      entries: [{ ...one, id: 'ab', name: 'c' }],
    })
    const second = albumVersion({
      ...subject,
      entries: [{ ...one, id: 'a', name: 'bc' }],
    })

    expect(first).not.toBe(second)
  })
})
