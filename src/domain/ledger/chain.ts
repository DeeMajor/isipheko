import { entryHash, genesisPrevHash, type LedgerEntryFields } from './hash.ts'

/**
 * Verifying a chain, as pure arithmetic over rows somebody else read.
 *
 * This is what `scripts/verify-ledger.ts` runs nightly against every chain in
 * the system (architecture §13). It answers one question — has anything in this
 * record been changed since it was written — and it answers it without needing
 * to know what the amounts were.
 *
 * **Nothing here reports an amount, a name or a description.** The output goes
 * into build logs and alerts, which are widely readable and long-lived. A
 * bereavement event hides amounts precisely so a grieving family is not ranked
 * by them, and a verifier that printed them into CI output would undo that
 * somewhere nobody thinks to look. A chain, a sequence number and which hash
 * disagreed is enough to investigate.
 */

export interface ChainEntry extends LedgerEntryFields {
  readonly id: string
  readonly entryHash: string
}

export type ChainProblem =
  /** A sequence number is missing: 1, 2, 4. Something was deleted, or never committed. */
  | { readonly kind: 'sequence-gap'; readonly at: number; readonly expected: number }
  /** Two rows claim the same position in the chain. */
  | { readonly kind: 'duplicate-sequence'; readonly at: number }
  /** The first entry does not point at SHA256(chain_id). */
  | { readonly kind: 'wrong-genesis'; readonly at: number }
  /** An entry's `prev_hash` is not the previous entry's `entry_hash`. */
  | { readonly kind: 'broken-link'; readonly at: number }
  /** The stored `entry_hash` is not what this row hashes to. The row was altered. */
  | { readonly kind: 'hash-mismatch'; readonly at: number }

export interface ChainReport {
  readonly chainId: string
  readonly entryCount: number
  readonly problems: readonly ChainProblem[]
}

/**
 * An empty chain is a valid chain — an event nobody has contributed to yet is
 * the ordinary state of a page on the day it is shared.
 *
 * Entries are sorted here rather than trusted to arrive ordered, so a caller
 * that forgets `ORDER BY` gets a correct answer instead of a false alarm.
 */
export function verifyChain(
  chainId: string,
  entries: readonly ChainEntry[],
): ChainReport {
  const ordered = [...entries].sort((a, b) => a.sequenceNo - b.sequenceNo)
  const problems: ChainProblem[] = []

  let previousHash = genesisPrevHash(chainId)
  let expected = 1

  for (const [index, entry] of ordered.entries()) {
    const previous = ordered[index - 1]

    if (previous !== undefined && previous.sequenceNo === entry.sequenceNo) {
      problems.push({ kind: 'duplicate-sequence', at: entry.sequenceNo })
      continue
    }

    if (entry.sequenceNo !== expected) {
      problems.push({ kind: 'sequence-gap', at: entry.sequenceNo, expected })
      // Carry on from where the chain actually is, so one gap does not report
      // every subsequent entry as also out of place.
      expected = entry.sequenceNo
    }

    if (entry.prevHash !== previousHash) {
      problems.push({
        kind: index === 0 ? 'wrong-genesis' : 'broken-link',
        at: entry.sequenceNo,
      })
    }

    if (entryHash(entry) !== entry.entryHash) {
      problems.push({ kind: 'hash-mismatch', at: entry.sequenceNo })
    }

    previousHash = entry.entryHash
    expected += 1
  }

  return { chainId, entryCount: ordered.length, problems }
}

export function describeProblem(problem: ChainProblem): string {
  switch (problem.kind) {
    case 'sequence-gap':
      return `entry ${String(problem.at)}: expected sequence ${String(problem.expected)}`
    case 'duplicate-sequence':
      return `entry ${String(problem.at)}: two rows hold this sequence`
    case 'wrong-genesis':
      return `entry ${String(problem.at)}: does not begin at SHA256(chain id)`
    case 'broken-link':
      return `entry ${String(problem.at)}: prev_hash is not the previous entry_hash`
    case 'hash-mismatch':
      return `entry ${String(problem.at)}: entry_hash does not match the row — it was altered`
  }
}
