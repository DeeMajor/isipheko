// Relative rather than `@/`, unlike its sibling repositories, because
// `scripts/verify-ledger.ts` imports this module under plain Node — which
// resolves no tsconfig aliases, and which disables its own type stripping the
// moment a custom resolve hook is registered (tried; Node 22.22).
//
// The alternative was writing the ledger queries a second time inside the
// verifier. A nightly verifier that reads the chain differently from the code
// that wrote it is exactly the drift that makes a verifier worthless.
import type { PrismaClient } from '../generated/client.ts'
import { fromCents, type Money } from '../../domain/money/index.ts'
import {
  entryHash,
  genesisPrevHash,
  type ChainEntry,
  type LedgerDirection,
  type LedgerEntryType,
} from '../../domain/ledger/index.ts'

/**
 * Appending to the ledger, and reading it back to verify.
 *
 * The application role holds INSERT and SELECT here and **not** UPDATE or
 * DELETE (M1-02). Nothing in this file could rewrite an entry if it tried; a
 * correction is a `reversal` entry, which is a new row.
 */

/** A chain belongs to an event or to a standalone collection, never both. */
export type Chain = { readonly eventId: string } | { readonly collectionId: string }

export function chainId(chain: Chain): string {
  return 'eventId' in chain ? chain.eventId : chain.collectionId
}

function chainWhere(chain: Chain) {
  return 'eventId' in chain
    ? { eventId: chain.eventId }
    : { collectionId: chain.collectionId }
}

export interface AppendInput {
  readonly chain: Chain
  readonly entryType: LedgerEntryType
  readonly direction: LedgerDirection
  readonly amountCents?: Money | null
  readonly inKindDescription?: string | null
  /**
   * What this entry records: a contribution, a collection, a payout — or, for a
   * `reversal`, **the id of the ledger entry being reversed**. Pointing a
   * reversal at the original contribution instead would lose which entry was
   * corrected as soon as there is more than one, and more than one is exactly
   * when the record has to be unambiguous.
   */
  readonly referenceId?: string | null
  readonly contributionId?: string | null
  /**
   * Supplied by the caller because the hash covers it: it has to exist before
   * the INSERT. The column keeps its `now()` default for anything that bypasses
   * this function, and `TIMESTAMP(3)` stores exactly the milliseconds
   * `toISOString()` writes, so what comes back is what was hashed.
   */
  readonly createdAt?: Date
}

export interface AppendedEntry {
  readonly id: string
  readonly sequenceNo: number
  readonly entryHash: string
  readonly prevHash: string
}

/**
 * Two appends to one chain must not produce two sequence 6s, and must not
 * produce a 5 and a 7 with nothing between them.
 *
 * The unique indexes on `(event_id, sequence_no)` and
 * `(collection_id, sequence_no)` make a duplicate impossible — Postgres refuses
 * it. What they cannot prevent is two writers reading `max = 5` at the same
 * moment, one winning and the other failing, which costs a round trip and gives
 * the loser an error to interpret.
 *
 * So the transaction takes an advisory lock on the chain first and the writers
 * serialise. The lock is the mechanism; the unique constraint is what makes a
 * gap impossible if the mechanism is ever wrong — a lock somebody forgets to
 * take is a bug, and a bug that silently corrupts the trust artefact is not one
 * worth leaving to discipline.
 *
 * The lock is transaction-scoped, so it is released by the commit or the
 * rollback and never by remembering to.
 */
export async function appendEntry(
  db: PrismaClient,
  input: AppendInput,
): Promise<AppendedEntry> {
  return db.$transaction((tx) => appendEntryWithin(tx as PrismaClient, input))
}

/**
 * The append itself, **inside a transaction the caller already opened**.
 *
 * It exists because some appends have to be atomic with something that is not a
 * ledger row: M2-06's in-kind confirmation marks a claim delivered, writes the
 * contribution and appends the entry, and a crash between any two of those
 * would leave the record saying something that did not happen.
 *
 * The advisory lock is taken here rather than by {@link appendEntry}, so it is
 * held for the caller's whole transaction and the serialisation guarantee is
 * the same either way.
 */
