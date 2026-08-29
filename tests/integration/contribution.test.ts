import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import {
  CONTRIBUTION_EXPIRY_MS,
  MAX_REPORTS_PER_ADDRESS_PER_HOUR,
  MAX_REPORTS_PER_PHONE_PER_HOUR,
  checkReportRateLimit,
  confirmContribution,
  expireStaleContributions,
  pendingReports,
  selfReport,
  startContribution,
} from '@/db/repositories/contribution'
import { createDraft } from '@/db/repositories/event'
import { appendEntry, entriesForChain } from '@/db/repositories/ledger'
import { verifyChain } from '@/domain/ledger'
import { fromCents } from '@/domain/money'

import { clientFor } from '../setup/prisma'

/**
 * Mode A end to end at the data layer: somebody says they paid, the organiser
 * says it arrived, and the ledger says so permanently.
 */

let app: PrismaClient
let organiserId: string
let counter = 0

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(
    app,
    `+2786${String(++counter).padStart(7, '0')}`,
  )
  organiserId = organiser.id
})

afterAll(async () => {
  await app.$disconnect()
})

async function newEvent(): Promise<{ id: string; title: string }> {
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  return { id: draft.id, title: 'Nokuthula Mthembu' }
}

async function start(
  eventId: string,
  title: string,
  overrides: Partial<{ phone: string }> = {},
) {
  return startContribution(app, {
    eventId,
    eventTitle: title,
    type: 'cash',
    amountCents: fromCents(50_000n),
    contributorName: 'Thandi Ngcobo',
    contributorPhoneE164: overrides.phone ?? null,
    visibility: 'name_only',
    reportedIpHash: null,
  })
}

describe('the row created at the pay step', () => {
  it('carries a reference and is pending, not reported', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)

    const row = await app.contribution.findUniqueOrThrow({ where: { id: started.id } })

    expect(row.status).toBe('pending')
    expect(row.refCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/)
    // The distinction the organiser's queue depends on.
    expect(row.selfReportedAt).toBeNull()
  })

  it('does not appear in the organiser’s queue until somebody says they paid', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)

    expect(await pendingReports(app, { eventId: event.id, organiserId })).toEqual([])

    expect(await selfReport(app, { contributionId: started.id })).toBe(true)

    const queue = await pendingReports(app, { eventId: event.id, organiserId })
    expect(queue.map((report) => report.id)).toEqual([started.id])
  })

  it('reports once, however many times the button is pressed', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)

    expect(await selfReport(app, { contributionId: started.id })).toBe(true)
    expect(await selfReport(app, { contributionId: started.id })).toBe(false)
  })
})

describe('confirmation', () => {
  it('writes the ledger entry, and the chain verifies', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)
    await selfReport(app, { contributionId: started.id })

    const outcome = await confirmContribution(app, {
      contributionId: started.id,
      organiserId,
    })

    expect(outcome.ok).toBe(true)

    const row = await app.contribution.findUniqueOrThrow({ where: { id: started.id } })
    expect(row.status).toBe('confirmed')
    expect(row.confirmedAt).not.toBeNull()

    const entries = await entriesForChain(app, { eventId: event.id })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entryType).toBe('contribution')
    expect(entries[0]?.direction).toBe('credit')
    expect(entries[0]?.amountCents).toBe(fromCents(50_000n))
    expect(entries[0]?.contributionId).toBe(started.id)

    expect(verifyChain(event.id, entries).problems).toEqual([])
  })

  it('rolls the status back when the append fails', async () => {
    /*
     * **The invariant the doc comment claims, proved rather than asserted.**
     *
     * Until M5-03 the `updateMany` committed on its own and the append ran
     * after it in a second transaction, so a failure between the two left a
     * confirmed contribution with nothing on the record — the exact lie the
     * comment on `confirmContribution` forbids.
     *
     * The failure here is a **real** database error, not a mock: one ledger
     * entry per contribution is a unique constraint, so an entry already
     * pointing at this row makes the append fail the way a crash would. The
     * ledger, the chain and the transaction are all the real ones (Part H).
     */
    const event = await newEvent()
    const started = await start(event.id, event.title)
    await selfReport(app, { contributionId: started.id })

    // Somebody else's entry, already pointing at this contribution.
    await appendEntry(app, {
      chain: { eventId: event.id },
      entryType: 'adjustment',
      direction: 'credit',
      amountCents: fromCents(100n),
      contributionId: started.id,
      createdAt: new Date('2026-08-01T09:00:00.000Z'),
    })

    await expect(
      confirmContribution(app, { contributionId: started.id, organiserId }),
    ).rejects.toThrow()

    // The status change went back with it. Without the transaction this row
    // reads `confirmed` and the chain holds nothing for it.
    const row = await app.contribution.findUniqueOrThrow({ where: { id: started.id } })
    expect(row.status).toBe('pending')
    expect(row.confirmedAt).toBeNull()

    // And the chain is untouched apart from the entry the test planted.
    const entries = await entriesForChain(app, { eventId: event.id })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entryType).toBe('adjustment')
    expect(verifyChain(event.id, entries).problems).toEqual([])
  })

  it('confirms once, so two taps do not write two entries', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)
    await selfReport(app, { contributionId: started.id })

    const [first, second] = await Promise.all([
      confirmContribution(app, { contributionId: started.id, organiserId }),
      confirmContribution(app, { contributionId: started.id, organiserId }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect(await entriesForChain(app, { eventId: event.id })).toHaveLength(1)
  })

  it('cannot be done by another organiser', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)
    await selfReport(app, { contributionId: started.id })

    const stranger = await organiserForPhone(
      app,
      `+2786${String(++counter).padStart(7, '0')}`,
    )

    expect(
      await confirmContribution(app, {
        contributionId: started.id,
        organiserId: stranger.id,
      }),
    ).toEqual({ ok: false, reason: 'not-yours' })

    expect(await entriesForChain(app, { eventId: event.id })).toHaveLength(0)
  })

  it('leaves no ledger entry when it refuses', async () => {
    // A confirmed contribution with no entry, or an entry with no confirmation,
    // would each be a different kind of lie about the record.
    const event = await newEvent()
    const started = await start(event.id, event.title)

    await confirmContribution(app, { contributionId: started.id, organiserId })
    await app.contribution.updateMany({
      where: { id: started.id },
      data: { status: 'void' },
    })

    const second = await confirmContribution(app, {
      contributionId: started.id,
      organiserId,
    })

    expect(second).toEqual({ ok: false, reason: 'not-pending' })
  })
})

