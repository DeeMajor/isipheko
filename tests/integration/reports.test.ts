import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import { createDraft, publishDraft, reconcileNeeds } from '@/db/repositories/event'
import { enqueueNotification } from '@/db/repositories/notifications'
import {
  fileReport,
  markAcknowledged,
  queueReport,
  reportsFromAddress,
  withinReportLimit,
} from '@/db/repositories/report'
import { respondBy } from '@/domain/report'

import { clientFor } from '../setup/prisma'

/**
 * The report channel against a real Postgres (M3-06).
 *
 * The done-criterion is two halves — **a reviewable record** and **an
 * acknowledgement** — and one property that matters more than either:
 *
 * **A report changes nothing about the event it names.** That is asserted by
 * reading the event back afterwards, because it is the thing somebody will
 * eventually be asked to "improve" by making it automatic, and the day they do,
 * the form becomes a way to change a page under a family who are burying
 * somebody.
 */

let prisma: PrismaClient
let organiserId: string

let phoneCounter = 0
const nextPhone = () => `+2787${String(2_000_000 + ++phoneCounter).slice(-7)}`

beforeAll(async () => {
  prisma = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(prisma, nextPhone())
  organiserId = organiser.id

  await prisma.organiser.update({
    where: { id: organiserId },
    data: {
      displayName: 'Nomsa Mthembu',
      idVerificationStatus: 'verified',
      idVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
    },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function publishedEvent(): Promise<{ id: string; slug: string }> {
  const draft = await createDraft(prisma, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  await reconcileNeeds(prisma, draft.id, [
    { id: null, label: 'Tent', note: 'Around R1 200' },
  ])
  await prisma.witness.create({
    data: { eventId: draft.id, name: 'Thandi', phoneE164: nextPhone() },
  })
  await publishDraft(prisma, { id: draft.id, organiserId })

  return draft
}

const BLANK = {
  detail: null,
  eventId: null,
  collectionId: null,
  aboutTyped: null,
  reporterPhoneE164: null,
  ipHash: null,
  userAgentHash: null,
}

describe('the record', () => {
  it('is created with a reference and a deadline', async () => {
    const event = await publishedEvent()
    const now = new Date('2026-08-18T09:00:00.000Z')

    const filed = await fileReport(prisma, {
      ...BLANK,
      reason: 'not-who-they-say',
      eventId: event.id,
      detail: 'The name on the page is not the family I know.',
      now,
    })

    expect(filed.reference).toMatch(/^REP-[0-9A-Z]{6}$/)
    expect(filed.respondBy).toEqual(respondBy(now))
    expect(filed.reachable).toBe(false)

    const row = await prisma.report.findUniqueOrThrow({ where: { id: filed.id } })
    expect(row.status).toBe('received')
    expect(row.reason).toBe('not_who_they_say')
    expect(row.eventId).toBe(event.id)
    expect(row.acknowledgedAt).toBeNull()
  })

  it('takes a report about nothing we hold', async () => {
    // The most valuable one: a link that resolves to nothing is the scam case.
    const filed = await fileReport(prisma, {
      ...BLANK,
      reason: 'never-happened',
      aboutTyped: 'isipheko-funerals.example/e/whatever',
    })

    const row = await prisma.report.findUniqueOrThrow({ where: { id: filed.id } })
    expect(row.eventId).toBeNull()
    expect(row.collectionId).toBeNull()
    expect(row.aboutTyped).toContain('isipheko-funerals.example')
  })

  it('draws another reference when one is taken', async () => {
    // A real collision is a one-in-a-billion draw, so the retry is exercised by
    // forcing it (M2-02 §2) rather than by waiting for one.
    const taken = 'ZZZZZZ'
    await fileReport(prisma, {
      ...BLANK,
      reason: 'something-else',
      detail: 'first',
      generate: () => taken,
    })

    const codes = [taken, taken, 'ABCDEF']
    let call = 0

    const second = await fileReport(prisma, {
      ...BLANK,
      reason: 'something-else',
      detail: 'second',
      generate: () => codes[call++] ?? 'ABCDEF',
    })

    expect(second.reference).toBe('REP-ABCDEF')
  })

  it('cannot be deleted by the application role', async () => {
    // A report is evidence. The one thing that must not be possible is one
    // quietly disappearing.
    const filed = await fileReport(prisma, {
      ...BLANK,
      reason: 'something-else',
      detail: 'x',
    })

    await expect(prisma.report.delete({ where: { id: filed.id } })).rejects.toThrow(
      /permission denied/i,
    )
  })

  it('survives the page it was about being removed', async () => {
    const event = await publishedEvent()
    const filed = await fileReport(prisma, {
      ...BLANK,
      reason: 'never-happened',
      eventId: event.id,
    })

    await prisma.event.delete({ where: { id: event.id } })

    const row = await prisma.report.findUniqueOrThrow({ where: { id: filed.id } })
    expect(row.eventId).toBeNull()
    expect(row.reason).toBe('never_happened')
  })
})

describe('a report changes nothing about the event', () => {
  it('leaves it published, unflagged and identical', async () => {
    // The standing rule (docs/decisions.md M3-06 §1). Five reports on a funeral
    // must not change the page under a family who are burying somebody.
    const event = await publishedEvent()
    const before = await prisma.event.findUniqueOrThrow({ where: { id: event.id } })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fileReport(prisma, {
        ...BLANK,
        reason: 'never-happened',
        eventId: event.id,
        detail: 'this is not real',
      })
    }

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } })

    expect(after).toEqual(before)
    expect(after.status).toBe('published')
  })
})

describe('the acknowledgement', () => {
  it('goes into the outbox, where it queues rather than sends', async () => {
    // Correct: no BSP exists (Part J item 3), the outbox is the durable record,
    // and nothing is lost by the refusal (M2-08 §12).
    const phone = nextPhone()
    const filed = await fileReport(prisma, {
      ...BLANK,
      reason: 'asked-for-a-code',
      reporterPhoneE164: phone,
    })

    expect(filed.reachable).toBe(true)

    const enqueued = await enqueueNotification(prisma, {
      kind: 'report_received',
      templateId: 'reporter_report_received',
      params: { reference: filed.reference, respondBy: '19 August' },
      recipient: { phoneE164: phone },
    })

    expect(enqueued?.channel).toBe('whatsapp')

    const row = await prisma.notification.findUniqueOrThrow({
      where: { id: enqueued?.id ?? '' },
    })
    expect(row.status).toBe('pending')
    expect(row.sentAt).toBeNull()
    // Nothing about the page reported: somebody may be reporting their own
    // family, and this can be read over a shoulder.
    expect(JSON.stringify(row.params)).not.toContain('Nokuthula')

    await markAcknowledged(prisma, { id: filed.id })
    expect(
      (await prisma.report.findUniqueOrThrow({ where: { id: filed.id } })).acknowledgedAt,
    ).not.toBeNull()
  })

  it('is not attempted for somebody who left no number', async () => {
    // They get the reference on screen and the copy says that is the whole of
    // it. `enqueueNotification` returning null is the intended outcome (M2-08
    // §5), not a failure.
    expect(
      await enqueueNotification(prisma, {
        kind: 'report_received',
        templateId: 'reporter_report_received',
        params: { reference: 'REP-000000', respondBy: '19 August' },
        recipient: {},
      }),
    ).toBeNull()
  })
})

describe('the queue reports on itself', () => {
  it('counts what is waiting and what is late, and nothing else', async () => {
    const now = new Date('2026-08-25T09:00:00.000Z')
    const late = new Date('2026-08-18T09:00:00.000Z')

    await fileReport(prisma, {
      ...BLANK,
      reason: 'something-else',
      detail: 'an old one',
      now: late,
    })

    const queue = await queueReport(prisma, { now })

    expect(queue.waiting).toBeGreaterThan(0)
    expect(queue.overdue).toBeGreaterThan(0)
    expect(queue.oldestWaitingHours).toBeGreaterThan(0)

    // Counts only — the contents of a report are among the most sensitive
    // things this product holds, and this is printed into logs (rule 8).
    expect(Object.keys(queue).sort()).toEqual([
      'oldestWaitingHours',
      'overdue',
      'waiting',
    ])
  })

  it('stops counting one a person has picked up', async () => {
    const now = new Date('2026-08-25T09:00:00.000Z')
    const filed = await fileReport(prisma, {
      ...BLANK,
      reason: 'something-else',
      detail: 'picked up',
      now: new Date('2026-08-18T09:00:00.000Z'),
    })

    const before = await queueReport(prisma, { now })
    await prisma.report.update({ where: { id: filed.id }, data: { status: 'reviewing' } })
    const after = await queueReport(prisma, { now })

    expect(after.overdue).toBe(before.overdue - 1)
    expect(after.waiting).toBe(before.waiting - 1)
  })
})

describe('the rate limit', () => {
  it('counts from the rows the form itself writes', async () => {
    const ipHash = `hash-${String(Math.random())}`

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(withinReportLimit(await reportsFromAddress(prisma, { ipHash }))).toBe(true)
      await fileReport(prisma, {
        ...BLANK,
        reason: 'something-else',
        detail: 'again',
        ipHash,
      })
    }

    expect(withinReportLimit(await reportsFromAddress(prisma, { ipHash }))).toBe(false)
    // Somebody else is unaffected.
    expect(withinReportLimit(await reportsFromAddress(prisma, { ipHash: 'other' }))).toBe(
      true,
    )
  })

  it('does not apply where there is no address to count', async () => {
    expect(await reportsFromAddress(prisma, { ipHash: null })).toBe(0)
  })
})
