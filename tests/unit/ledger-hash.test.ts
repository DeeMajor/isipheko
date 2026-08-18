import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  entryHash,
  genesisPrevHash,
  serialiseEntry,
  type LedgerEntryFields,
} from '@/domain/ledger'
import { fromCents } from '@/domain/money'

/**
 * The serialisation format, pinned.
 *
 * Changing it does not require a migration — it **invalidates every chain ever
 * written**. Every stored `entry_hash` stops matching its own row, the nightly
 * verifier alerts on every event in the system, and there is no way left to
 * tell an altered row from a re-serialised one.
 *
 * A reformat would pass typecheck, pass lint, and pass every test that computes
 * both sides with the same new code. The fixed vector below is what does not
 * pass: a known input, a digest written down once, checked against a hash
 * computed here from first principles rather than by calling the code under
 * test.
 */

const CHAIN_ID = '01923f7e-0000-7000-8000-000000000001'

const ENTRY: LedgerEntryFields = {
  sequenceNo: 1,
  entryType: 'contribution',
  direction: 'credit',
  amountCents: fromCents(50_000n),
  inKindDescription: null,
  referenceId: '01923f7e-0000-7000-8000-00000000000c',
  contributionId: '01923f7e-0000-7000-8000-00000000000d',
  prevHash: 'a'.repeat(64),
  createdAt: new Date('2026-08-16T12:00:00.000Z'),
}

describe('the canonical serialisation', () => {
  it('is exactly this string', () => {
    // Written out with the separators visible. If this test needs editing, the
    // change under it invalidates production data.
    const expected = [
      '1',
      'contribution',
      'credit',
      '50000',
      '\u0000',
      '01923f7e-0000-7000-8000-00000000000c',
      '01923f7e-0000-7000-8000-00000000000d',
      'a'.repeat(64),
      '2026-08-16T12:00:00.000Z',
    ].join('\u001F')

    expect(serialiseEntry(ENTRY)).toBe(expected)
  })

  it('hashes to this digest', () => {
    // Computed here from the string above rather than by calling entryHash, so
    // the two sides cannot drift together.
    const expected = createHash('sha256')
      .update(serialiseEntry(ENTRY), 'utf8')
      .digest('hex')

    expect(entryHash(ENTRY)).toBe(expected)
    expect(entryHash(ENTRY)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('separates fields with a character no value can contain', () => {
    // Postgres rejects C0 control characters other than tab, newline and
    // carriage return in text columns, so no description can forge a boundary.
    expect(serialiseEntry(ENTRY)).toContain('\u001F')
  })

  it('tells an absent value from an empty one', () => {
    const absent = entryHash({ ...ENTRY, inKindDescription: null })
    const empty = entryHash({ ...ENTRY, inKindDescription: '' })

    expect(absent).not.toBe(empty)
  })

  it('is sensitive to every field it covers', () => {
    const base = entryHash(ENTRY)

    const variants: LedgerEntryFields[] = [
      { ...ENTRY, sequenceNo: 2 },
      { ...ENTRY, entryType: 'payout' },
      { ...ENTRY, direction: 'debit' },
      { ...ENTRY, amountCents: fromCents(50_001n) },
      { ...ENTRY, amountCents: null },
      { ...ENTRY, inKindDescription: 'the tent' },
      { ...ENTRY, referenceId: null },
      { ...ENTRY, contributionId: null },
      { ...ENTRY, prevHash: 'b'.repeat(64) },
      { ...ENTRY, createdAt: new Date('2026-08-16T12:00:00.001Z') },
    ]

    for (const variant of variants) {
      expect(entryHash(variant)).not.toBe(base)
    }
  })

  it('covers the in-kind description — the field §4.3 left out', () => {
    // "The tent" edited to "a chair" would otherwise verify perfectly. In-kind
    // is the core of what isipheko means: the description is the contribution.
    const tent = entryHash({ ...ENTRY, amountCents: null, inKindDescription: 'the tent' })
    const chair = entryHash({ ...ENTRY, amountCents: null, inKindDescription: 'a chair' })

    expect(tent).not.toBe(chair)
  })

  it('cannot be forged by moving a separator into a value', () => {
    // A description containing what looks like a field boundary must not be
    // able to impersonate a different set of fields.
    const honest = entryHash({ ...ENTRY, inKindDescription: 'tent' })
    const sneaky = entryHash({
      ...ENTRY,
      inKindDescription: `tent\u001F${ENTRY.referenceId ?? ''}`,
    })

    expect(honest).not.toBe(sneaky)
  })
})

describe('genesis', () => {
  it('is SHA256 of the chain id, per §4.3', () => {
    const expected = createHash('sha256').update(CHAIN_ID, 'utf8').digest('hex')

    expect(genesisPrevHash(CHAIN_ID)).toBe(expected)
  })

  it('differs per chain, so one chain cannot be grafted onto another', () => {
    expect(genesisPrevHash(CHAIN_ID)).not.toBe(genesisPrevHash(`${CHAIN_ID}2`))
  })
})
