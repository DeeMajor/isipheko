import { describe, expect, it } from 'vitest'

import {
  entryHash,
  genesisPrevHash,
  verifyChain,
  type ChainEntry,
  type LedgerEntryFields,
} from '@/domain/ledger'
import { fromCents } from '@/domain/money'

/**
 * Chain verification, over rows somebody else read.
 *
 * Every case here is a way the record could have been altered by somebody with
 * database access — which is the only way it can be altered at all, since the
 * application role holds no UPDATE or DELETE on `ledger_entries`.
 */

const CHAIN = '01923f7e-0000-7000-8000-000000000001'

/** Builds a well-formed chain of the given length, hashes and all. */
function chainOf(length: number, chainId = CHAIN): ChainEntry[] {
  const entries: ChainEntry[] = []
  let prevHash = genesisPrevHash(chainId)

  for (let sequenceNo = 1; sequenceNo <= length; sequenceNo += 1) {
    const fields: LedgerEntryFields = {
      sequenceNo,
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(BigInt(sequenceNo) * 10_000n),
      inKindDescription: null,
      referenceId: `ref-${String(sequenceNo)}`,
      contributionId: null,
      prevHash,
      createdAt: new Date(Date.UTC(2026, 7, 16, 12, 0, sequenceNo)),
    }

    const hash = entryHash(fields)
    entries.push({ ...fields, id: `id-${String(sequenceNo)}`, entryHash: hash })
    prevHash = hash
  }

  return entries
}

describe('a chain that has not been touched', () => {
  it('verifies', () => {
    expect(verifyChain(CHAIN, chainOf(5)).problems).toEqual([])
  })

  it('verifies when it is empty', () => {
    // An event nobody has contributed to yet is the ordinary state of a page on
    // the day it is shared.
    expect(verifyChain(CHAIN, []).problems).toEqual([])
  })

  it('verifies however the rows arrive', () => {
    // A caller that forgets ORDER BY should get a correct answer, not an alert.
    const shuffled = [...chainOf(5)].reverse()

    expect(verifyChain(CHAIN, shuffled).problems).toEqual([])
  })
})

describe('a chain that has been altered', () => {
  it('catches an amount changed in place', () => {
    // The row is rewritten and its stored hash left alone — what an UPDATE
    // through psql looks like.
    const entries = chainOf(3)
    entries[1] = { ...entries[1]!, amountCents: fromCents(999_999n) }

    expect(verifyChain(CHAIN, entries).problems).toContainEqual({
      kind: 'hash-mismatch',
      at: 2,
    })
  })

  it('catches an in-kind description changed in place', () => {
    // The field §4.3 left outside the chain. "The tent" becoming "a chair"
    // would otherwise verify perfectly.
    const entries = chainOf(2)
    entries[0] = { ...entries[0]!, inKindDescription: 'a chair' }

    expect(verifyChain(CHAIN, entries).problems).toContainEqual({
      kind: 'hash-mismatch',
      at: 1,
    })
  })

  it('catches a rewritten row whose hash was recomputed to match', () => {
    // The more careful attacker: change the row *and* fix its hash. The link
    // from the next entry is what gives it away.
    const entries = chainOf(3)
    const tampered = { ...entries[1]!, amountCents: fromCents(1n) }
    entries[1] = { ...tampered, entryHash: entryHash(tampered) }

    const problems = verifyChain(CHAIN, entries).problems

    expect(problems).toContainEqual({ kind: 'broken-link', at: 3 })
  })

  it('catches a deleted entry', () => {
    const entries = chainOf(4)
    entries.splice(1, 1)

    const problems = verifyChain(CHAIN, entries).problems

    expect(problems).toContainEqual({ kind: 'sequence-gap', at: 3, expected: 2 })
    expect(problems).toContainEqual({ kind: 'broken-link', at: 3 })
  })

  it('catches two rows claiming one position', () => {
    const entries = chainOf(2)
    entries.push({ ...entries[1]!, id: 'id-duplicate' })

    expect(verifyChain(CHAIN, entries).problems).toContainEqual({
      kind: 'duplicate-sequence',
      at: 2,
    })
  })

  it('catches a chain grafted from another event', () => {
    // Entries that verify perfectly among themselves, but do not begin at
    // SHA256 of *this* chain's id.
    const foreign = chainOf(3, 'a-different-chain-entirely')

    expect(verifyChain(CHAIN, foreign).problems).toContainEqual({
      kind: 'wrong-genesis',
      at: 1,
    })
  })

  it('reports one gap once, not every entry after it', () => {
    const entries = chainOf(6)
    entries.splice(2, 1)

    const gaps = verifyChain(CHAIN, entries).problems.filter(
      (problem) => problem.kind === 'sequence-gap',
    )

    expect(gaps).toHaveLength(1)
  })
})

describe('what the report says', () => {
  it('carries no amount, name or description', () => {
    const entries = chainOf(3)
    entries[1] = {
      ...entries[1]!,
      amountCents: fromCents(123_456n),
      inKindDescription: 'twenty kilograms of meat',
    }

    const report = verifyChain(CHAIN, entries)
    const serialised = JSON.stringify(report)

    // This output reaches build logs and alerts, which are widely readable and
    // long-lived. A bereavement event hides amounts so a grieving family is not
    // ranked by them.
    expect(serialised).not.toContain('123456')
    expect(serialised).not.toContain('meat')
    expect(report.problems).toContainEqual({ kind: 'hash-mismatch', at: 2 })
  })

  it('counts what it looked at', () => {
    const report = verifyChain(CHAIN, chainOf(7))

    expect(report.entryCount).toBe(7)
    expect(report.chainId).toBe(CHAIN)
  })
})