export async function appendEntryWithin(
  tx: PrismaClient,
  input: AppendInput,
): Promise<AppendedEntry> {
  const id = chainId(input.chain)
  const where = chainWhere(input.chain)
  const createdAt = input.createdAt ?? new Date()

  // hashtextextended gives a bigint from the chain id; pg_advisory_xact_lock
  // takes one. Any other writer on this chain waits here.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`

  const last = await tx.ledgerEntry.findFirst({
    where,
    orderBy: { sequenceNo: 'desc' },
    select: { sequenceNo: true, entryHash: true },
  })

  const sequenceNo = (last?.sequenceNo ?? 0) + 1
  const prevHash = last?.entryHash ?? genesisPrevHash(id)

  const fields = {
    sequenceNo,
    entryType: input.entryType,
    direction: input.direction,
    amountCents: input.amountCents ?? null,
    inKindDescription: input.inKindDescription ?? null,
    referenceId: input.referenceId ?? null,
    contributionId: input.contributionId ?? null,
    prevHash,
    createdAt,
  }

  return tx.ledgerEntry.create({
    data: {
      ...where,
      sequenceNo,
      entryType: fields.entryType,
      direction: fields.direction,
      amountCents: fields.amountCents,
      inKindDescription: fields.inKindDescription,
      referenceId: fields.referenceId,
      contributionId: fields.contributionId,
      prevHash,
      entryHash: entryHash(fields),
      createdAt,
    },
    select: { id: true, sequenceNo: true, entryHash: true, prevHash: true },
  })
}

/**
 * A reversal: the same amount, the opposite direction, pointing at the entry it
 * corrects. The original stays exactly where it is — that is the point of an
 * append-only record.
 */
export async function appendReversal(
  db: PrismaClient,
  { chain, reversing }: { chain: Chain; reversing: string },
): Promise<AppendedEntry> {
  const original = await db.ledgerEntry.findUniqueOrThrow({
    where: { id: reversing },
    select: {
      direction: true,
      amountCents: true,
      inKindDescription: true,
      eventId: true,
      collectionId: true,
    },
  })

  const belongsToChain =
    'eventId' in chain
      ? original.eventId === chain.eventId
      : original.collectionId === chain.collectionId

  if (!belongsToChain) {
    throw new Error('Cannot reverse an entry from a different chain')
  }

  return appendEntry(db, {
    chain,
    entryType: 'reversal',
    direction: original.direction === 'credit' ? 'debit' : 'credit',
    amountCents: original.amountCents === null ? null : fromCents(original.amountCents),
    inKindDescription: original.inKindDescription,
    referenceId: reversing,
  })
}

/** Everything in one chain, in order, shaped for `verifyChain`. */
export async function entriesForChain(
  db: PrismaClient,
  chain: Chain,
): Promise<readonly ChainEntry[]> {
  const rows = await db.ledgerEntry.findMany({
    where: chainWhere(chain),
    orderBy: { sequenceNo: 'asc' },
    select: {
      id: true,
      sequenceNo: true,
      entryType: true,
      direction: true,
      amountCents: true,
      inKindDescription: true,
      referenceId: true,
      contributionId: true,
      prevHash: true,
      entryHash: true,
      createdAt: true,
    },
  })

  return rows.map((row) => ({
    ...row,
    amountCents: row.amountCents === null ? null : fromCents(row.amountCents),
  }))
}

/**
 * Every chain that has an entry, for the nightly verification.
 *
 * An event with no contributions has no chain to verify — there is nothing to
 * have been altered — so this asks the ledger what exists rather than asking
 * the events table what might.
 */
export async function chainsWithEntries(db: PrismaClient): Promise<readonly Chain[]> {
  const [events, collections] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { eventId: { not: null } },
      distinct: ['eventId'],
      select: { eventId: true },
    }),
    db.ledgerEntry.findMany({
      where: { collectionId: { not: null } },
      distinct: ['collectionId'],
      select: { collectionId: true },
    }),
  ])

  return [
    ...events.flatMap((row) => (row.eventId === null ? [] : [{ eventId: row.eventId }])),
    ...collections.flatMap((row) =>
      row.collectionId === null ? [] : [{ collectionId: row.collectionId }],
    ),
  ]
}
