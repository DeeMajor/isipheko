import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  MAX_CENTS,
  add,
  formatMoney,
  formatMoneyWhole,
  fromCents,
  multiply,
  parseMoney,
  subtract,
  sum,
  toCents,
  type Money,
} from '@/domain/money'

/**
 * The done-criterion for M1-03: no precision loss across 10 000 random
 * operations.
 *
 * The four properties below marked PRECISION are the ones that criterion is
 * about — each runs 10 000 cases, so the floor is met four times over rather
 * than once across everything in the file. The rest are algebraic laws that
 * would also break under a lossy representation, and 1 000 cases is enough to
 * catch that.
 *
 * Every property is deterministic. fast-check prints the seed and the shrunk
 * counterexample on failure, which is the reason it is here: a minimal failing
 * input is something a person can act on, and a 19-digit one is not.
 */
const PRECISION_RUNS = 10_000
const LAW_RUNS = 1_000

/** Any storable amount. */
const money = (): fc.Arbitrary<Money> =>
  fc.bigInt({ min: 0n, max: MAX_CENTS }).map(fromCents)

/**
 * Small enough that combining several cannot overflow, so an overflow throw
 * never masquerades as a failed law.
 */
const smallMoney = (): fc.Arbitrary<Money> =>
  fc.bigInt({ min: 0n, max: MAX_CENTS / 1_000_000n }).map(fromCents)

describe('arithmetic loses nothing', () => {
  it('PRECISION — subtract undoes add, exactly', () => {
    fc.assert(
      fc.property(smallMoney(), smallMoney(), (a, b) => {
        expect(subtract(add(a, b), b)).toBe(a)
        expect(subtract(add(a, b), a)).toBe(b)
      }),
      { numRuns: PRECISION_RUNS },
    )
  })

  it('PRECISION — add agrees with raw bigint addition to the cent', () => {
    fc.assert(
      fc.property(smallMoney(), smallMoney(), (a, b) => {
        expect(toCents(add(a, b))).toBe(toCents(a) + toCents(b))
      }),
      { numRuns: PRECISION_RUNS },
    )
  })

  it('is commutative and associative', () => {
    fc.assert(
      fc.property(smallMoney(), smallMoney(), smallMoney(), (a, b, c) => {
        expect(add(a, b)).toBe(add(b, a))
        expect(add(add(a, b), c)).toBe(add(a, add(b, c)))
      }),
      { numRuns: LAW_RUNS },
    )
  })

  it('sums in any order to the same total', () => {
    fc.assert(
      fc.property(fc.array(smallMoney(), { minLength: 1, maxLength: 200 }), (amounts) => {
        const reversed = [...amounts].reverse()
        expect(sum(amounts)).toBe(sum(reversed))
        expect(sum(amounts)).toBe(amounts.reduce(add, fromCents(0n)))
      }),
      { numRuns: LAW_RUNS },
    )
  })

  it('multiplies as repeated addition', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: MAX_CENTS / 10_000_000n }).map(fromCents),
        fc.integer({ min: 0, max: 50 }),
        (amount, times) => {
          const repeated = sum(Array.from({ length: times }, () => amount))
          expect(multiply(amount, BigInt(times))).toBe(repeated)
        },
      ),
      { numRuns: LAW_RUNS },
    )
  })

  it('distributes multiplication over addition', () => {
    fc.assert(
      fc.property(
        smallMoney(),
        smallMoney(),
        fc.bigInt({ min: 0n, max: 1_000n }),
        (a, b, factor) => {
          expect(multiply(add(a, b), factor)).toBe(
            add(multiply(a, factor), multiply(b, factor)),
          )
        },
      ),
      { numRuns: LAW_RUNS },
    )
  })
})

