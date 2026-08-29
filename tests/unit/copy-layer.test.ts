import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { archetypeWords } from '@/copy/archetype'
import { shareCopy } from '@/copy/share'
import { ARCHETYPES, ARCHETYPE_KEYS } from '@/domain/archetype'

/**
 * Rule 11: copy lives in `src/copy/`, keyed by archetype, and is the i18n
 * translation unit (M1-10).
 *
 * **A string outside it is a string a translation pass never sees.** That is the
 * whole cost, and it is not hypothetical: seven isiZulu ceremony names lived in
 * `src/domain/archetype/archetypes.ts` — the words a bereaved family reads first
 * — while `src/copy/` was described everywhere as the thing a translator
 * replaces. Two more sat inlined in components.
 *
 * The file that held the kickers said so itself, and had since M1-04: *"These
 * are user-facing strings in `src/domain/`, which sits awkwardly against rule
 * 11 … see docs/decisions.md M1-04 for where they go when `src/copy/` lands."*
 * `src/copy/` landed at M2-05. **A comment is not a mechanism**, which is why
 * this file exists.
 */

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function sourcesUnder(dir: string): { path: string; text: string }[] {
  return readdirSync(root(dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => {
      const path = `${entry.parentPath}/${entry.name}`
      return { path, text: withoutComments(readFileSync(path, 'utf8')) }
    })
}

describe('the archetype words moved to the copy layer', () => {
  it('gives every archetype its kicker and its verb', () => {
    for (const key of ARCHETYPE_KEYS) {
      expect(archetypeWords[key].kicker, key).not.toBe('')
      expect(archetypeWords[key].verb, key).not.toBe('')
    }
  })

  it('is what the config renders, so the two cannot drift', () => {
    for (const key of ARCHETYPE_KEYS) {
      expect(ARCHETYPES[key].kicker, key).toBe(archetypeWords[key].kicker)
      expect(ARCHETYPES[key].verb, key).toBe(archetypeWords[key].verb)
    }
  })

  it('leaves no ceremony name behind in src/domain/', () => {
    /*
     * The guard, and the mutation check for this task: putting `kicker:
     * 'Umshado'` back into the archetype config fails here.
     *
     * `src/domain/` is where the bereavement rules live and it may keep every
     * flag it has. What it may not keep is a word somebody reads.
     */
    const CEREMONY_WORDS =
      /'(Umshado|Umembeso|Umngcwabo|Umbuyiso|Imbeleko|Umgidi|Itiye|Umhlangano)'/

    for (const { path, text } of sourcesUnder('src/domain')) {
      expect(text, path).not.toMatch(CEREMONY_WORDS)
    }
  })

  it('keeps the flags in the domain, because they are rules and not words', () => {
    // The other half of M1-04 §7 — "the flags stay, the sentences go". A
    // bereavement guard that had to read the copy layer to know whether motion
    // is allowed would be rule 1 depending on a translation.
    const config = readFileSync(root('src/domain/archetype/archetypes.ts'), 'utf8')

    for (const flag of ['animate:', 'allowsTarget:', 'amountsPublic:']) {
      expect(config, flag).toContain(flag)
    }
  })
})

describe('nothing user-facing is inlined in a component', () => {
  /*
   * A deliberately narrow scan: JSX text and `title=` / `label=` attributes
   * holding a sentence. It cannot catch every inlined string and does not try —
   * what it catches is the shape all sixteen had, which is a capitalised phrase
   * sitting where a copy reference belongs.
   */
  const SENTENCE_ATTRIBUTE = /\s(?:title|label|placeholder|aria-label)="[A-Z][^"]{3,}"/
  const JSX_SENTENCE = />[A-Z][a-z]+(?: [a-z']+){2,}[.?!]?</

  const SCREENS = [
    ...sourcesUnder('src/app/(organiser)'),
    ...sourcesUnder('src/app/(auth)'),
    ...sourcesUnder('src/app/(admin)'),
  ]

  it('covers the screens it claims to', () => {
    expect(SCREENS.length).toBeGreaterThanOrEqual(12)
  })

  it('has no sentence in a title, label or placeholder attribute', () => {
    for (const { path, text } of SCREENS) {
      const found = SENTENCE_ATTRIBUTE.exec(text)
      expect(found?.[0] ?? null, `${path} inlines ${String(found?.[0])}`).toBeNull()
    }
  })

  it('has no sentence written straight into the markup', () => {
    for (const { path, text } of SCREENS) {
      const found = JSX_SENTENCE.exec(text)
      expect(found?.[0] ?? null, `${path} inlines ${String(found?.[0])}`).toBeNull()
    }
  })
})

describe('a copy file that describes its own shipping is right about it', () => {
  it('does not claim the verified share line is unshipped, because it ships', () => {
    /*
     * `share.ts` said *"is not shipped"* of `introVerified` from M2-07 until
     * M1-10. M3-02 built the badge and the share step has picked between the two
     * on `draft.organiserVerified` ever since — so the note was false for
     * months, in the file somebody would open to check.
     *
     * `setupCopy.share` carried a third copy of the same sentence, unconditional
     * and unrendered. One sentence, one place, one condition.
     */
    const share = readFileSync(root('src/copy/share.ts'), 'utf8')
    const setup = readFileSync(root('src/copy/setup.ts'), 'utf8')

    expect(shareCopy.introVerified).toContain('verified name')
    expect(shareCopy.intro.toLowerCase()).not.toContain('verified')

    expect(share).not.toContain('is not shipped')
    expect(withoutComments(setup)).not.toContain('sees your verified name')
  })
})
