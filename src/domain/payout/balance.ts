import { fromCents, toCents, type Money } from '../money/index.ts'

/**
 * What has come in, and what part of it is still inside the window in which it
 * can be taken back.
 *
 * ## The hold is a fence around the recent portion, never the whole balance
 *
 * That distinction is the whole of this file. A hold that froze everything
 * whenever anything was recent would mean a family who received one R50
 * contribution this morning cannot touch the R40 000 that arrived last week —
 * which is not a safety measure, it is a product that stops working on the day
 * it is used most. **Only entries inside the window are fenced.**
 *
 * ## What the window is for
 *
 * Architecture §5.3 guards a payout on *"72h hold elapsed on contributions
 * being drawn"*. The reason is reversibility: a card charge-back, a payment
 * made by mistake, a payment that turns out to be fraud. Inside the window the
 * correction is ours to make; outside it, it is the organiser's problem to fix.
 * Security copy explains what it protects rather than what it blocks, and this
 * is the sentence that comes from.
 *
 * ## What it is not, today
 *
 * **Mode A has no held balance.** The contributor pays the organiser directly,
 * so the money in this calculation is already in her own account and there is
 * nothing for us to release. The arithmetic here is real — it reads real ledger
 * rows — and it is what Mode B's payout guard will use unchanged, but nothing
 * in this product may render it as a balance we hold or as an amount ready to
 * be paid out. See docs/decisions.md M3-08 §3.
 *
 * Pure: sums and a window. No I/O.
 */

/**
 * 72 hours, per architecture §5.3 and §5.4.
 *
 * A constant rather than a setting: it is a promise made in copy on the
 * organiser's screen, and a window that can be shortened by configuration is a
 * window whose stated length is not the one in force.
 */
export const SETTLEMENT_HOLD_MS = 72 * 60 * 60 * 1000

/**
 * Above this, one of the abakhaphi agrees to a payout as well.
 *
 * **Invented by `design/dashboard.html` and not yet validated** — Part J item 8.
 * PayShap data suggests 80% of transactions are under R500, so R5 000 may be
 * high or low depending on total event size, and it should be confirmed against
 * real contribution sizes before Mode B ships.
 *
 * A named constant and deliberately **not** an environment variable: nothing
 * needs to vary it yet, and a setting implies it has been tuned. When there is
 * evidence, the evidence moves this line.
 */
export const WITNESS_APPROVAL_THRESHOLD = fromCents(5_000_00n)

/** One money movement on a chain, as the split needs to see it. */
export interface BalanceEntry {
  readonly amount: Money | null
  readonly direction: 'credit' | 'debit'
  /**
   * Supplied by the caller and never read from a wall clock. The ledger writes
   * `created_at` from the application for the same reason the hash covers it
   * (M2-01 §3, M2-08b §6) — a window computed against a column the database
   * stamped cannot be tested at a fixed instant.
   */
  readonly at: Date
}

export interface Balance {
  /** Everything on the record, in and out. */
  readonly raised: Money
  /** The recent portion, still inside the window. */
  readonly settling: Money
  /** `raised - settling`. What the hold does not fence. */
  readonly available: Money
  /** When the oldest settling entry leaves the window. Null when none is. */
  readonly clearsAt: Date | null
}

/**
 * In-kind entries carry no amount and are excluded from every figure here.
 *
 * A tent is not money and cannot be paid out. Counting it would inflate a
 * number an organiser might act on, and in-kind contribution is the core of
 * what *isipheko* means — it belongs on the strand and on the needs board, not
 * in a balance.
 */
function isMoney(entry: BalanceEntry): boolean {
  return entry.amount !== null
}

export function splitBalance(entries: readonly BalanceEntry[], now: Date): Balance {
  const cutoff = new Date(now.getTime() - SETTLEMENT_HOLD_MS)

  // Plain `bigint`, not `Money`, for the running totals. **Money is a magnitude
  // and refuses to be negative** — which is right for an amount and wrong for a
  // subtotal that a reversal can take below zero on its way back up. The
  // magnitudes are made at the end, once, from values that have been clamped.
  let raised = 0n
  let settling = 0n
  let oldestSettling: Date | null = null

  for (const entry of entries) {
    if (!isMoney(entry)) continue

    // A debit — a reversal, or a payout once Mode B exists — reduces both the
    // total and, if it is itself recent, the fenced portion. A reversal that
    // only came off the total would leave the hold fencing money that is no
    // longer there.
    const cents = toCents(entry.amount ?? (0n as Money))
    const signed = entry.direction === 'credit' ? cents : -cents

    raised += signed

    if (entry.at.getTime() > cutoff.getTime()) {
      settling += signed
      if (oldestSettling === null || entry.at.getTime() < oldestSettling.getTime()) {
        oldestSettling = entry.at
      }
    }
  }

  // Reversals can in principle take either subtotal past its bounds — an old
  // credit reversed today is a recent debit against money that was never
  // fenced. Neither figure may go negative, and the fenced portion may never
  // exceed the total, or `available` would be a negative amount on the one
  // screen where money is counted.
  const total = raised < 0n ? 0n : raised
  const fenced = settling < 0n ? 0n : settling > total ? total : settling

  return {
    raised: fromCents(total),
    settling: fromCents(fenced),
    available: fromCents(total - fenced),
    clearsAt:
      fenced === 0n || oldestSettling === null
        ? null
        : new Date(oldestSettling.getTime() + SETTLEMENT_HOLD_MS),
  }
}

/** Whether a payout of this size needs an umkhaphi to agree as well. */
export function needsWitnessApproval(amount: Money): boolean {
  return amount > WITNESS_APPROVAL_THRESHOLD
}
