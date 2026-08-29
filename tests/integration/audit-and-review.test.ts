import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { organiserForPhone } from '@/db/repositories/auth'
import { auditForActor, auditForTarget, recordAudit } from '@/db/repositories/audit'
import { createDraft, publishDraft, reconcileNeeds } from '@/db/repositories/event'
import type { PrismaClient } from '@/db/generated/client'
import {
  fileReport,
  reportById,
  reviewQueue,
  triageReport,
} from '@/db/repositories/report'
import { AUDIT_ACTIONS } from '@/domain/audit'

import { clientFor } from '../setup/prisma'

/**
 * M3-07's two halves against a real Postgres: **the log is not mutable by the
 * app role**, and **the review queue is a queue a person can work**.
 *
 * The property that matters more than either is the one carried forward from
 * M3-06 §1 and moved one layer along: a report does nothing to an event by
 * itself, and neither does a person triaging it. That was the obvious next hole
 * — triage *is* the human decision, and letting it write through to the event
 * would be one line — so the event row is read before and after a full
 * received → reviewing → closed pass and compared whole.
 *
 * The immutability of `audit_log` is proved here as Postgres refusing, not as
 * an ORM convention. `ledger-append-only.test.ts` covers the same table from
 * the ledger's side; what is added here is raw SQL and TRUNCATE, because an
 * assertion that only an ORM call is refused says nothing about a migration
 * script or a psql session running as the app.
 */

let app: PrismaClient
let owner: PrismaClient
let organiserId: string

let phoneCounter = 0
const nextPhone = () => `+2786${String(3_000_000 + ++phoneCounter).slice(-7)}`

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))
  owner = clientFor(inject('ownerDatabaseUrl'))

  const organiser = await organiserForPhone(app, nextPhone())
  organiserId = organiser.id

  await app.organiser.update({
    where: { id: organiserId },
    data: {
      displayName: 'Zanele Khumalo',
      idVerificationStatus: 'verified',
      idVerifiedAt: new Date('2026-08-10T00:00:00.000Z'),
    },
  })
})

afterAll(async () => {
  await app.$disconnect()
  await owner.$disconnect()
})

async function publishedEvent(): Promise<{ id: string; slug: string }> {
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umshado',
    title: 'Zanele no Sipho',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  await reconcileNeeds(app, draft.id, [{ id: null, label: 'Tent', note: '' }])
  await app.witness.create({
    data: { eventId: draft.id, name: 'MaDlamini', phoneE164: nextPhone() },
  })
  await publishDraft(app, { id: draft.id, organiserId })

  return draft
}

const BLANK_REPORT = {
  detail: null,
  eventId: null,
  collectionId: null,
  aboutTyped: null,
  reporterPhoneE164: null,
  ipHash: null,
  userAgentHash: null,
}

const BLANK_AUDIT = {
  actorId: null,
  targetType: null,
  targetId: null,
  ipHash: null,
  userAgentHash: null,
  metadata: {},
} as const

