import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import fontkit from '@pdf-lib/fontkit'
import { beforeAll, describe, expect, it } from 'vitest'

import { WoffError, woffToTtf } from '@/adapters/pdf/woff-to-ttf'

/**
 * The converter M4-03 uses instead of committing a third copy of the typeface.
 *
 * The property that matters is not "it produced some bytes" — it is that what
 * comes out is the **same font**, parseable by the thing that will embed it.
 * So the assertions are made by fontkit, which is what `pdf-lib` uses to embed
 * a font, over both files the product actually ships to Satori.
 */

const FONT_DIR = join(process.cwd(), 'src', 'assets', 'fonts')

const FILES = ['public-sans-latin-400.woff', 'public-sans-latin-800.woff'] as const

const sources = new Map<string, Uint8Array>()

beforeAll(async () => {
  for (const name of FILES) {
    sources.set(name, new Uint8Array(await readFile(join(FONT_DIR, name))))
  }
})

/** Reads the WOFF's own directory, so the comparison is against the source. */
function woffTables(woff: Uint8Array): { count: number; tags: string[] } {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)
  const count = view.getUint16(12)
  const tags: string[] = []

  for (let index = 0; index < count; index += 1) {
    const at = 44 + index * 20
    tags.push(
      String.fromCharCode(
        view.getUint8(at),
        view.getUint8(at + 1),
        view.getUint8(at + 2),
        view.getUint8(at + 3),
      ),
    )
  }

  return { count, tags: tags.sort() }
}

describe.each(FILES)('%s', (name) => {
  it('is a WOFF1 to begin with, which is the whole reason this works', () => {
    const woff = sources.get(name) ?? new Uint8Array()

    // 'wOFF'. WOFF2 is 'wOF2' and is a different problem entirely — brotli and
    // a glyph transform — which is why the conversion is this short.
    expect(Array.from(woff.slice(0, 4))).toEqual([0x77, 0x4f, 0x46, 0x46])
  })

  it('parses as a font once converted', () => {
    const ttf = woffToTtf(sources.get(name) ?? new Uint8Array())
    const font = fontkit.create(Buffer.from(ttf))

    expect(font.numGlyphs).toBeGreaterThan(0)
    expect(font.unitsPerEm).toBeGreaterThan(0)
  })

  it('carries every table the source had, and no others', () => {
    const woff = sources.get(name) ?? new Uint8Array()
    const ttf = woffToTtf(woff)

    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
    const count = view.getUint16(4)
    const tags: string[] = []

    for (let index = 0; index < count; index += 1) {
      const at = 12 + index * 16
      tags.push(
        String.fromCharCode(
          view.getUint8(at),
          view.getUint8(at + 1),
          view.getUint8(at + 2),
          view.getUint8(at + 3),
        ),
      )
    }

    const source = woffTables(woff)

    expect(count).toBe(source.count)
    expect(tags.sort()).toEqual(source.tags)
  })

  /**
   * The point of doing it this way rather than shipping a converted binary:
   * the printed album uses **this** font file, not one converted elsewhere by
   * somebody at some point. So the glyphs have to be the same glyphs.
   */
  it('has the same glyphs, and can still measure the words on the page', () => {
    const ttf = woffToTtf(sources.get(name) ?? new Uint8Array())
    const font = fontkit.create(Buffer.from(ttf))

    // Latin subset: enough for isiZulu and English, which is what the site
    // loads without pulling latin-ext.
    const run = font.layout('Nokuthula Mthembu')

    expect(run.glyphs.length).toBe('Nokuthula Mthembu'.length)
    expect(run.glyphs.every((glyph) => glyph.id !== 0)).toBe(true)
    expect(run.advanceWidth).toBeGreaterThan(0)
  })

  it('writes a directory a validator would accept', () => {
    const ttf = woffToTtf(sources.get(name) ?? new Uint8Array())
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)

    const count = view.getUint16(4)
    const entrySelector = view.getUint16(8)
    const searchRange = view.getUint16(6)

    expect(entrySelector).toBe(Math.floor(Math.log2(count)))
    expect(searchRange).toBe(16 * 2 ** entrySelector)
    expect(view.getUint16(10)).toBe(count * 16 - searchRange)

    // Every table starts on a four-byte boundary, which is not optional.
    for (let index = 0; index < count; index += 1) {
      expect(view.getUint32(12 + index * 16 + 8) % 4).toBe(0)
    }
  })
})

describe('what it refuses', () => {
  it.each([
    ['an empty file', new Uint8Array()],
    ['a WOFF2', new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0])],
    ['a bare TTF', new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0])],
  ])('refuses %s', (_what, bytes) => {
    expect(() => woffToTtf(bytes)).toThrow(WoffError)
  })

  it('refuses a directory pointing past the end of the file', () => {
    const woff = new Uint8Array(sources.get(FILES[0]) ?? new Uint8Array())
    const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)

    // The first table's offset, moved beyond the file.
    view.setUint32(44 + 4, woff.byteLength + 1_000)

    expect(() => woffToTtf(woff)).toThrow(WoffError)
  })
})
