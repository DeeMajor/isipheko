import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import {
  appendEntry,
  appendReversal,
  chainsWithEntries,
  entriesForChain,
} from '@/db/repositories/ledger'
import { verifyChain } from '@/domain/ledger'
import { fromCents } from '@/domain/money'

import { clientFor } from '../setup/prisma'
import { uniqueRefCode } from '../setup/reference'

/**
 * The hash chain against a real Postgres.
 *
 * Two things here cannot be tested anywhere else. **Tampering** has to be done
 * the way it would really happen — an UPDATE from a privileged connection,
 * because the application role has no UPDATE on `ledger_entries` at all — and
 * the owner client in this file is what makes that possible. **Concurrency** has
 * to be real transactions racing for real locks; a mocked database would answer
 * according to whatever its author believed about locking, which is the belief
 * under test.
 */

let app: PrismaClient
let owner: PrismaClient
let organiserId: string

let eventCounter = 0

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))
  owner = clientFor(inject('ownerDatabaseUrl'))

  const organiser = await app.organiser.create({
    data: { phoneE164: '+27820000501', displayName: 'Nomsa Mthembu' },
  })
  organiserId = organiser.id
})

afterAll(async () => {
  await Promise.all([app.$disconnect(), owner.$disconnect()])
})

async function newEvent(): Promise<string> {
  const event = await app.event.create({
    data: {
      organiserId,
      slug: `ledger-${String(++eventCounter).padStart(4, '0')}-aaaaaaaaaaaa`,
      archetype: 'umngcwabo',
      archetypeGroup: 'bereavement',
      refPrefix: 'TST',
      refCode: uniqueRefCode(),
      title: 'Nokuthula Mthembu',
    },
    select: { id: true },
  })

  return event.id
}

describe('appending', () => {
  it('starts at sequence 1, pointing at SHA256 of the chain id', async () => {
    const eventId = await newEvent()

    const first = await appendEntry(app, {
      chain: { eventId },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(50_000n),
    })

    expect(first.sequenceNo).toBe(1)

    const report = verifyChain(eventId, await entriesForChain(app, { eventId }))
    expect(report.problems).toEqual([])
  })

  it('links each entry to the one before it', async () => {
    const eventId = await newEvent()

    const first = await appendEntry(app, {
      chain: { eventId },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(10_000n),
    })
    const second = await appendEntry(app, {
      chain: { eventId },
      entryType: 'contribution',
      direction: 'credit',
      inKindDescription: 'the tent',
    })

    expect(second.sequenceNo).toBe(2)
    expect(second.prevHash).toBe(first.entryHash)
    expect(
      verifyChain(eventId, await entriesForChain(app, { eventId })).problems,
    ).toEqual([])
  })

  it('numbers per chain, so two events both begin at 1', async () => {
    const [one, two] = [await newEvent(), await newEvent()]

    const a = await appendEntry(app, {
      chain: { eventId: one },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(1_000n),
    })
    const b = await appendEntry(app, {
      chain: { eventId: two },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(1_000n),
    })

    expect(a.sequenceNo).toBe(1)
    expect(b.sequenceNo).toBe(1)
    // Same amount, same second, different chain — the genesis hash differs, so
    // the entries do too.
    expect(a.entryHash).not.toBe(b.entryHash)
  })

  it('round-trips created_at exactly, so the stored row hashes to its stored hash', async () => {
    const eventId = await newEvent()
    const createdAt = new Date('2026-08-16T12:34:56.789Z')

    await appendEntry(app, {
      chain: { eventId },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(2_500n),
      createdAt,
    })

    const [entry] = await entriesForChain(app, { eventId })

    // TIMESTAMP(3) keeps the milliseconds toISOString() wrote. If it truncated,
    // every row would fail its own hash the moment it was read back.
    expect(entry?.createdAt.toISOString()).toBe('2026-08-16T12:34:56.789Z')
    expect(
      verifyChain(eventId, await entriesForChain(app, { eventId })).problems,
    ).toEqual([])
  })
})

describe('reversal', () => {
  it('is a new entry, opposite in direction, pointing at what it corrects', async () => {
    const eventId = await newEvent()

    const original = await appendEntry(app, {
      chain: { eventId },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(75_000n),
    })

    const reversal = await appendReversal(app, {
      chain: { eventId },
      reversing: original.id,
    })

    const entries = await entriesForChain(app, { eventId })
    const reversed = entries.find((entry) => entry.id === reversal.id)

    expect(entries).toHaveLength(2)
    expect(reversed?.entryType).toBe('reversal')
    expect(reversed?.direction).toBe('debit')
    expect(reversed?.amountCents).toBe(fromCents(75_000n))
    // The id of the entry being reversed, not of the contribution behind it:
    // with more than one correction, that is the only unambiguous record.
    expect(reversed?.referenceId).toBe(original.id)

    // And the original is still exactly where it was.
    expect(entries[0]?.id).toBe(original.id)
    expect(entries[0]?.direction).toBe('credit')
    expect(verifyChain(eventId, entries).problems).toEqual([])
  })

  it('refuses to reverse an entry from another chain', async () => {
    const [one, two] = [await newEvent(), await newEvent()]
    const entry = await appendEntry(app, {
      chain: { eventId: one },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(1_000n),
    })

    await expect(
      appendReversal(app, { chain: { eventId: two }, reversing: entry.id }),
    ).rejects.toThrow(/different chain/)
  })
})