describe('the limits', () => {
  it('stops a phone reporting more than five times an hour', async () => {
    const event = await newEvent()
    const phone = `+2782${String(1_000_000 + ++counter).slice(-7)}`

    for (let index = 0; index < MAX_REPORTS_PER_PHONE_PER_HOUR; index += 1) {
      expect(await checkReportRateLimit(app, { phoneE164: phone, ipHash: null })).toEqual(
        { allowed: true },
      )

      await start(event.id, event.title, { phone })
    }

    expect(await checkReportRateLimit(app, { phoneE164: phone, ipHash: null })).toEqual({
      allowed: false,
      reason: 'phone',
    })
  })

  it('stops an address at twenty, and counts it separately from the phone', async () => {
    const event = await newEvent()
    const ipHash = `ip-${String(++counter)}`

    for (let index = 0; index < MAX_REPORTS_PER_ADDRESS_PER_HOUR; index += 1) {
      await startContribution(app, {
        eventId: event.id,
        eventTitle: event.title,
        type: 'cash',
        amountCents: fromCents(1_000n),
        contributorName: 'Somebody',
        visibility: 'name_only',
        reportedIpHash: ipHash,
      })
    }

    expect(await checkReportRateLimit(app, { phoneE164: null, ipHash })).toEqual({
      allowed: false,
      reason: 'address',
    })

    // A different address is unaffected.
    expect(
      await checkReportRateLimit(app, {
        phoneE164: null,
        ipHash: `other-${String(counter)}`,
      }),
    ).toEqual({ allowed: true })
  })

  it('applies no address limit when there is no address to count', async () => {
    // A direct hit with no proxy headers. The flow still works; the limit
    // simply cannot apply, and pretending otherwise would lock out anybody
    // whose proxy stripped the header.
    expect(await checkReportRateLimit(app, { phoneE164: null, ipHash: null })).toEqual({
      allowed: true,
    })
  })
})

describe('the fourteen days', () => {
  it('voids an unconfirmed contribution, and does not delete it', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)
    await selfReport(app, { contributionId: started.id })

    await app.contribution.updateMany({
      where: { id: started.id },
      data: { createdAt: new Date(Date.now() - CONTRIBUTION_EXPIRY_MS - 60_000) },
    })

    expect(await expireStaleContributions(app)).toBeGreaterThanOrEqual(1)

    const row = await app.contribution.findUniqueOrThrow({ where: { id: started.id } })
    // Something that happened stays in the record with what happened to it —
    // the same reason a disputed contribution is not made to disappear.
    expect(row.status).toBe('void')
  })

  it('leaves a recent one alone', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)

    await expireStaleContributions(app)

    const row = await app.contribution.findUniqueOrThrow({ where: { id: started.id } })
    expect(row.status).toBe('pending')
  })

  it('does not touch one that was already confirmed', async () => {
    const event = await newEvent()
    const started = await start(event.id, event.title)
    await selfReport(app, { contributionId: started.id })
    await confirmContribution(app, { contributionId: started.id, organiserId })

    await app.contribution.updateMany({
      where: { id: started.id },
      data: { createdAt: new Date(Date.now() - CONTRIBUTION_EXPIRY_MS - 60_000) },
    })

    await expireStaleContributions(app)

    const row = await app.contribution.findUniqueOrThrow({ where: { id: started.id } })
    expect(row.status).toBe('confirmed')
  })
})
