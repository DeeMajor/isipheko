/**
 * Money — integer cents, ZAR, no float anywhere.
 *
 * CLAUDE.md rule 7 and docs/architecture.md §4.4. Every amount in the product
 * passes through this type.
 *
 * **Representation is `bigint`, not `number`.** Every `*_cents` column in
 * prisma/schema.prisma is `BIGINT`, so a `number` representation would mean a
 * lossy conversion at every repository boundary and a silent cliff at 2^53.
 * `bigint` matches the storage exactly and has no cliff below it.
 *
 * **The type is branded**, so a raw `bigint` cannot be passed where a `Money`
 * is expected. `a + b` on two `Money` values yields a plain `bigint` that will
 * not assign back to `Money`, which forces callers through {@link add} and its
 * range checks rather than around them.
 *
 * **Money carries magnitude only — never a sign.** Direction lives on
 * `ledger_entries.direction`, and the database already has `>= 0` CHECKs on
 * every cents column (M1-02). A negative Money would mean something the schema
 * has no way to store.
 *
 * **No currency field.** ZAR is implicit throughout. Stitch's
 * `{quantity, currency}` shape exists only at the adapter boundary (§4.4), and
 * no domain code has any reason to know about it.
 *
 * Division is {@link divideWithRemainder}, and it hands the remainder back
 * rather than absorbing it. M1-03 left division out entirely so that the first
 * real caller would define its shape; M2-03 is that caller, and the shape is
 * "the caller decides where the odd cent goes", because that is a product
 * decision and not arithmetic.
 */

declare const moneyBrand: unique symbol

export type Money = bigint & { readonly [moneyBrand]: 'Money' }

/**
 * The largest amount that fits in the `BIGINT` columns holding it — Postgres's
 * signed 64-bit maximum. A value above this cannot be stored, so it is rejected
 * where it is constructed rather than at the point of an INSERT failure.
 */
export const MAX_CENTS = 9_223_372_036_854_775_807n

/**
 * Carries the structural reason only — never the offending amount.
 *
 * These messages reach logs, and on a bereavement event amounts default to
 * hidden (§7.3, §11). "Not an integer" is as much as a log needs to know, and
 * the same reasoning is why {@link ColumnCipherError} carries no ciphertext.
 */
export class MoneyError extends Error {
  override readonly name = 'MoneyError'

  constructor(reason: string) {
    super(`Invalid money: ${reason}`)
  }
}

/** R0,00. */
export const zero = 0n as Money

/**
 * The only way to make a Money. Rejects negatives (magnitude only — see the
 * module note) and anything that would not fit in a `BIGINT` column.
 *
 * Takes `bigint` rather than `number` on purpose: there is no numeric literal
 * anywhere in this module's signatures that a float could be passed as.
 */
export function fromCents(cents: bigint): Money {
  if (cents < 0n) {
    throw new MoneyError('amounts are magnitudes and cannot be negative')
  }
  if (cents > MAX_CENTS) {
    throw new MoneyError('exceeds the range of the BIGINT column that stores it')
  }
  return cents as Money
}

/** For the db/ boundary, where a `BIGINT` column wants a plain bigint. */
export function toCents(money: Money): bigint {
  return money
}

export function add(a: Money, b: Money): Money {
  return fromCents(a + b)
}

/**
 * Throws on underflow. A result below zero is a programming error, not user
 * input — Money is a magnitude, so there is no value to return.
 */
export function subtract(a: Money, b: Money): Money {
  if (b > a) {
    throw new MoneyError('subtraction would produce a negative amount')
  }
  return fromCents(a - b)
}

/**
 * Scales by a whole count — a quantity of chairs, a number of plates. Not a
 * rate or a percentage: a fractional factor would need rounding, and rounding
 * is what this type exists to avoid.
 */
export function multiply(money: Money, factor: bigint): Money {
  if (factor < 0n) {
    throw new MoneyError('cannot multiply by a negative factor')
  }
  return fromCents(money * factor)
}

export interface Division {
  /** What each part gets. */
  readonly each: Money
  /**
   * What is left over, always smaller than `parts`.
   *
   * **Returned, never absorbed.** R100 split three ways is 33,33 each and one
   * cent over, and where that cent goes — the first claimant, the organiser,
   * nowhere — is a decision about the product. Rounding it away silently is how
   * a ledger stops adding up, and this ledger is the thing people are asked to
   * trust.
   */
  readonly remainder: Money
}

/**
 * Splits an amount into whole parts.
 *
 * `each * parts + remainder === money`, exactly, always. A test asserts that
 * over ten thousand random splits.
 */
export function divideWithRemainder(money: Money, parts: bigint): Division {
  if (parts < 1n) {
    throw new MoneyError('cannot divide into fewer than one part')
  }

  const each = money / parts

  return { each: fromCents(each), remainder: fromCents(money - each * parts) }
}

export function sum(amounts: Iterable<Money>): Money {
  let total = zero
  for (const amount of amounts) {
    total = add(total, amount)
  }
  return total
}

export function equals(a: Money, b: Money): boolean {
  return a === b
}

export function isZero(money: Money): boolean {
  return money === zero
}

export function lessThan(a: Money, b: Money): boolean {
  return a < b
}

export function greaterThan(a: Money, b: Money): boolean {
  return a > b
}

/** `-1 | 0 | 1`, for sorting. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
