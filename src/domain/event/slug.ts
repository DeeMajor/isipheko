import { randomBytes } from 'node:crypto'

/**
 * The event slug — the whole address of a page nobody should be able to find by
 * guessing.
 *
 * Architecture §10: cryptographically random, at least 16 base62 characters,
 * never sequential. Event pages carry `noindex`, so the slug is the only thing
 * standing between a stranger and a funeral page. Sixteen base62 characters is
 * about 95 bits — not walkable, not enumerable, and not a number anybody can
 * increment.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export const SLUG_LENGTH = 16

export const SLUG_PATTERN = /^[0-9A-Za-z]{16,}$/

/**
 * The largest multiple of 62 that fits in a byte. Bytes at or above it are
 * thrown away rather than folded back in.
 *
 * `byte % 62` over the whole range would make the first eight characters of the
 * alphabet slightly likelier than the rest — a small bias, but it is a bias in
 * the one value protecting the page, and rejection costs nothing.
 */
const UNBIASED_CEILING = 248

export function generateSlug(length: number = SLUG_LENGTH): string {
  let slug = ''

  while (slug.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= UNBIASED_CEILING) continue
      slug += ALPHABET[byte % ALPHABET.length]
      if (slug.length === length) break
    }
  }

  return slug
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug)
}
