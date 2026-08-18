import { describe, expect, it } from 'vitest'

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  FALLBACK_PREFIX,
  derivePrefix,
  formatReference,
  generateCode,
  parseReference,
} from '@/domain/reference'

/**
 * Reference codes, as typed by somebody standing up on a phone.
 *
 * The three cases in the done-criteria are here by name. The original spec's
 * third example was `MTH-4KZBZX` against a stored `MTH-4K7B2X`, which cannot
 * work: it needs `Z→7` in one position and `Z→2` in another, and no function
 * maps one character to two. The plan has been corrected; see
 * docs/decisions.md M2-02.
 */

describe('the alphabet', () => {
  it('is Crockford: 32 symbols, no I, L, O or U', () => {
    expect(CODE_ALPHABET).toHaveLength(32)
    expect(CODE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ')

    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(CODE_ALPHABET).not.toContain(excluded)
    }
  })

  it('generates six characters, all from it', () => {
    for (let index = 0; index < 2_000; index += 1) {
      const code = generateCode()

      expect(code).toHaveLength(CODE_LENGTH)
      for (const character of code) expect(CODE_ALPHABET).toContain(character)
    }
  })

  it('draws every symbol, roughly evenly', () => {
    const counts = new Map<string, number>()
    const draws = 20_000

    for (const character of Array.from({ length: draws }, generateCode).join('')) {
      counts.set(character, (counts.get(character) ?? 0) + 1)
    }

    expect(counts.size).toBe(32)

    const mean = (draws * CODE_LENGTH) / 32
    for (const [character, count] of counts) {
      expect(count, `${character} appeared ${String(count)} times`).toBeGreaterThan(
        mean * 0.85,
      )
      expect(count, `${character} appeared ${String(count)} times`).toBeLessThan(
        mean * 1.15,
      )
    }
  })
})

describe('100 000 codes', () => {
  it('are overwhelmingly distinct, but not guaranteed to be — which is why the index exists', () => {
    // 32^6 ≈ 1.07 × 10^9. The birthday bound over 100 000 draws predicts about
    // 4.7 collisions, so "no duplicates" is a property of the unique index and
    // the retry in the repository, not of the generator. Asserting zero here
    // would be a flaky test rather than a passing one.
    const codes = new Set<string>()
    const total = 100_000

    for (let index = 0; index < total; index += 1) codes.add(generateCode())

    const collisions = total - codes.size

    expect(collisions).toBeLessThan(30)
    // And the space is what we think it is.
    expect(32 ** CODE_LENGTH).toBeGreaterThan(1e9)
  })
})

describe('reading what somebody typed', () => {
  // The done-criteria, corrected. Stored: MTH-40G1BX.
  it.each([
    ['MTH-40G1BX', 'as issued'],
    ['mth-40g1bx', 'all lower case'],
    ['MTH-4OG1BX', 'O typed for zero'],
    ['MTH-4OGLBX', 'O for zero and L for one'],
    ['MTH-4OGIBX', 'O for zero and I for one'],
    ['MTH 40G1BX', 'a space instead of the hyphen'],
    ['MTH40G1BX', 'run together'],
    ['  mth-40g1bx  ', 'with stray whitespace'],
  ])('%s resolves to MTH-40G1BX (%s)', (input) => {
    expect(parseReference(input)).toEqual({ prefix: 'MTH', code: '40G1BX' })
  })

  it('normalises the prefix the other way, because a prefix is letters', () => {
    // Somebody who typed N0K for NOK, or M1H for MIH, meant the letter.
    expect(parseReference('N0K-40G1BX')?.prefix).toBe('NOK')
    expect(parseReference('M1H-40G1BX')?.prefix).toBe('MIH')
  })

  it('still refuses a prefix that is not letters even after normalising', () => {
    // 2 and 3 have no letter to become, so this stays malformed.
    expect(parseReference('123-40G1BX')).toBeNull()
  })

  it.each([
    ['', 'empty'],
    ['MTH-40G1B', 'one character short'],
    ['MTH-40G1BXX', 'one character long'],
    ['MT-40G1BX', 'a two-letter prefix'],
    ['MTH-40G1BU', 'a U, which was never issued'],
    ['MTH-40G1B!', 'punctuation in the code'],
  ])('refuses %o (%s)', (input) => {
    // Resolving a malformed reference to *something* is how a contribution gets
    // credited to the wrong family.
    expect(parseReference(input)).toBeNull()
  })

  it('round-trips whatever it generates', () => {
    for (let index = 0; index < 1_000; index += 1) {
      const reference = { prefix: 'MTH', code: generateCode() }
      const formatted = formatReference(reference)

      expect(parseReference(formatted)).toEqual(reference)
      expect(parseReference(formatted.toLowerCase())).toEqual(reference)
    }
  })

  it('formats with one hyphen, because that is what people read aloud', () => {
    expect(formatReference({ prefix: 'MTH', code: '4K7B2X' })).toBe('MTH-4K7B2X')
  })
})

describe('the prefix', () => {
  // The rule is: letters only, uppercased, first three of the **longest** word.
  //
  // These are the values it actually produces, which are not the values the
  // designs show. The designs were written by a person picking the name they
  // would recognise on a statement — Mthembu over Nokuthula, Zanele over
  // graduation — and no mechanical rule reproduces that judgement. See
  // docs/decisions.md M2-02.
  it.each([
    ['Nokuthula Mthembu', 'NOK'],
    ['Baby Ayanda', 'AYA'],
    ["Zanele's graduation", 'GRA'],
    ['Mthembu family gathering', 'GAT'],
    ['Lindiwe & Sipho', 'LIN'],
    ["MaZondi's stone", 'MAZ'],
  ])('reads %o as %s', (title, expected) => {
    expect(derivePrefix(title)).toBe(expected)
  })

  it('falls back to UMC when a title has no letters in it', () => {
    expect(derivePrefix('12 / 09')).toBe(FALLBACK_PREFIX)
    expect(derivePrefix('   ')).toBe(FALLBACK_PREFIX)
  })

  it('pads a short word rather than returning a short prefix', () => {
    expect(derivePrefix('Jo')).toBe('JOX')
  })

  it('is always three letters', () => {
    for (const title of ['Nokuthula Mthembu', 'A', '···', 'Umgidi 2026']) {
      expect(derivePrefix(title)).toMatch(/^[A-Z]{3}$/)
    }
  })
})