describe('tampering', () => {
  it('is detected when an amount is changed by raw SQL', async () => {
    const eventId = await newEvent()

    for (const cents of [10_000n, 20_000n, 30_000n]) {
      await appendEntry(app, {
        chain: { eventId },
        entryType: 'contribution',
        direction: 'credit',
        amountCents: fromCents(cents),
      })
    }

    expect(
      verifyChain(eventId, await entriesForChain(app, { eventId })).problems,
    ).toEqual([])

    // As the owner, because the application role cannot do this — which is the
    // point. This is what somebody with database access would actually do.
    await owner.$executeRaw`
      UPDATE ledger_entries SET amount_cents = 1
      WHERE event_id = ${eventId} AND sequence_no = 2
    `

    const problems = verifyChain(
      eventId,
      await entriesForChain(app, { eventId }),
    ).problems

    expect(problems).toContainEqual({ kind: 'hash-mismatch', at: 2 })
  })

  it('is detected when the row and its hash are both rewritten', async () => {
    const eventId = await newEvent()

    for (const cents of [10_000n, 20_000n, 30_000n]) {
      await appendEntry(app, {
        chain: { eventId },
        entryType: 'contribution',
        direction: 'credit',
        amountCents: fromCents(cents),
      })
    }

    const entries = await entriesForChain(app, { eventId })
    const target = entries[1]
    if (target === undefined) throw new Error('expected three entries')

    // The careful attacker: change the amount *and* recompute the hash so the
    // row is self-consistent. Entry 3 still points at the old hash.
    const { entryHash } = await import('@/domain/ledger')
    const rewritten = entryHash({ ...target, amountCents: fromCents(1n) })

    await owner.$executeRaw`
      UPDATE ledger_entries SET amount_cents = 1, entry_hash = ${rewritten}
      WHERE id = ${target.id}
    `

    const problems = verifyChain(
      eventId,
      await entriesForChain(app, { eventId }),
    ).problems

    expect(problems).toContainEqual({ kind: 'broken-link', at: 3 })
  })

  it('is detected when an entry is deleted outright', async () => {
    const eventId = await newEvent()

    for (const cents of [10_000n, 20_000n, 30_000n]) {
      await appendEntry(app, {
        chain: { eventId },
        entryType: 'contribution',
        direction: 'credit',
        amountCents: fromCents(cents),
      })
    }

    await owner.$executeRaw`
      DELETE FROM ledger_entries WHERE event_id = ${eventId} AND sequence_no = 2
    `

    const problems = verifyChain(
      eventId,
      await entriesForChain(app, { eventId }),
    ).problems

    expect(problems).toContainEqual({ kind: 'sequence-gap', at: 3, expected: 2 })
    expect(problems).toContainEqual({ kind: 'broken-link', at: 3 })
  })

  it('cannot be done by the application role at all', async () => {
    const eventId = await newEvent()
    const entry = await appendEntry(app, {
      chain: { eventId },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(5_000n),
    })

    // The first line of defence, which is why the tests above need the owner.
    await expect(
      app.$executeRaw`UPDATE ledger_entries SET amount_cents = 1 WHERE id = ${entry.id}`,
    ).rejects.toThrow(/permission denied/i)
  })
})

describe('concurrent appends', () => {
  it('produce no gaps and no duplicates', async () => {
    const eventId = await newEvent()
    const appends = 25

    // All at once, against one chain. Without the advisory lock these read the
    // same max(sequence_no) and collide on the unique index.
    await Promise.all(
      Array.from({ length: appends }, (_unused, index) =>
        appendEntry(app, {
          chain: { eventId },
          entryType: 'contribution',
          direction: 'credit',
          amountCents: fromCents(BigInt(index + 1) * 100n),
        }),
      ),
    )

    const entries = await entriesForChain(app, { eventId })

    expect(entries).toHaveLength(appends)
    expect(entries.map((entry) => entry.sequenceNo)).toEqual(
      Array.from({ length: appends }, (_unused, index) => index + 1),
    )
    expect(verifyChain(eventId, entries).problems).toEqual([])
  })

  it('do not serialise chains against each other', async () => {
    // The lock is per chain. Two events appending at the same time must not
    // wait on one another — a busy Saturday is many funerals at once.
    const [one, two] = [await newEvent(), await newEvent()]

    await Promise.all(
      [one, two].flatMap((eventId) =>
        Array.from({ length: 10 }, () =>
          appendEntry(app, {
            chain: { eventId },
            entryType: 'contribution',
            direction: 'credit',
            amountCents: fromCents(1_000n),
          }),
        ),
      ),
    )

    for (const eventId of [one, two]) {
      const entries = await entriesForChain(app, { eventId })
      expect(entries).toHaveLength(10)
      expect(verifyChain(eventId, entries).problems).toEqual([])
    }
  })
})

describe('finding chains to verify', () => {
  it('lists a chain once it has an entry', async () => {
    const eventId = await newEvent()
    await appendEntry(app, {
      chain: { eventId },
      entryType: 'contribution',
      direction: 'credit',
      amountCents: fromCents(1_000n),
    })

    const chains = await chainsWithEntries(app)

    expect(chains).toContainEqual({ eventId })
  })

  it('does not list an event nobody has contributed to', async () => {
    // Nothing to have been altered. The nightly job asks the ledger what
    // exists, not the events table what might.
    const eventId = await newEvent()

    expect(await chainsWithEntries(app)).not.toContainEqual({ eventId })
  })
})