describe('formatting loses nothing', () => {
  it('PRECISION — formatMoney round-trips through parseMoney', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        expect(parseMoney(formatMoney(amount))).toEqual({
          ok: true,
          value: amount,
        })
      }),
      { numRuns: PRECISION_RUNS },
    )
  })

  it('PRECISION — formatMoneyWhole round-trips through parseMoney', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        expect(parseMoney(formatMoneyWhole(amount))).toEqual({
          ok: true,
          value: amount,
        })
      }),
      { numRuns: PRECISION_RUNS },
    )
  })

  it('preserves every digit of the amount, in order', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        const digits = formatMoney(amount).replace(/\D/g, '')
        expect(digits).toBe(toCents(amount).toString().padStart(3, '0'))
      }),
      { numRuns: LAW_RUNS },
    )
  })

  it('emits only R, digits, U+0020 and U+002C', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        for (const character of formatMoney(amount)) {
          const codePoint = character.codePointAt(0)
          const allowed =
            character === 'R' ||
            (codePoint !== undefined && codePoint >= 0x30 && codePoint <= 0x39) ||
            codePoint === 0x0020 ||
            codePoint === 0x002c
          expect(allowed).toBe(true)
        }
      }),
      { numRuns: LAW_RUNS },
    )
  })

  it('matches the shape rule 7 fixes, at every magnitude', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        expect(formatMoney(amount)).toMatch(/^R\d{1,3}(?: \d{3})*,\d{2}$/)
        expect(formatMoneyWhole(amount)).toMatch(/^R\d{1,3}(?: \d{3})*(?:,\d{2})?$/)
      }),
      { numRuns: LAW_RUNS },
    )
  })

  it('drops the cents only when they are exactly zero', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        const whole = toCents(amount) % 100n === 0n
        expect(formatMoneyWhole(amount).includes(',')).toBe(!whole)
      }),
      { numRuns: LAW_RUNS },
    )
  })
})

describe('parsing loses nothing', () => {
  it('reads an amount back whatever spaces it arrives with', () => {
    fc.assert(
      fc.property(
        money(),
        fc.constantFrom('\u0020', '\u00A0', '\u2007', '\u2009', '\u202F'),
        fc.boolean(),
        (amount, space, withPrefix) => {
          const typed = formatMoney(amount).replaceAll(' ', space)
          const input = withPrefix ? typed : typed.slice(1)
          expect(parseMoney(input)).toEqual({ ok: true, value: amount })
        },
      ),
      { numRuns: LAW_RUNS },
    )
  })

  it('reads a full stop for a comma', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        const dotted = formatMoney(amount).replace(',', '.')
        expect(parseMoney(dotted)).toEqual({ ok: true, value: amount })
      }),
      { numRuns: LAW_RUNS },
    )
  })

  it('reads unseparated digits, which is what a hurried thumb produces', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        const digits = formatMoney(amount).replace(/[R ]/g, '')
        expect(parseMoney(digits)).toEqual({ ok: true, value: amount })
      }),
      { numRuns: LAW_RUNS },
    )
  })

  it('never returns a rounded amount for a third decimal place', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.integer({ min: 0, max: 9 }),
        (rands, thirdDecimal) => {
          const result = parseMoney(`${rands},99${thirdDecimal}`)
          expect(result).toEqual({ ok: false, reason: 'too-many-decimals' })
        },
      ),
      { numRuns: LAW_RUNS },
    )
  })

  it('never accepts a negative amount', () => {
    fc.assert(
      fc.property(money(), (amount) => {
        expect(parseMoney(`-${formatMoney(amount)}`)).toEqual({
          ok: false,
          reason: 'negative',
        })
      }),
      { numRuns: LAW_RUNS },
    )
  })

  it('either rejects arbitrary text or returns an exact, non-negative amount', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = parseMoney(input)
        if (result.ok) {
          expect(typeof toCents(result.value)).toBe('bigint')
          expect(toCents(result.value) >= 0n).toBe(true)
          expect(toCents(result.value) <= MAX_CENTS).toBe(true)
          // Whatever it accepted, it can say back — and be read again.
          expect(parseMoney(formatMoney(result.value))).toEqual(result)
        }
      }),
      { numRuns: PRECISION_RUNS },
    )
  })
})
