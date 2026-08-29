import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

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
    /*
     * **Widened at M5-12, before the temptation exists.** M5-02 built a hosted
     * checkout on event pages, so the obvious next idea is a beneficiary on a
     * collection so members can pay there too.
     *
     * That is precisely us collecting money for on-payment to a third person —
     * the activity docs/paystack-analysis.md §0.2 is asking a lawyer about — and
     * it would put a private individual inside the card-scheme aggregation
     * clause in §1.8, which is the clause that ruled PayFast out. It has to be
     * refused by a failing test before somebody has the idea, not after.
     */
    const forbidden =
      /payout|float|disburse|settle|escrow|balance|wallet|ledger_account|subaccount|paystack|payfast|split_code|beneficiary|merchant|checkout|psp/i

    expect(
      (await columnsOf('collections')).filter((column) => forbidden.test(column)),
    ).toEqual([])
  })

  it('catches the column it exists to catch, proved by adding one', async () => {
    /*
     * A tripwire nobody has seen trip is a tripwire nobody knows is connected.
     * M2-09 §7 verified the original the same way — by adding the forbidden
     * thing and watching the test fail — and that verification was a note in a
     * decisions entry rather than something the suite does.
     *
     * It does it here. Each name is added to `collections`, the filter is run,
     * and the column is dropped again. Every one of them must be caught: these
     * are the names a migration would plausibly use on the day somebody gives a
     * collection organiser a beneficiary so members can pay on her page.
     */
    const forbidden =
      /payout|float|disburse|settle|escrow|balance|wallet|ledger_account|subaccount|paystack|payfast|split_code|beneficiary|merchant|checkout|psp/i

    for (const column of [
      'subaccount_code',
      'beneficiary_reference',
      'paystack_split_code',
      'payout_account_id',
      'held_balance_cents',
      'checkout_url',
    ]) {
      await owner.$executeRawUnsafe(`ALTER TABLE collections ADD COLUMN "${column}" text`)

      try {
        expect(
          (await columnsOf('collections')).filter((name) => forbidden.test(name)),
          `${column} was added to collections and the tripwire did not fire`,
        ).toEqual([column])
      } finally {
        await owner.$executeRawUnsafe(`ALTER TABLE collections DROP COLUMN "${column}"`)
      }
    }

    // And the table is exactly as it was.
    expect(
      (await columnsOf('collections')).filter((name) => forbidden.test(name)),
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
         AND (column_name LIKE '%payout%' OR column_name LIKE '%disburse%'
              OR column_name LIKE '%subaccount%' OR column_name LIKE '%beneficiary%'
              OR column_name LIKE '%split_code%')`,
    )

    expect(rows).toEqual([])
  })

  it('there is no table whose name suggests a float or settlement account', async () => {
    const rows = await owner.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND (table_name LIKE '%float%' OR table_name LIKE '%escrow%'
              OR table_name LIKE '%settlement%' OR table_name LIKE '%wallet%'
              OR table_name LIKE '%subaccount%' OR table_name LIKE '%beneficiar%')`,
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

/**
 * M2-09 added the code that creates, joins, claims for and hands over a
 * collection. The absence has to survive that, and it has to survive it in the
 * source as well as in the schema: a repository function called
 * `payOutCollection` would pass every structural check above while being
 * exactly the thing rule 12 forbids.
 */
describe('the code that works with collections has no money path either', () => {
  const sources = [
    'src/domain/collection/collection.ts',
    'src/db/repositories/collection.ts',
    'src/copy/collection.ts',
  ]

  it('names no payout, float, disbursement or balance', () => {
    /*
     * Widened at M5-12 alongside the column pattern. `createCollectionSubaccount`
     * would pass every structural check in this file while being exactly the
     * thing rule 12 forbids — and it is a plausible-sounding function to write
     * on the day somebody asks why a card works on an event page and not here.
     *
     * A provider's name is in the list for the same reason rule 10 keeps one out
     * of `src/domain/`: the first appearance of `paystack` in a collection file
     * is the moment this stopped being true.
     */
    const forbidden =
      /payout|float|disburse|escrow|wallet|settle|subaccount|paystack|payfast|split_?code|beneficiary|checkout/i

    for (const path of sources) {
      const text = readFileSync(root(path), 'utf8')
      // Comments say why there is no payout; the code must not reach for one.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

      expect(code, path).not.toMatch(forbidden)
    }
  })

  it('never reads or writes a bank account', () => {
    for (const path of sources) {
      const text = readFileSync(root(path), 'utf8')

      expect(text, path).not.toContain('bankAccount')
      expect(text, path).not.toContain('accountNumber')
    }
  })

  it('keeps the hint free text in code as well as in the column', () => {
    // "Nomsa's Capitec, ending 4471" is where members send money. Free text is
    // the constraint, not a limitation: the moment it becomes an account we can
    // verify or pay into, rule 12 is gone and the regulatory position goes with
    // it (architecture §0.2, Part D2.2).
    const repository = readFileSync(root('src/db/repositories/collection.ts'), 'utf8')

    expect(repository).toContain('organiserBankHint')
    expect(repository).not.toMatch(
      /verifyBankAccount|createDisbursement|createBeneficiary|requestWithdrawal|balanceFor/,
    )
  })

  it('no collection file reaches for the payment provider at all', () => {
    /*
     * The seam, rather than a vocabulary. M5-01 put every payment verb behind
     * `PaymentProvider` and `HeldBalanceProvider`, so an import of either from
     * anything that works with collections is the whole of rule 12 going,
     * whatever the function is called.
     *
     * Checked as an import so a creative name cannot get past the word list
     * above.
     */
    for (const path of [...sources, 'src/app/(organiser)/collections/actions.ts']) {
      const text = readFileSync(root(path), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')

      expect(text, path).not.toMatch(/from '@\/(domain|adapters)\/payments/)
      expect(text, path).not.toMatch(/from '@\/lib\/payments'/)
      expect(text, path).not.toMatch(/HeldBalanceProvider|PaymentProvider/)
    }
  })
})
