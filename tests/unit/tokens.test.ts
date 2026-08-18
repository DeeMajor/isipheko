import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ARCHETYPES, type ArchetypeConfig } from '@/domain/archetype'
import { PUBLIC_PAGE_CSS } from '@/ui/public-page-css'

import { buildTokensCss } from '../../scripts/generate-tokens-css'

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

const FONT_DIR = root('public/fonts')
const TOKENS_RAW = readFileSync(root('src/ui/tokens.css'), 'utf8')

const CONFIGS: readonly ArchetypeConfig[] = Object.values(ARCHETYPES)

/**
 * Comments are stripped before any scan below. This file's own prose quotes
 * `--accent: #16233D` and names archetypes while explaining why neither may
 * appear in a rule — scanning the raw text would fail on the explanation rather
 * than on the thing being explained.
 */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const TOKENS = withoutComments(TOKENS_RAW)

/** Every stylesheet in the product, so a rule cannot hide in a new file. */
function stylesheets(dir: string): readonly { path: string; css: string }[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => {
      const path = `${entry.parentPath}/${entry.name}`
      return { path, css: withoutComments(readFileSync(path, 'utf8')) }
    })
}

/**
 * The CSS that lives in TypeScript. The public event page is served from a
 * route handler, which cannot import a stylesheet, so its styles and the tokens
 * are strings inlined into the document (docs/decisions.md M1-08). They are
 * scanned alongside the `.css` files — a bare `var(--accent)` is exactly as
 * wrong in a string as in a stylesheet.
 */
const CSS_IN_TS = [
  { path: 'src/ui/public-page-css.ts', css: withoutComments(PUBLIC_PAGE_CSS) },
  { path: 'src/ui/tokens.ts', css: withoutComments(TOKENS_RAW) },
]

const CSS = [...stylesheets(root('src')), ...CSS_IN_TS]

function sources(dir: string): readonly { path: string; text: string }[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(ts|tsx|css)$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts'),
    )
    .map((entry) => {
      const path = `${entry.parentPath}/${entry.name}`
      return { path, text: readFileSync(path, 'utf8') }
    })
    .filter(({ path }) => !path.includes('/generated/'))
}

describe('the fonts that ship', () => {
  const files = readdirSync(FONT_DIR)

  it('is exactly two woff2 files and nothing else', () => {
    // Part C.3 and Part G: latin and latin-ext. A third file means a subset
    // came back — the Vietnamese one returned twice during design — and it
    // would be paid for by every contributor on a metered connection.
    expect([...files].sort()).toEqual([
      'public-sans-latin-ext.woff2',
      'public-sans-latin.woff2',
    ])
  })

  it.each([
    [
      'public-sans-latin.woff2',
      26_832,
      '5ed4d31c988e73b258894244f209069ebe77dc7e564861954b21198b6de90d68',
    ],
    [
      'public-sans-latin-ext.woff2',
      18_472,
      '3a00a32f0242b723dcea79935747d6d27dd93675d03ef23f470dfe274e79586a',
    ],
  ])('%s is the exact binary that was reviewed', (name, bytes, sha256) => {
    // Fontsource public-sans:vf@5.3.0, the version the prototypes load. A
    // silently swapped font binary is otherwise a rendering mystery nobody
    // traces back to the file — different metrics, different subset, no error.
    const file = readFileSync(`${FONT_DIR}/${name}`)

    expect(file.byteLength).toBe(bytes)
    expect(createHash('sha256').update(file).digest('hex')).toBe(sha256)
  })

  it('matches the sizes Part G budgets for', () => {
    const total = files.reduce(
      (bytes, name) => bytes + readFileSync(`${FONT_DIR}/${name}`).byteLength,
      0,
    )

    // 45.3KB of the 150KB budget, and only the latin file is fetched on an
    // English page — unicode-range makes the second one lazy.
    expect(total).toBeLessThan(46 * 1024)
  })
})

describe('the @font-face rules', () => {
  const faces = TOKENS.match(/@font-face\s*\{[^}]*\}/g) ?? []

  it('declares exactly two faces', () => {
    expect(faces).toHaveLength(2)
  })

  it('declares no italic face anywhere', () => {
    for (const face of faces) expect(face).toContain('font-style: normal')
    for (const { path, css } of CSS) {
      expect(css, path).not.toMatch(/font-style:\s*italic/)
      expect(css, path).not.toMatch(/font-style:\s*oblique/)
    }
  })

  it('self-hosts — no Google Fonts, no CDN, in any source file', () => {
    // The design pipeline re-added the Vietnamese subset twice when a URL was
    // involved. There is no URL now.
    const remote =
      /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|fontsource/i

    for (const { path, text } of sources(root('src'))) {
      expect(text, path).not.toMatch(remote)
    }
  })

  it('points at the two files that exist', () => {
    expect(TOKENS).toContain("url('/fonts/public-sans-latin.woff2')")
    expect(TOKENS).toContain("url('/fonts/public-sans-latin-ext.woff2')")
  })
})

