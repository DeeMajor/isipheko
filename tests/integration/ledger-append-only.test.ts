import { createHash } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'

import { clientFor } from '../setup/prisma'

/**
 * CLAUDE.md rule 3, at the layer that actually holds it.
 *
 * The ledger is the trust product. The claim being made to users is *"nobody,
 * including us, can quietly change this record"* — and a convention in a
 * repository does not support that claim. A privilege the application role does
 * not have does.
 *
 * So these tests are not about the ORM. They connect as **isipheko_app**, the
 * role the running application uses, and check what Postgres itself refuses.
 * The owner client is used only to arrange fixtures, and its presence in this
 * file is the control: if the owner can do what the app cannot, the difference
 * is the privilege and not a broken connection.
 */

let app: PrismaClient
let owner: PrismaClient
let eventId: string
let ledgerEntryId: string

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))
  owner = clientFor(inject('ownerDatabaseUrl'))

  const organiser = await app.organiser.create({
    data: { phoneE164: '+27820000002', displayName: 'Thandi Ngcobo' },
  })

  const event = await app.event.create({
    data: {
      organiserId: organiser.id,
      slug: 'ledger-test-slug-aaaaaaaaaaaa',
      archetype: 'umngcwabo',
      archetypeGroup: 'bereavement',
      title: 'Umngcwabo',
    },
  })
  eventId = event.id

  const genesisPrevHash = createHash('sha256').update(eventId).digest('hex')
  const entry = await app.ledgerEntry.create({
    data: {
      eventId,
      sequenceNo: 1,
      entryType: 'contribution',
      direction: 'credit',
      amountCents: 200_00n,
      prevHash: genesisPrevHash,
      entryHash: createHash('sha256').update(`1${genesisPrevHash}`).digest('hex'),
    },
  })
  ledgerEntryId = entry.id
})

afterAll(async () => {
  await app.$disconnect()
  await owner.$disconnect()
})

describe('the application role can append', () => {
  it('inserts a ledger entry', async () => {
    const prevHash = createHash('sha256').update(`${eventId}-2`).digest('hex')

    const entry = await app.ledgerEntry.create({
      data: {
        eventId,
        sequenceNo: 2,
        entryType: 'contribution',
        direction: 'credit',
        amountCents: 500_00n,
        prevHash,
        entryHash: createHash('sha256').update(`2${prevHash}`).digest('hex'),
      },
    })

    expect(entry.sequenceNo).toBe(2)
  })

  it('reads entries back', async () => {
    await expect(
      app.ledgerEntry.findUnique({ where: { id: ledgerEntryId } }),
    ).resolves.not.toBeNull()
  })
})

describe('the application role cannot rewrite history', () => {
  // The headline guarantee. Changing an amount after the fact is the single
  // most damaging thing that could happen to this table.
  it('cannot UPDATE a ledger entry', async () => {
    await expect(
      app.ledgerEntry.update({
        where: { id: ledgerEntryId },
        data: { amountCents: 1n },
      }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('cannot UPDATE via raw SQL either — this is Postgres, not the ORM', async () => {
    await expect(
      app.$executeRawUnsafe(
        `UPDATE ledger_entries SET amount_cents = 1 WHERE id = $1`,
        ledgerEntryId,
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('cannot DELETE a ledger entry', async () => {
    await expect(
      app.ledgerEntry.delete({ where: { id: ledgerEntryId } }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('cannot DELETE via raw SQL', async () => {
    await expect(
      app.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE id = $1`, ledgerEntryId),
    ).rejects.toThrow(/permission denied/i)
  })

  it('cannot TRUNCATE the ledger', async () => {
    await expect(
      app.$executeRawUnsafe(`TRUNCATE ledger_entries CASCADE`),
    ).rejects.toThrow(/permission denied|must be owner/i)
  })

  // A rejected write must leave nothing behind. If the row had changed and the
  // error came afterwards, every test above would still pass.
  it('leaves the entry untouched after every refusal', async () => {
    const entry = await app.ledgerEntry.findUniqueOrThrow({
      where: { id: ledgerEntryId },
    })

    expect(entry.amountCents).toBe(200_00n)
  })
})

/**
 * `audit_log` is append-only for the same reason (architecture §4.2). An audit
 * trail an application can edit is not an audit trail.
 */
describe('the audit log is append-only too', () => {
  it('accepts an insert', async () => {
    const entry = await app.auditLog.create({
      data: { actorType: 'system', action: 'test.append' },
    })

    expect(entry.action).toBe('test.append')
  })

  it('refuses an update', async () => {
    const entry = await app.auditLog.create({
      data: { actorType: 'system', action: 'test.immutable' },
    })

    await expect(
      app.auditLog.update({ where: { id: entry.id }, data: { action: 'rewritten' } }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('refuses a delete', async () => {
    const entry = await app.auditLog.create({
      data: { actorType: 'system', action: 'test.undeletable' },
    })

    await expect(app.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /permission denied/i,
    )
  })
})

/**
 * The control. Without these, every assertion above would also pass against a
 * database the application simply could not reach.
 */
describe('the restriction is specific, not a broken connection', () => {
  it('the same role can UPDATE a contribution', async () => {
    const contribution = await app.contribution.create({
      data: {
        eventId,
        contributorName: 'MaDlamini',
        type: 'cash',
        amountCents: 200_00n,
        verificationSource: 'organiser_confirmed',
      },
    })

    const updated = await app.contribution.update({
      where: { id: contribution.id },
      data: { status: 'confirmed' },
    })

    expect(updated.status).toBe('confirmed')
  })

  it('the same role can DELETE a contribution', async () => {
    const contribution = await app.contribution.create({
      data: {
        eventId,
        contributorName: 'Temporary',
        type: 'cash',
        amountCents: 100_00n,
        verificationSource: 'organiser_confirmed',
      },
    })

    await expect(
      app.contribution.delete({ where: { id: contribution.id } }),
    ).resolves.toBeTruthy()
  })

  // The owner can, which is what makes the app role's inability a privilege
  // decision rather than a table-level accident such as a rule or trigger.
  it('the owner role can UPDATE a ledger entry', async () => {
    const updated = await owner.ledgerEntry.update({
      where: { id: ledgerEntryId },
      data: { inKindDescription: 'corrected by the owner in a test' },
    })

    expect(updated.inKindDescription).toBe('corrected by the owner in a test')
  })
})

/**
 * A guarantee that is only true of today's tables rots the first time somebody
 * adds one. The migration grants SELECT and INSERT by default and names the
 * mutable tables explicitly, so a new table arrives append-only.
 */
describe('default privileges do not over-grant', () => {
  it('grants only SELECT and INSERT on a table created later', async () => {
    await owner.$executeRawUnsafe(`CREATE TABLE privilege_probe (id integer primary key)`)

    try {
      const rows = await owner.$queryRawUnsafe<{ privilege_type: string }[]>(
        `SELECT privilege_type FROM information_schema.table_privileges
         WHERE grantee = 'isipheko_app' AND table_name = 'privilege_probe'
         ORDER BY privilege_type`,
      )

      expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT'])
    } finally {
      await owner.$executeRawUnsafe(`DROP TABLE privilege_probe`)
    }
  })
})
