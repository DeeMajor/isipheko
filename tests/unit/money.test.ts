import { describe, expect, it } from 'vitest'

import {
  MAX_CENTS,
  MoneyError,
  add,
  compare,
  equals,
  formatMoney,
  formatMoneyWhole,
  fromCents,
  greaterThan,
  isZero,
  lessThan,
  multiply,
  parseMoney,
  subtract,
  sum,
  toCents,
  zero,
} from '@/domain/money'

/** Reads better than `fromCents(123456n)` at every call site below. */
const cents = fromCents

describe('construction', () => {
  it('round-trips through cents', () => {
    expect(toCents(cents(123_456n))).toBe(123_456n)
  })

  it('accepts zero and the BIGINT maximum', () => {
    expect(toCents(cents(0n))).toBe(0n)
    expect(toCents(cents(MAX_CENTS))).toBe(MAX_CENTS)
  })

  it('rejects a negative amount — Money is a magnitude', () => {
    expect(() => cents(-1n)).toThrow(MoneyError)
  })

  it('rejects an amount that would not fit the column that stores it', () => {
    expect(() => cents(MAX_CENTS + 1n)).toThrow(MoneyError)
  })

  it('carries no amount in the error message, only the reason', () => {
    // Amounts on a bereavement event default to hidden. These messages reach
    // logs (CLAUDE.md rule 8).
    const message = (() => {
      try {
        cents(-4_237n)
        return ''
      } catch (error) {
        return (error as MoneyError).message
      }
    })()

    expect(message).not.toContain('4237')
    expect(message).not.toContain('4_237')
    expect(message).toContain('negative')
  })
})

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(add(cents(1_50n), cents(2_75n))).toBe(cents(4_25n))
    expect(subtract(cents(4_25n), cents(2_75n))).toBe(cents(1_50n))
  })

  it('throws on subtraction that would go below zero', () => {
    expect(() => subtract(cents(1_000n), cents(3_000n))).toThrow(MoneyError)
  })

  it('multiplies by a whole count', () => {
    expect(multiply(cents(12_50n), 8n)).toBe(cents(100_00n))
    expect(multiply(cents(12_50n), 0n)).toBe(zero)
  })

  it('rejects a negative factor', () => {
    expect(() => multiply(cents(100n), -2n)).toThrow(MoneyError)
  })

  it('throws on overflow rather than wrapping or losing the top bits', () => {
    expect(() => add(cents(MAX_CENTS), cents(1n))).toThrow(MoneyError)
    expect(() => multiply(cents(MAX_CENTS), 2n)).toThrow(MoneyError)
  })

  it('sums an empty iterable to zero', () => {
    expect(sum([])).toBe(zero)
  })

  it('sums many amounts without drift', () => {
    // 0,01 a hundred times is exactly R1,00. In floats it is not.
    const oneCent = Array.from({ length: 100 }, () => cents(1n))
    expect(sum(oneCent)).toBe(cents(100n))
  })
})

describe('comparison', () => {
  it('compares', () => {
    expect(equals(cents(500n), cents(500n))).toBe(true)
    expect(equals(cents(500n), cents(501n))).toBe(false)
    expect(isZero(zero)).toBe(true)
    expect(isZero(cents(1n))).toBe(false)
    expect(lessThan(cents(499n), cents(500n))).toBe(true)
    expect(greaterThan(cents(501n), cents(500n))).toBe(true)
  })

  it('sorts', () => {
    const sorted = [cents(300n), cents(100n), cents(200n)].sort(compare)
    expect(sorted).toEqual([cents(100n), cents(200n), cents(300n)])
  })
})

describe('formatMoney', () => {
  it.each([
    [0n, 'R0,00'],
    [5n, 'R0,05'],
    [50n, 'R0,50'],
    [100n, 'R1,00'],
    [99_9n, 'R9,99'],
    [123_456n, 'R1 234,56'],
    [500_000n, 'R5 000,00'],
    [100_000_000n, 'R1 000 000,00'],
    [MAX_CENTS, 'R92 233 720 368 547 758,07'],
  ])('formats %s cents as %s', (input, expected) => {
    expect(formatMoney(cents(input))).toBe(expected)
  })
})