describe('tokens.css is generated', () => {
  it('is byte-identical to what the generator emits', () => {
    // One source, two outputs: the stylesheet the App Router pages import, and
    // the string the public page inlines. Two hand-maintained copies would
    // drift, and what drifts is a colour nobody notices is wrong — or an
    // --accent declaration that quietly ends the bereavement fallback.
    //
    // If this failed: edit src/ui/tokens.ts, run `pnpm tokens:css`, commit both.
    expect(TOKENS_RAW).toBe(buildTokensCss())
  })

  it('says it is generated, where somebody about to edit it looks', () => {
    expect(TOKENS_RAW.startsWith('/* GENERATED FILE — DO NOT EDIT.')).toBe(true)
  })
})

describe('the accent is a fallback, not a value', () => {
  it('is never declared in tokens.css', () => {
    // This is the test that stops somebody "fixing" the fallback by making it
    // explicit. `--accent: #16233D` here looks identical on screen and quietly
    // ends the mechanism: every archetype would inherit indigo from this file
    // rather than from the absence of a decision, and bereavement would stop
    // being the case that proves it works (CLAUDE.md rule 2).
    expect(TOKENS).not.toMatch(/--accent\s*:/)
  })

  it('is never declared in any stylesheet', () => {
    for (const { path, css } of CSS) {
      expect(css, path).not.toMatch(/--accent\s*:/)
    }
  })

  it('always carries the indigo fallback where it is read', () => {
    for (const { path, css } of CSS) {
      const usages = css.match(/var\(\s*--accent[^)]*\)/g) ?? []
      for (const usage of usages) {
        expect(usage.toLowerCase(), `${path}: ${usage}`).toMatch(/,\s*#16233d\s*\)$/)
      }
    }
  })

  it('is set in exactly one place in the codebase', () => {
    const setters = sources(root('src')).filter(({ text }) => text.includes("'--accent'"))

    expect(setters.map(({ path }) => path.split('/src/')[1])).toEqual(['ui/theme.tsx'])
  })
})

describe('no stylesheet knows what an archetype is', () => {
  it('never selects on a specific archetype', () => {
    // `[data-archetype='umngcwabo'] { … }` is the accent map this design exists
    // to avoid: it would repeat what ArchetypeConfig already says, and the fact
    // that would drift is which archetype has no accent at all.
    for (const { path, css } of CSS) {
      expect(css, path).not.toMatch(/\[data-archetype\s*[~^|$*]?=/)

      for (const key of CONFIGS.map((config) => config.key)) {
        expect(css, `${path} mentions ${key}`).not.toContain(key)
      }
      for (const config of CONFIGS) {
        expect(css, `${path} mentions ${config.group}`).not.toContain(config.group)
      }
    }
  })

  it('carries no archetype accent as a literal', () => {
    const accents = CONFIGS.map((config) => config.accent).filter(
      (accent): accent is string => accent !== undefined,
    )

    for (const { path, css } of CSS) {
      for (const accent of accents) {
        expect(css.toLowerCase(), `${path} hardcodes ${accent}`).not.toContain(
          accent.toLowerCase(),
        )
      }
    }
  })
})

/**
 * WCAG relative luminance and contrast, for the accent behind white text.
 *
 * `color-mix(in srgb, …)` interpolates channel-wise in gamma-encoded sRGB, so
 * the mix is reproduced here exactly rather than approximated. axe is the
 * authority at render time; this fails in a second instead of in a browser, and
 * says which accent and by how much.
 */
function channels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function mix(a: string, b: string, weight: number): readonly [number, number, number] {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  return [
    ar * weight + br * (1 - weight),
    ag * weight + bg * (1 - weight),
    ab * weight + bb * (1 - weight),
  ]
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(rgb: readonly [number, number, number], against: string): number {
  const a = luminance(rgb)
  const b = luminance(channels(against))
  const [light, dark] = a > b ? [a, b] : [b, a]
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

describe('accent contrast', () => {
  const INK = '#16233D'
  const WHITE = '#FFFFFF'
  /** Must match the ratio in tokens.css. */
  const MIX = 0.6

  const accents = [
    ...CONFIGS.map((config) => config.accent ?? INK),
    INK, // the bereavement fallback
  ]

  it.each([...new Set(accents)])(
    '%s clears 4.5:1 against white once mixed toward ink',
    (accent) => {
      expect(contrast(mix(accent, INK, MIX), WHITE)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('records why the mix exists: two accents fail unmixed', () => {
    // Achievement gold cannot carry white text at any size — it is short of
    // even the 3:1 large-text floor. Gathering is short of 4.5:1. The
    // prototypes did not hit this because their palette had darker colours in
    // those two slots; these are the ones CLAUDE.md fixes.
    expect(contrast(channels('#C89211'), WHITE)).toBeLessThan(3)
    expect(contrast(channels('#A6742B'), WHITE)).toBeLessThan(4.5)
  })

  it('keeps the ink-soft help text readable on both papers', () => {
    expect(contrast(channels('#4A5670'), WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(channels('#4A5670'), '#F2F1ED')).toBeGreaterThanOrEqual(4.5)
  })
})