describe('the log is append-only, and Postgres is what says so', () => {
  it('accepts an append from the application role', async () => {
    await recordAudit(app, {
      ...BLANK_AUDIT,
      actorType: 'organiser',
      actorId: organiserId,
      action: 'auth.session.started',
      targetType: 'organiser',
      targetId: organiserId,
      now: new Date('2026-08-18T06:00:00.000Z'),
    })

    const rows = await auditForActor(app, {
      actorType: 'organiser',
      actorId: organiserId,
    })
    expect(rows.length).toBeGreaterThan(0)
  })

  it('refuses an UPDATE via raw SQL, not only through the ORM', async () => {
    const row = await app.auditLog.findFirstOrThrow({ where: { actorId: organiserId } })

    await expect(
      app.$executeRawUnsafe(
        `UPDATE audit_log SET action = 'rewritten' WHERE id = $1`,
        row.id,
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('refuses a DELETE via raw SQL', async () => {
    const row = await app.auditLog.findFirstOrThrow({ where: { actorId: organiserId } })

    await expect(
      app.$executeRawUnsafe(`DELETE FROM audit_log WHERE id = $1`, row.id),
    ).rejects.toThrow(/permission denied/i)
  })

  it('refuses a TRUNCATE', async () => {
    await expect(app.$executeRawUnsafe(`TRUNCATE audit_log CASCADE`)).rejects.toThrow(
      /permission denied|must be owner/i,
    )
  })

  it('leaves the row exactly as written after every refusal', async () => {
    const row = await app.auditLog.findFirstOrThrow({ where: { actorId: organiserId } })
    expect(row.action).toBe('auth.session.started')
  })

  it('holds the timestamp the application supplied, not the column default', async () => {
    // CLAUDE.md's rule about timestamps a rule is computed against (M2-08b §6).
    // Retention and every "what happened in the hour before" question read this
    // column, and a suite that cannot simulate a clock is a suite that passes
    // or fails by the hour somebody runs it.
    const rows = await auditForActor(app, {
      actorType: 'organiser',
      actorId: organiserId,
    })
    const seeded = rows.find((row) => row.action === 'auth.session.started')

    expect(seeded?.createdAt).toEqual(new Date('2026-08-18T06:00:00.000Z'))
  })
})

describe('the actor type the domain declares matches the one the database has', () => {
  it('has not drifted apart', async () => {
    // The domain may not import Prisma (rule 6), so the union is declared twice
    // and this is what keeps the two copies honest.
    const rows = await owner.$queryRawUnsafe<{ label: string }[]>(
      `SELECT e.enumlabel AS label FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'actor_type' ORDER BY e.enumsortorder`,
    )

    expect(rows.map((row) => row.label).sort()).toEqual(
      ['admin', 'contributor', 'organiser', 'system', 'witness'].sort(),
    )
  })
})

describe('every action in the taxonomy can actually be written', () => {
  it('inserts one row per action and reads them all back', async () => {
    // A union with a string nobody can store is a union that lies. This writes
    // the whole taxonomy at a fixed instant and reads it back by target.
    const target = await publishedEvent()
    const at = new Date('2026-08-18T07:00:00.000Z')

    for (const action of AUDIT_ACTIONS) {
      await recordAudit(app, {
        ...BLANK_AUDIT,
        actorType: 'system',
        action,
        targetType: 'event',
        targetId: target.id,
        now: at,
      })
    }

    const rows = await auditForTarget(app, {
      targetType: 'event',
      targetId: target.id,
      limit: AUDIT_ACTIONS.length + 10,
    })

    expect(new Set(rows.map((row) => row.action))).toEqual(new Set(AUDIT_ACTIONS))
  })
})

describe('the review queue', () => {
  it('orders by the deadline somebody was promised, not by arrival', async () => {
    /*
     * The promise on the filed screen is a window. Sorting by newest would
     * systematically serve whoever reported most recently and leave the oldest
     * promise the one most likely to be broken.
     */
    const event = await publishedEvent()

    const late = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'never-happened',
      eventId: event.id,
      now: new Date('2026-08-10T09:00:00.000Z'),
    })

    const fresh = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'something-else',
      eventId: event.id,
      now: new Date('2026-08-18T09:00:00.000Z'),
    })

    const queue = (await reviewQueue(app)).rows
    const positions = queue.map((report) => report.id)

    expect(positions.indexOf(late.id)).toBeLessThan(positions.indexOf(fresh.id))
  })

  it('carries what it is about, and says plainly when that is nothing we hold', async () => {
    const filed = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'not-who-they-say',
      aboutTyped: 'isipheko-payments.example/pay/1234',
    })

    const entry = (await reviewQueue(app)).rows.find((report) => report.id === filed.id)

    expect(entry?.eventTitle).toBeNull()
    expect(entry?.collectionTitle).toBeNull()
    expect(entry?.aboutTyped).toContain('isipheko-payments.example')
  })

  it("does not carry the reporter's number", async () => {
    // The number is on the detail screen only, where somebody is about to use
    // it. A list is read at a glance, over a shoulder, and screenshotted
    // (docs/decisions.md M3-07 §5).
    const phone = nextPhone()
    const filed = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'money-not-received',
      reporterPhoneE164: phone,
      aboutTyped: 'a message on WhatsApp',
    })

    const entry = (await reviewQueue(app)).rows.find((report) => report.id === filed.id)

    expect(entry?.reachable).toBe(true)
    expect(JSON.stringify(entry)).not.toContain(phone)

    // And is there where it is needed, because the SLA is unfulfillable without it.
    const detail = await reportById(app, { id: filed.id })
    expect(detail?.reporterPhoneE164).toBe(phone)
  })

  it('reaches every open report, however many there are', async () => {
    /*
     * M3-07b. `reviewQueue` took 100 and the screen said nothing about it, so a
     * reviewer who scrolled to the bottom of a silently capped list believed
     * they had seen everything — **the one-working-day SLA failing invisibly,
     * on the screen built to guarantee it**. The reports that fell off were the
     * newest ones, whose deadlines had not yet arrived and which therefore had
     * the most time left to save.
     *
     * Found by two E2E tests failing against a local database that had
     * accumulated 108 open reports. In production the cap is real and the
     * failure mode is a person, not a test.
     */
    const filed = new Set<string>()

    for (let index = 0; index < 120; index += 1) {
      const report = await fileReport(app, {
        ...BLANK_REPORT,
        reason: 'something-else',
        aboutTyped: `pagination fixture ${String(index)}`,
        now: new Date('2026-08-18T09:00:00.000Z'),
      })
      filed.add(report.id)
    }

    const seen = new Set<string>()
    let offset = 0
    let total = 0

    // Walk it the way the screen does — one page, then the next.
    for (let guard = 0; guard < 20; guard += 1) {
      const page = await reviewQueue(app, { offset })

      total = page.total
      for (const report of page.rows) seen.add(report.id)

      offset = page.offset + page.limit
      if (offset >= page.total) break
    }

    expect(total).toBeGreaterThanOrEqual(120)
    for (const id of filed) {
      expect(seen, 'a filed report was unreachable by paging').toContain(id)
    }
  })

  it('says how many there are, not only how many fit', async () => {
    // The count is of every open report, so a screen can state the whole rather
    // than the page. Without it, "50 shown" is indistinguishable from "50 exist".
    const page = await reviewQueue(app, { limit: 5 })

    expect(page.rows.length).toBeLessThanOrEqual(5)
    expect(page.total).toBeGreaterThan(page.rows.length)
  })

  it('pages on a total order, so no report lands on two pages or none', async () => {
    /*
     * `respondBy` alone ties: the SLA is measured in working days, so every
     * report filed in the same window shares a deadline and ties are the common
     * case rather than the edge. Two rows that compare equal can come back in
     * either order from two queries, and under skip/take that is a report shown
     * twice or not at all — which on this screen means one somebody never reads.
     */
    const first = await reviewQueue(app, { limit: 40, offset: 0 })
    const second = await reviewQueue(app, { limit: 40, offset: 40 })

    const overlap = first.rows.filter((row) =>
      second.rows.some((other) => other.id === row.id),
    )

    expect(overlap).toHaveLength(0)

    // And the same query twice gives the same page, which is what makes the
    // boundary between them mean anything.
    const again = await reviewQueue(app, { limit: 40, offset: 0 })
    expect(again.rows.map((row) => row.id)).toEqual(first.rows.map((row) => row.id))
  })

  it('drops a report once it is decided', async () => {
    const filed = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'something-else',
      aboutTyped: 'nothing in particular',
    })

    await triageReport(app, { id: filed.id, from: 'received', to: 'closed' })

    expect((await reviewQueue(app)).rows.map((report) => report.id)).not.toContain(
      filed.id,
    )
  })
})