describe('formatMoney separators, asserted by code point', () => {
  // A non-breaking space looks identical to a plain one in a diff, in a review
  // and in a terminal. It fails nothing here and then fails something else
  // later, for reasons nobody can see. So: code points, not string equality.
  const formatted = formatMoney(cents(1_234_567_89n))

  it('is R1 234 567,89', () => {
    expect(formatted).toBe('R1 234 567,89')
  })

  it('separates thousands with U+0020 and nothing else', () => {
    expect(formatted.codePointAt(2)).toBe(0x0020)
    expect(formatted.codePointAt(6)).toBe(0x0020)
  })

  it('separates cents with U+002C', () => {
    expect(formatted.codePointAt(10)).toBe(0x002c)
  })

  it('contains no other space or separator code point anywhere', () => {
    const separators = [...formatted]
      .filter((character) => !/[\dR]/.test(character))
      .map((character) => character.codePointAt(0))

    expect(separators).toEqual([0x0020, 0x0020, 0x002c])
  })

  it.each([
    ['U+00A0 non-breaking space', 0x00a0],
    ['U+2007 figure space', 0x2007],
    ['U+2009 thin space', 0x2009],
    ['U+202F narrow no-break space', 0x202f],
    ['U+002E full stop', 0x002e],
  ])('never emits %s', (_name, codePoint) => {
    expect(formatted).not.toContain(String.fromCodePoint(codePoint))
  })
})

describe('formatMoneyWhole', () => {
  it('drops the cents only when they are exactly zero', () => {
    expect(formatMoneyWhole(cents(500_000n))).toBe('R5 000')
    expect(formatMoneyWhole(cents(0n))).toBe('R0')
  })

  it('never rounds', () => {
    // The group bead on an event page reads "The Ngcobo cousins — R5 000,50".
    // Reading R5 001 there would misstate what somebody gave.
    expect(formatMoneyWhole(cents(500_050n))).toBe('R5 000,50')
    expect(formatMoneyWhole(cents(500_099n))).toBe('R5 000,99')
    expect(formatMoneyWhole(cents(500_001n))).toBe('R5 000,01')
  })

  it('uses the same separators as formatMoney', () => {
    const formatted = formatMoneyWhole(cents(1_000_000_00n))
    expect(formatted).toBe('R1 000 000')
    expect(formatted.codePointAt(2)).toBe(0x0020)
    expect(formatted.codePointAt(6)).toBe(0x0020)
  })
})

describe('parseMoney', () => {
  it.each([
    ['1 234,56', 123_456n],
    ['R1 234,56', 123_456n],
    ['R 1 234,56', 123_456n],
    ['r1 234,56', 123_456n],
    ['  1 234,56  ', 123_456n],
    ['1234,56', 123_456n],
    ['1234.56', 123_456n],
    ['5000', 500_000n],
    ['50.5', 5_050n],
    ['50,5', 5_050n],
    ['0', 0n],
    ['0,00', 0n],
    ['0,05', 5n],
    [',50', 50n],
    ['.50', 50n],
    ['50,', 5_000n],
    ['50.', 5_000n],
    // The same amount with each space a keyboard or a spreadsheet paste might
    // have produced instead of a plain one. Escapes, not literals — three of
    // these are invisible in an editor.
    ['1\u00A0234,56', 123_456n],
    ['1\u2007234,56', 123_456n],
    ['1\u2009234,56', 123_456n],
    ['1\u202F234,56', 123_456n],
  ])('parses %o as %s cents', (input, expected) => {
    const result = parseMoney(input)
    expect(result).toEqual({ ok: true, value: cents(expected) })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['R', 'empty'],
    ['abc', 'not-a-number'],
    ['12a', 'not-a-number'],
    ['1 2 3 x', 'not-a-number'],
    ['+50', 'not-a-number'],
    [',', 'not-a-number'],
    ['R,', 'not-a-number'],
    ['1,234.56', 'not-a-number'],
    ['1.234,56', 'not-a-number'],
    ['-5', 'negative'],
    ['-0,01', 'negative'],
    ['R-5', 'negative'],
    ['10,555', 'too-many-decimals'],
    ['1,234', 'too-many-decimals'],
    ['0.000', 'too-many-decimals'],
    ['99999999999999999999999999', 'too-large'],
    ['92233720368547758,08', 'too-large'],
  ])('rejects %o with reason %s', (input, reason) => {
    expect(parseMoney(input)).toEqual({ ok: false, reason })
  })

  it('rejects rather than rounding a third decimal place', () => {
    // Turning R10,555 into R10,56 changes what somebody contributed without
    // telling them. The form asks again instead.
    expect(parseMoney('10,555')).toEqual({
      ok: false,
      reason: 'too-many-decimals',
    })
  })

  it('rejects an ambiguous thousands comma rather than guessing', () => {
    // "1,234" is R1 234 to one typist and R1,23 to another. Neither reading is
    // safe to assume about money.
    expect(parseMoney('1,234')).toEqual({
      ok: false,
      reason: 'too-many-decimals',
    })
  })

  it('accepts the largest storable amount and rejects one cent more', () => {
    expect(parseMoney('92233720368547758,07')).toEqual({
      ok: true,
      value: cents(MAX_CENTS),
    })
    expect(parseMoney('92233720368547758,08')).toEqual({
      ok: false,
      reason: 'too-large',
    })
  })
})
