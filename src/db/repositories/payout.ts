import type { PrismaClient } from '../generated/client.ts'
import { fromCents } from '../../domain/money/index.ts'
import {
  splitBalance,
  type Balance,
  type BalanceEntry,
} from '../../domain/payout/index.ts'

/**
 * What the organiser's dashboard needs in order to say where the money stands.
 *
 * **Read-only, and there is nothing here that requests a payout.** Mode B is
 * Milestone 5 and gated on the legal opinion (architecture §15 item 1); the
 * `payouts` table exists and nothing in this product writes a row to it. The
 * absence of an insert in this file is deliberate — see docs/decisions.md
 * M3-08 §3.
 *
 * Relative imports with extensions, like the other repositories (M2-01 §8).
 */

/**
 * The money movements on an event's chain, oldest first.
 *
 * Reads the ledger rather than `contributions`, because the ledger is the
 * record — a contribution row can be edited by the application and a ledger row
 * cannot (rule 3). If the two ever disagreed, the number an organiser is shown
 * should be the one nobody can quietly change.
 *
 * `created_at` is supplied by the application on every append (M2-01 §3), which
 * is what lets the 72-hour window be computed against a simulated clock rather
 * than the hour the page happens to be loaded.
 */
export async function balanceEntriesForEvent(
  db: PrismaClient,
  eventId: string,
): Promise<readonly BalanceEntry[]> {
  const rows = await db.ledgerEntry.findMany({
    where: { eventId },
    orderBy: { sequenceNo: 'asc' },
    select: { amountCents: true, direction: true, createdAt: true },
  })

  return rows.map((row) => ({
    amount: row.amountCents === null ? null : fromCents(row.amountCents),
    direction: row.direction === 'debit' ? 'debit' : 'credit',
    at: row.createdAt,
  }))
}

export async function balanceForEvent(
  db: PrismaClient,
  { eventId, now = new Date() }: { eventId: string; now?: Date },
): Promise<Balance> {
  return splitBalance(await balanceEntriesForEvent(db, eventId), now)
}

/**
 * Whether this organiser has a bank account we have checked.
 *
 * **Always false today.** Nothing writes `bank_accounts`: verification needs
 * the Stitch BAV integration described in Part F, which is Mode B work. This
 * reads the column rather than returning a literal so that the day something
 * does write one, the condition on the dashboard becomes true without anybody
 * remembering to come back here.
 */
export async function bankAccountVerified(
  db: PrismaClient,
  organiserId: string,
): Promise<boolean> {
  const account = await db.bankAccount.findFirst({
    // `active` is the enum's word for a usable account; `bavVerifiedAt` is
    // what says the check actually ran. Both, because a row could in principle
    // be made active by a code path that never verified it, and this figure
    // gates money.
    where: { organiserId, status: 'active' },
    select: { bavVerifiedAt: true },
  })

  return account !== null && account.bavVerifiedAt !== null
}

/**
 * Whether an umkhaphi has agreed to a payout on this event.
 *
 * **Always false today, and for a different reason from the one above**: there
 * is no payout to agree to. `payouts.approvals` is where an approval will land
 * (architecture §4.2), and no row exists to carry one. Reading it rather than
 * returning a literal keeps the seam where it belongs.
 */
export async function payoutApprovedByWitness(
  db: PrismaClient,
  eventId: string,
): Promise<boolean> {
  const payout = await db.payout.findFirst({
    where: { eventId, status: { in: ['pending', 'submitted'] } },
    select: { approvals: true },
  })

  if (payout === null) return false

  return Array.isArray(payout.approvals) && payout.approvals.length > 0
}
