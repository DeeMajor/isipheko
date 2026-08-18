import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { MoneyError, add, divideWithRemainder, fromCents, multiply } from '@/domain/money'

/**
 * Division, which M1-03 deliberately did not have.
 *
 * It was left out so the first real caller would define its shape, and M2-03 is
 * that caller: an item's estimated cost split across the people claiming part
 * of it. The shape is "hand the remainder back" — where the odd cent goes is a
 * decision about the product, not about arithmetic.
 */

describe('splitting an amount', () => {
  it('divides evenly when it divides evenly', () => {
    expect(divideWithRemainder(fromCents(90_00n), 3n)).toEqual({
      each: fromCents(30_00n),
      remainder: fromCents(0n),
    })
  })

  it('hands back the cent it cannot split', () => {
    // R100 three ways is 33,33 each and one cent over. Rounding it away
    // silently is how a ledger stops adding up.
    expect(divideWithRemainder(fromCents(100_00n), 3n)).toEqual({
      each: fromCents(33_33n),
      remainder: fromCents(1n),
    })
  })

  it('gives everything to one part', () => {
    expect(divideWithRemainder(fromCents(12_34n), 1n)).toEqual({
      each: fromCents(12_34n),
      remainder: fromCents(0n),
    })
  })

  it('gives nothing to each when there is less than one cent to go round', () => {
    expect(divideWithRemainder(fromCents(2n), 5n)).toEqual({
      each: fromCents(0n),
      remainder: fromCents(2n),
    })
  })

  it('refuses to divide into fewer than one part', () => {
    expect(() => divideWithRemainder(fromCents(100n), 0n)).toThrow(MoneyError)
    expect(() => divideWithRemainder(fromCents(100n), -2n)).toThrow(MoneyError)
  })

  it('loses nothing, ever', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }).map(fromCents),
        fc.bigInt({ min: 1n, max: 1_000n }),
        (total, parts) => {
          const { each, remainder } = divideWithRemainder(total, parts)

          // each × parts + remainder is exactly what went in.
          expect(add(multiply(each, parts), remainder)).toBe(total)
          // And the remainder is always smaller than the number of parts, or it
          // would have been distributed.
          expect(remainder < parts).toBe(true)
        },
      ),
      { numRuns: 10_000 },
    )
  })
})
