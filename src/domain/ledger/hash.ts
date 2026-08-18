import { createHash } from 'node:crypto'

import type { Money } from '@/domain/money'

/**
 * The hash chain. Architecture §4.3.
 *
 * Each entry hashes the one before it, so altering any historic row breaks
 * every hash after it. That is the whole of the claim the product makes about
 * itself — *"nobody, including us, can quietly change this record"* — and it is
 * only worth anything if the serialisation below never changes.
 *
 * **Changing the format invalidates every chain ever written.** Not "requires a
 * migration" — invalidates. Every stored `entry_hash` would stop matching its
 * own row, the nightly verifier would alert on every event in the system, and
 * there would be no way to tell which rows were tampered with and which were
 * merely re-serialised. `tests/unit/ledger-hash.test.ts` pins a fixed vector
 * for that reason: a known input with a known digest, so a reformat fails
 * loudly rather than passing every test that computes both sides with the same
 * new code.
 *
 * **Two fields here are not in §4.3, deliberately.** That formula covers
 * `sequence_no || entry_type || direction || amount_cents || reference_id ||
 * prev_hash || created_at`, which leaves `in_kind_description` outside the
 * chain — so *"the tent"* could be edited to *"a chair"* and every hash would
 * still verify. The threat model is somebody with database write access, since
 * the application role cannot UPDATE a ledger row at all, and in-kind is the
 * core of what isipheko means: the description *is* the contribution.
 * `contribution_id` is included for the same reason. §4.3 has been updated to
 * match; see docs/decisions.md M2-01.
 */

export type LedgerEntryType =
  'contribution' | 'collection' | 'payout' | 'adjustment' | 'reversal'

export type LedgerDirection = 'credit' | 'debit'

/**
 * The unit separator. It cannot appear in any of these values — Postgres
 * rejects it in text columns along with every other C0 control character except
 * tab, newline and carriage return — so no value can forge a field boundary.
 */
const FIELD_SEPARATOR = '\u001F'

/**
 * NUL, which Postgres refuses to store in a `text` column at all. That makes it
 * the one marker guaranteed to be distinguishable from a real value, so an
 * absent `in_kind_description` and an empty one hash differently.
 */
const NULL_MARKER = '\u0000'

/** What the chain covers. Not the Prisma row — the domain owns this shape. */
export interface LedgerEntryFields {
  readonly sequenceNo: number
  readonly entryType: LedgerEntryType
  readonly direction: LedgerDirection
  readonly amountCents: Money | null
  readonly inKindDescription: string | null
  readonly referenceId: string | null
  readonly contributionId: string | null
  readonly prevHash: string
  readonly createdAt: Date
}

function field(value: string | null): string {
  return value === null ? NULL_MARKER : value
}

/**
 * The canonical string. Field order is part of the format and cannot be
 * rearranged — a reordering hashes differently and is exactly as breaking as a
 * separator change.
 *
 * `created_at` is serialised as ISO-8601 with milliseconds, which is what the
 * `TIMESTAMP(3)` column stores, so the value that comes back out of the
 * database is the value that was hashed.
 */
export function serialiseEntry(entry: LedgerEntryFields): string {
  return [
    String(entry.sequenceNo),
    entry.entryType,
    entry.direction,
    field(entry.amountCents === null ? null : entry.amountCents.toString()),
    field(entry.inKindDescription),
    field(entry.referenceId),
    field(entry.contributionId),
    entry.prevHash,
    entry.createdAt.toISOString(),
  ].join(FIELD_SEPARATOR)
}

export function entryHash(entry: LedgerEntryFields): string {
  return createHash('sha256').update(serialiseEntry(entry), 'utf8').digest('hex')
}

/**
 * What the first entry in a chain points at.
 *
 * §4.3: `SHA256(event_id)`, or the collection id for a standalone collection
 * chain. There is **no synthetic genesis row** — the first real contribution or
 * payout is sequence 1 and carries this as its `prev_hash`. A row that means
 * nothing is a row somebody has to explain later.
 */
export function genesisPrevHash(chainId: string): string {
  return createHash('sha256').update(chainId, 'utf8').digest('hex')
}