describe('triage', () => {
  it('records the decision and when it was taken', async () => {
    const filed = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'asked-for-a-code',
      aboutTyped: 'somebody phoned me',
    })

    const closedAt = new Date('2026-08-19T10:00:00.000Z')

    expect(
      await triageReport(app, { id: filed.id, from: 'received', to: 'reviewing' }),
    ).toEqual({
      ok: true,
      from: 'received',
      to: 'reviewing',
    })

    expect(
      await triageReport(app, {
        id: filed.id,
        from: 'reviewing',
        to: 'closed',
        now: closedAt,
      }),
    ).toEqual({ ok: true, from: 'reviewing', to: 'closed' })

    const row = await app.report.findUniqueOrThrow({ where: { id: filed.id } })
    expect(row.status).toBe('closed')
    expect(row.closedAt).toEqual(closedAt)
  })

  it('refuses to walk a report backwards', async () => {
    const filed = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'something-else',
      aboutTyped: 'x',
    })

    await triageReport(app, { id: filed.id, from: 'received', to: 'closed' })

    expect(
      await triageReport(app, { id: filed.id, from: 'closed', to: 'received' }),
    ).toEqual({
      ok: false,
      reason: 'not-a-transition',
    })

    const row = await app.report.findUniqueOrThrow({ where: { id: filed.id } })
    expect(row.status).toBe('closed')
  })

  it('lets one of two reviewers win, and tells the other honestly', async () => {
    // The condition is on the UPDATE as well as in the domain, the same shape
    // as publishing (M3-02 §1): the row was read a moment ago and somebody else
    // may have moved it since.
    const filed = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'never-happened',
      aboutTyped: 'y',
    })

    const [first, second] = await Promise.all([
      triageReport(app, { id: filed.id, from: 'received', to: 'closed' }),
      triageReport(app, { id: filed.id, from: 'received', to: 'closed' }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect([first, second].find((outcome) => !outcome.ok)).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('cannot make a report disappear', async () => {
    const filed = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'something-else',
      aboutTyped: 'z',
    })

    await expect(app.report.delete({ where: { id: filed.id } })).rejects.toThrow(
      /permission denied/i,
    )
  })
})

