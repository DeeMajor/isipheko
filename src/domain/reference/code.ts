import { randomInt } from 'node:crypto'

/**
 * Reference codes — `MTH-4K7B2X`.
 *
 * This is typed by somebody standing up, on a phone, into a banking app's
 * reference field, possibly from a photograph of the screen. Everything below
 * is shaped by that: six characters, no letter that looks like a digit, and a
 * lookup that forgives the substitutions people actually make.
 *
 * **Crockford base32**, as Part C.5 specifies: 32 symbols with `I`, `L`, `O`
 * and `U` absent from the alphabet — the first three because they are the
 * digits `1`, `1` and `0` to a tired eye, and `U` because Crockford leaves it
 * out to avoid spelling something unfortunate by accident. On input `O` becomes
 * `0` and `I` and `L` become `1`, which is the standard's own rule and one
 * anybody can look up rather than a house convention.
 *
 * We deliberately do **not** alias `B`/`8`, `S`/`5` or `Z`/`2`. Doing so would
 * cost alphabet space and diverge from the standard, and the real mitigation
 * for somebody reading from a photo is a one-tap copy on the pay screen and the
 * code set large. If field data later shows people mistyping those, tighten it
 * then, with evidence.
 */

/** Crockford's 32 symbols: no I, no L, no O, no U. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const CODE_LENGTH = 6
export const PREFIX_LENGTH = 3

/** When a title yields no letters at all — *umcimbi*. */
export const FALLBACK_PREFIX = 'UMC'

/**
 * The largest multiple of 32 that fits in a byte is 256, so `randomInt(0, 32)`
 * is already unbiased and no rejection sampling is needed here — unlike the
 * slug, whose 62-symbol alphabet does not divide the byte range.
 */
export function generateCode(): string {
  let code = ''
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  }
  return code
}

/**
 * Crockford's decoding aliases, applied to the six-character half.
 *
 * `U` is rejected rather than mapped: it is not in the alphabet, so a code
 * containing one was never issued by us, and quietly turning it into something
 * else would resolve a typo to a stranger's contribution.
 */
function normaliseCodeCharacters(value: string): string {
  return value.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
}

/**
 * The prefix is letters, so the aliases run the other way: somebody who typed
 * `N0K` for `NOK` meant the letter. Symmetric with the code half, and it costs
 * nothing because a prefix never contains a digit.
 */
function normalisePrefixCharacters(value: string): string {
  return value.toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I')
}

export interface Reference {
  readonly prefix: string
  readonly code: string
}

/** `MTH-4K7B2X`. One hyphen, because that is what people copy and read aloud. */
export function formatReference(reference: Reference): string {
  return `${reference.prefix}-${reference.code}`
}

/**
 * Reads what somebody typed, however they typed it.
 *
 * Accepts `MTH-4K7B2X`, `mth-4k7b2x`, `MTH 4K7B2X`, `MTH4K7B2X` and anything
 * with stray spaces — a reference copied out of a banking app's statement line
 * arrives with all of those. Returns null rather than guessing when the shape
 * is wrong: resolving a malformed code to *something* is how a contribution
 * gets credited to the wrong family.
 */
export function parseReference(input: string): Reference | null {
  const stripped = input.replace(/[\s\-_.]/g, '')
  if (stripped.length !== PREFIX_LENGTH + CODE_LENGTH) return null

  const prefix = normalisePrefixCharacters(stripped.slice(0, PREFIX_LENGTH))
  const code = normaliseCodeCharacters(stripped.slice(PREFIX_LENGTH))

  if (!/^[A-Z]{3}$/.test(prefix)) return null

  // Every character must be in the alphabet after normalisation. U is not, and
  // is the one letter that fails here rather than being mapped.
  for (const character of code) {
    if (!CODE_ALPHABET.includes(character)) return null
  }

  return { prefix, code }
}

/**
 * Three letters from the event's title, so the line on a bank statement is
 * recognisable rather than a random six.
 *
 * The longest word, because that is usually the surname or the name of the
 * person — *Nokuthula Mthembu* gives `MTH`, *Baby Ayanda* gives `AYA`,
 * *Zanele's graduation* gives `ZAN`.
 *
 * It will not reproduce every example in the designs: `LND` for *Lindiwe* and
 * `MZD` for *MaZondi* drop vowels, which is a judgement no rule makes
 * consistently. That is accepted — the prefix carries no uniqueness. It exists
 * so somebody recognises the line on their statement.
 */
export function derivePrefix(title: string): string {
  const words = title
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, ''))
    .filter((word) => word.length > 0)

  const longest = words.reduce<string>(
    (best, word) => (word.length > best.length ? word : best),
    '',
  )

  if (longest.length === 0) return FALLBACK_PREFIX

  return longest.slice(0, PREFIX_LENGTH).toUpperCase().padEnd(PREFIX_LENGTH, 'X')
}
