/**
 * Formatting and parsing — the two places a Money meets a person.
 *
 * The format is fixed by CLAUDE.md rule 7: `R1 234,56`. A plain space (U+0020)
 * between thousands, a comma (U+002C) before the cents.
 *
 * **Hand-rolled rather than `Intl.NumberFormat`.** ICU's `en-ZA` emits a
 * non-breaking space (U+00A0) as the group separator, and depending on the
 * Node build and ICU version the decimal separator is not reliably a comma
 * either. Both differences are invisible in review and in a visual diff, and
 * surface much later somewhere unrelated. The glyphs in rule 7 are exact, so
 * they are produced exactly, and tests assert them by code point.
 */

import { fromCents, MAX_CENTS, type Money } from './money.ts'

// Written as escapes rather than as literal characters. Three of the five in
// SPACE_CHARACTERS are indistinguishable from a plain space in an editor, and
// this module exists partly to keep that confusion out of the product.
const THOUSANDS_SEPARATOR = '\u0020'
const DECIMAL_SEPARATOR = '\u002C'

/**
 * Every space a phone keyboard or a paste from a spreadsheet might produce:
 * plain, non-breaking, figure, thin, narrow no-break. All of them mean the same
 * thing to the person typing — a gap between thousands.
 */
const SPACE_CHARACTERS = /[\u0020\u00A0\u2007\u2009\u202F]/g

/** Longer than any storable amount, so `BigInt()` is never handed a novel. */
const MAX_DIGITS = 24

/** `R1 234,56`. Always two decimal places. */
export function formatMoney(money: Money): string {
  const { rands, cents } = split(money)
  return `R${group(rands)}${DECIMAL_SEPARATOR}${cents}`
}

/**
 * `R5 000` for a whole amount, `R5 000,50` for anything else.
 *
 * The cents are dropped **only when they are exactly zero** — this never
 * rounds. The group bead on an event page reads *"The Ngcobo cousins —
 * R5 000"* (rule 14), and a bead reading `R5 001` for R5 000,50 would be a
 * quiet lie about what someone gave.
 */
export function formatMoneyWhole(money: Money): string {
  const { rands, cents } = split(money)
  return cents === '00'
    ? `R${group(rands)}`
    : `R${group(rands)}${DECIMAL_SEPARATOR}${cents}`
}

export type MoneyParseFailure =
  'empty' | 'not-a-number' | 'too-many-decimals' | 'negative' | 'too-large'

export type MoneyParseResult =
  | { readonly ok: true; readonly value: Money }
  | { readonly ok: false; readonly reason: MoneyParseFailure }

/**
 * Reads what a contributor typed.
 *
 * Returns a result rather than throwing, because this runs on untrusted input
 * at the Zod boundary (§10) where a failure is an expected outcome with copy
 * attached, not an exception.
 *
 * The reason is a code, never a sentence — user-facing strings live in
 * `src/copy/`, keyed by archetype (rule 11).
 *
 * Accepts an optional `R`, spaces of any kind as thousands separators, and
 * either `,` or `.` as the decimal separator — someone thumbing an Android
 * keyboard reaches for the dot, and someone writing it out the South African
 * way reaches for the comma. Also accepts a bare integer (`5000`) and a bare
 * decimal (`50.5`), because in a hurry nobody reaches for a separator at all.
 *
 * Rejects rather than guesses. `1,234` is either R1 234 or R1,23 depending on
 * which convention the typist has in mind, so it comes back as
 * `too-many-decimals` and the form asks again. Three or more decimal places are
 * rejected for the same reason and never rounded: silently turning R10,555 into
 * R10,56 changes what someone contributed without telling them.
 */
export function parseMoney(input: string): MoneyParseResult {
  const withoutSpaces = input.trim().replace(SPACE_CHARACTERS, '')
  const withoutCurrency = withoutSpaces.replace(/^[Rr]/, '')

  if (withoutCurrency === '') {
    return { ok: false, reason: 'empty' }
  }
  if (withoutCurrency.startsWith('-')) {
    return { ok: false, reason: 'negative' }
  }

  const separators = withoutCurrency.match(/[.,]/g) ?? []
  if (separators.length > 1) {
    // Two separators means a convention we would have to guess at — `1,234.56`
    // read one way is R1 234,56 and the other way is nonsense.
    return { ok: false, reason: 'not-a-number' }
  }

  const separatorIndex = withoutCurrency.search(/[.,]/)
  const rands =
    separatorIndex === -1 ? withoutCurrency : withoutCurrency.slice(0, separatorIndex)
  const cents = separatorIndex === -1 ? '' : withoutCurrency.slice(separatorIndex + 1)

  if (!/^\d*$/.test(rands) || !/^\d*$/.test(cents)) {
    return { ok: false, reason: 'not-a-number' }
  }
  if (rands === '' && cents === '') {
    return { ok: false, reason: 'not-a-number' }
  }
  if (cents.length > 2) {
    return { ok: false, reason: 'too-many-decimals' }
  }
  if (rands.length > MAX_DIGITS) {
    return { ok: false, reason: 'too-large' }
  }

  const total = BigInt(rands || '0') * 100n + BigInt(cents.padEnd(2, '0'))
  if (total > MAX_CENTS) {
    return { ok: false, reason: 'too-large' }
  }

  return { ok: true, value: fromCents(total) }
}

function split(money: Money): { rands: string; cents: string } {
  const digits = money.toString().padStart(3, '0')
  return { rands: digits.slice(0, -2), cents: digits.slice(-2) }
}

function group(rands: string): string {
  let grouped = ''
  for (let i = rands.length; i > 0; i -= 3) {
    const chunk = rands.slice(Math.max(0, i - 3), i)
    grouped = grouped === '' ? chunk : `${chunk}${THOUSANDS_SEPARATOR}${grouped}`
  }
  return grouped
}