describe('triage changes nothing about the event', () => {
  it('leaves it byte-identical across a full received → reviewing → closed pass', async () => {
    /*
     * **The standing rule, one layer along** (docs/decisions.md M3-06 §1 and
     * M3-07 §4). M3-06 proved that filing five reports leaves an event
     * untouched. This is the hole that opens next: triage is the human decision
     * the rule reserves for a person, and it is exactly where somebody would
     * later add "and unpublish it if the reviewer closes it as fraud".
     *
     * If that is ever wanted it needs its own action, its own audit row and its
     * own screen — not a side effect of a status column.
     */
    const event = await publishedEvent()
    const before = await app.event.findUniqueOrThrow({ where: { id: event.id } })

    const filed = await fileReport(app, {
      ...BLANK_REPORT,
      reason: 'not-who-they-say',
      eventId: event.id,
      detail: 'this family is not who they say they are',
    })

    await triageReport(app, { id: filed.id, from: 'received', to: 'reviewing' })
    await triageReport(app, { id: filed.id, from: 'reviewing', to: 'closed' })

    const after = await app.event.findUniqueOrThrow({ where: { id: event.id } })

    expect(after).toEqual(before)
    expect(after.status).toBe('published')
  })

  it('leaves the page live even when five reports are all closed as real', async () => {
    // No threshold, in either direction. A count that did something would be a
    // count somebody could manufacture, and the reporter is anonymous by design.
    const event = await publishedEvent()
    const before = await app.event.findUniqueOrThrow({ where: { id: event.id } })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const filed = await fileReport(app, {
        ...BLANK_REPORT,
        reason: 'never-happened',
        eventId: event.id,
      })
      await triageReport(app, { id: filed.id, from: 'received', to: 'closed' })
    }

    expect(await app.event.findUniqueOrThrow({ where: { id: event.id } })).toEqual(before)
  })
})

describe('the trail a reviewer reads', () => {
  it('gathers what happened to one umcimbi, most recent first', async () => {
    const event = await publishedEvent()

    await recordAudit(app, {
      ...BLANK_AUDIT,
      actorType: 'organiser',
      actorId: organiserId,
      action: 'event.published',
      targetType: 'event',
      targetId: event.id,
      now: new Date('2026-08-18T08:00:00.000Z'),
    })

    await recordAudit(app, {
      ...BLANK_AUDIT,
      actorType: 'organiser',
      actorId: organiserId,
      action: 'contribution.confirmed',
      targetType: 'event',
      targetId: event.id,
      now: new Date('2026-08-18T09:00:00.000Z'),
    })

    const trail = await auditForTarget(app, { targetType: 'event', targetId: event.id })

    expect(trail[0]?.action).toBe('contribution.confirmed')
    expect(trail[1]?.action).toBe('event.published')
  })
})
