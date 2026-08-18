/**
 * Import from here — `import { add, formatMoney } from '@/domain/money'`.
 *
 * Named exports rather than a `Money.add(…)` namespace object, because the
 * formatters get used on the public event page and a namespace object cannot be
 * tree-shaken. The 150 KB budget in CLAUDE.md rule 9 is a build-failing gate.
 */

export {
  type Division,
  type Money,
  MAX_CENTS,
  MoneyError,
  add,
  compare,
  divideWithRemainder,
  equals,
  fromCents,
  greaterThan,
  isZero,
  lessThan,
  multiply,
  subtract,
  sum,
  toCents,
  zero,
} from './money.ts'

export {
  type MoneyParseFailure,
  type MoneyParseResult,
  formatMoney,
  formatMoneyWhole,
  parseMoney,
} from './format.ts'
