import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'

import { clientFor } from '../setup/prisma'

/**
 * CLAUDE.md rule 12 and Part H invariant 11: **a collection has no payout, no
 * float and no disbursement. There is no money path through us.**
 *
 * The collection organiser holds the money in her own account. She is a private
 * person collecting from friends, which is not regulated activity for her, and
 * we are a ledger. The moment a schema gives us somewhere to hold or route that
 * money, that stops being true — and it would stop being true quietly, in a
 * migration, months before anyone noticed.
 *
 * So this file asserts an **absence**, structurally, against the live schema
 * rather than against the Prisma models. A future migration that adds the column
 * fails here even if nobody remembers this rule exists. That is the entire point:
 * the test is a tripwire for a task that has not been written yet.
 */

let owner: PrismaClient
let app: PrismaClient

beforeAll(() => {
  owner = clientFor(inject('ownerDatabaseUrl'))
  app = clientFor(inject('appDatabaseUrl'))
})

afterAll(async () => {
  await owner.$disconnect()
  await app.$disconnect()
})

async function columnsOf(table: string): Promise<string[]> {
  const rows = await owner.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    table,
  )
  return rows.map((row) => row.column_name)
}

describe('the collections table has no money path', () => {
  // Deliberately a pattern match rather than a fixed list. A column called
  // `float_balance`, `disbursement_id` or `payout_account` should fail this test
  // on the day it is written, whatever it is named.
  it('has no column suggesting a balance, payout, float or disbursement', async () => {
    const forbidden = /payout|float|disburse|settle|escrow|balance|wallet|ledger_account/i

    expect(
      (await columnsOf('collections')).filter((column) => forbidden.test(column)),
    ).toEqual([])
  })

  it('has no foreign key to bank_accounts', async () => {
    const rows = await owner.$queryRawUnsafe<{ foreign_table: string }[]>(
      `SELECT ccu.table_name AS foreign_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_name = 'collections' AND tc.constraint_type = 'FOREIGN KEY'`,
    )

    expect(rows.map((row) => row.foreign_table)).not.toContain('bank_accounts')
  })

  // `organiser_bank_hint` is display text — "Nomsa's Capitec, ending 4471" — so
  // members know where to send money. It must never become an account we hold,
  // verify or pay into, which is why it is free text and not a relation.
  it('keeps the bank hint as free text, never a bank account relation', async () => {
    const rows = await owner.$queryRawUnsafe<{ data_type: string }[]>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'collections'
         AND column_name = 'organiser_bank_hint'`,
    )

    expect(rows[0]?.data_type).toBe('text')
  })
})

describe('no other table routes money to a collection', () => {
  it('payouts has no reference to a collection', async () => {
    expect((await columnsOf('payouts')).filter((c) => c.includes('collection'))).toEqual(
      [],
    )
  })

  it('bank_accounts has no reference to a collection', async () => {
    expect(
      (await columnsOf('bank_accounts')).filter((c) => c.includes('collection')),
    ).toEqual([])
  })

  it('nothing anywhere in the schema has both a collection and a payout reference', async () => {
    const rows = await owner.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name LIKE '%collection%'
       INTERSECT
       SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (column_name LIKE '%payout%' OR column_name LIKE '%disburse%')`,
    )

    expect(rows).toEqual([])
  })

  it('there is no table whose name suggests a float or settlement account', async () => {
    const rows = await owner.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND (table_name LIKE '%float%' OR table_name LIKE '%escrow%'
              OR table_name LIKE '%settlement%' OR table_name LIKE '%wallet%')`,
    )

    expect(rows).toEqual([])
  })
})

/**
 * Rule 14: on the host's event page a collection appears as a single group bead
 * — *"The Ngcobo cousins — R5 000"* — opening to reveal members. One entry, not
 * one per member. Eight beads would read as eight small gifts instead of one act
 * by one group.
 */
describe('a collection is one ledger entry, never one per member', () => {
  it('the ledger can record a collection directly, without a row per member', async () => {
    const organiser = await app.organiser.create({
      data: { phoneE164: '+27820000003', displayName: 'Nomsa Mthembu' },
    })

    const collection = await app.collection.create({
      data: {
        organiserId: organiser.id,
        occasionArchetype: 'umngcwabo',
        occasionArchetypeGroup: 'bereavement',
        title: 'The Ngcobo cousins',
        members: {
          create: Array.from({ length: 8 }, (_, index) => ({
            name: `Member ${String(index + 1)}`,
            amountCents: 625_00n,
          })),
        },
      },
      include: { members: true },
    })

    expect(collection.members).toHaveLength(8)

    await app.ledgerEntry.create({
      data: {
        collectionId: collection.id,
        sequenceNo: 1,
        entryType: 'collection',
        direction: 'credit',
        amountCents: 5000_00n,
        prevHash: 'genesis',
        entryHash: `collection-entry-${collection.id}`,
      },
    })

    const entries = await app.ledgerEntry.findMany({
      where: { collectionId: collection.id },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.amountCents).toBe(5000_00n)
  })

  it('collection_members cannot reach the ledger directly', async () => {
    const forbidden = /ledger|payout|disburse/i

    expect(
      (await columnsOf('collection_members')).filter((column) => forbidden.test(column)),
    ).toEqual([])
  })
})

/**
 * Rule 13: on collections, verification gates *sharing*, not payout. We never
 * hold the money, so there is no payout to withhold — the absence of a shareable
 * link is the only leverage that exists. A collection therefore starts with no
 * slug at all.
 */
describe('verification gates sharing', () => {
  it('a collection can exist with no shareable slug', async () => {
    const organiser = await app.organiser.create({
      data: { phoneE164: '+27820000004', displayName: 'Unverified Organiser' },
    })

    const collection = await app.collection.create({
      data: {
        organiserId: organiser.id,
        occasionArchetype: 'umshado',
        occasionArchetypeGroup: 'union',
        title: 'The office collection',
      },
    })

    expect(collection.slug).toBeNull()
  })

  it('two collections cannot share a slug once they have one', async () => {
    const organiser = await app.organiser.create({
      data: { phoneE164: '+27820000005', displayName: 'Verified Organiser' },
    })

    await app.collection.create({
      data: {
        organiserId: organiser.id,
        occasionArchetype: 'umshado',
        occasionArchetypeGroup: 'union',
        title: 'First',
        slug: 'shared-slug-aaaaaaaaaaaaaaaa',
      },
    })

    await expect(
      app.collection.create({
        data: {
          organiserId: organiser.id,
          occasionArchetype: 'umshado',
          occasionArchetypeGroup: 'union',
          title: 'Second',
          slug: 'shared-slug-aaaaaaaaaaaaaaaa',
        },
      }),
    ).rejects.toThrow()
  })
})
