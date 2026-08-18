/**
 * What a South African ID number has to look like before we spend money on it.
 *
 * A Home Affairs check costs about R29.90 (architecture §7.1). A typo therefore
 * costs R29.90 and comes back as "no match", which reads to the organiser like
 * an accusation rather than a slip. Everything checkable without a network call
 * is checked here first: the length, the digits, that the date could exist, the
 * citizenship digit, and the Luhn check digit the number carries for exactly
 * this purpose.
 *
 * Pure, and returns a result rather than throwing (the `parseMoney` shape from
 * M1-03 §7) — this runs on typed input where failure is an expected outcome
 * with copy attached.
 *
 * **The reason is a code, never a sentence, and never the number.** These
 * values reach a query string and logs; user-facing strings live in
 * `src/copy/` (rule 11), and nothing here may carry the digits somebody typed
 * (rule 8).
 */

export type SaIdRejection =
  | 'empty'
  | 'wrong-length'
  | 'not-digits'
  | 'impossible-date'
  | 'unknown-citizenship'
  | 'check-digit'

export type SaIdParseResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: SaIdRejection }

/** YYMMDD SSSS C A Z — thirteen digits, and the last one is derived. */
const ID_LENGTH = 13

/**
 * Spaces and hyphens are how people write it down and how a phone keyboard
 * offers it. Nothing else is tolerated: a letter in an ID number is a different
 * kind of mistake and should be reported rather than quietly removed.
 */
function normalise(input: string): string {
  return input.replace(/[\s-]/g, '')
}

/**
 * Both centuries are allowed, because a two-digit year cannot say which one it
 * is. `000229` is 29 February 2000, which existed, and 29 February 1900, which
 * did not — so the rule is "valid in either century", not "valid in the one we
 * guessed".
 *
 * The date is validated and then discarded. A date of birth is personal
 * information we have no use for (§11 data minimisation), and the only question
 * here is whether the number is worth paying to check.
 */
function isPossibleDate(yy: number, mm: number, dd: number): boolean {
  if (mm < 1 || mm > 12) return false
  if (dd < 1) return false

  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const plain = daysInMonth[mm - 1] ?? 0

  if (mm !== 2) return dd <= plain

  // 1900 was not a leap year; 2000 was. February 29 is possible on the second
  // reading, so it is possible.
  return dd <= 29
}

/**
 * The Luhn check digit, over all thirteen digits.
 *
 * This is the whole reason a mistyped ID number is usually free to catch: about
 * nine in ten single-digit slips and every adjacent transposition fail it, so
 * they never reach a paid check.
 */
function passesLuhn(digits: string): boolean {
  let sum = 0
  let double = false

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48

    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }

    sum += digit
    double = !double
  }

  return sum % 10 === 0
}

export function parseSaIdNumber(input: string): SaIdParseResult {
  const value = normalise(input)

  if (value === '') return { ok: false, reason: 'empty' }
  if (value.length !== ID_LENGTH) return { ok: false, reason: 'wrong-length' }
  if (!/^\d+$/.test(value)) return { ok: false, reason: 'not-digits' }

  const yy = Number(value.slice(0, 2))
  const mm = Number(value.slice(2, 4))
  const dd = Number(value.slice(4, 6))

  if (!isPossibleDate(yy, mm, dd)) return { ok: false, reason: 'impossible-date' }

  // Position 11: 0 is a citizen, 1 is a permanent resident. Home Affairs issues
  // nothing else, so anything else is a typo we would otherwise pay to discover.
  const citizenship = value[10]
  if (citizenship !== '0' && citizenship !== '1') {
    return { ok: false, reason: 'unknown-citizenship' }
  }

  if (!passesLuhn(value)) return { ok: false, reason: 'check-digit' }

  return { ok: true, value }
}
