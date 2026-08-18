import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'

import {
  clearEmailStore,
  clearWhatsAppStore,
  sentEmail,
  sentWhatsApp,
} from '@/adapters/messaging'
import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import {
  confirmContribution,
  selfReport,
  startContribution,
} from '@/db/repositories/contribution'
import { createDraft } from '@/db/repositories/event'
import { claimItem, warnExpiringClaims } from '@/db/repositories/needs'
import {
  buildDigest,
  dueNotifications,
  enqueueNotification,
  markFailed,
  markSent,
  pruneNotifications,
} from '@/db/repositories/notifications'
import { fromCents } from '@/domain/money'
import { flushNotifications } from '@/lib/notify'

import { clientFor } from '../setup/prisma'

/**
 * Notifications against a real Postgres.
 *
 * **The done-criterion lives here**: fifty contributions in ten minutes produce
 * exactly one organiser message. That is a property of two tables and a
 * conditional update, so it cannot be tested against a mock — a mock would
 * answer according to whatever its author believed about the batching rule,
 * which is the belief under test.
 */

let app: PrismaClient
let phoneCounter = 900

beforeAll(() => {
  app = clientFor(inject('appDatabaseUrl'))
})

afterAll(async () => {
  await app.$disconnect()
})

beforeEach(() => {
  clearWhatsAppStore()
  clearEmailStore()
})

function uniquePhone(): string {
  return `+2787${String(++phoneCounter).padStart(7, '0')}`
}

interface Fixture {
  readonly organiserId: string
  readonly organiserPhone: string
  readonly eventId: string
  readonly title: string
  readonly itemId: string
}

async function fixture({
  archetype = 'umngcwabo',
  email = null,
}: {
  archetype?: 'umngcwabo' | 'umshado'
  email?: string | null
} = {}): Promise<Fixture> {
  const phone = uniquePhone()
  const organiser = await organiserForPhone(app, phone)

  if (email !== null) {
    await app.organiser.update({ where: { id: organiser.id }, data: { email } })
  }

  const title = archetype === 'umngcwabo' ? 'Nokuthula Mthembu' : 'Lindiwe & Sipho'
  const draft = await createDraft(app, {
    organiserId: organiser.id,
    archetype,
    title,
    subtitle: null,
    place: null,
    eventDate: null,
  })

  await app.event.update({ where: { id: draft.id }, data: { status: 'published' } })
  await app.needItem.deleteMany({ where: { eventId: draft.id } })

  const item = await app.needItem.create({
    data: { eventId: draft.id, label: 'Chairs', quantityRequired: 100, sortOrder: 0 },
    select: { id: true },
  })

  return {
    organiserId: organiser.id,
    organiserPhone: phone,
    eventId: draft.id,
    title,
    itemId: item.id,
  }
}

/**
 * One contributor reaching the pay step and saying they paid.
 *
 * **`now` is threaded through deliberately** (M2-08b). Without it the row is
 * stamped with the wall clock while the flush is asked about a fixed time, and
 * the test passes or fails according to the hour somebody runs it — which is
 * how three tests in this file came to pass only before 03:00 SAST.
 */
async function contributeAndReport(
  event: Fixture,
  { name, phone = null, now }: { name: string; phone?: string | null; now?: Date },
): Promise<string> {
  const started = await startContribution(app, {
    eventId: event.eventId,
    eventTitle: event.title,
    type: 'cash',
    amountCents: fromCents(20_000n),
    contributorName: name,
    contributorPhoneE164: phone,
    visibility: 'public',
  })

  await selfReport(app, {
    contributionId: started.id,
    ...(now === undefined ? {} : { now }),
  })

  return started.id
}

const digestsFor = (fix: Fixture) =>
  app.notification.count({
    where: {
      organiserId: fix.organiserId,
      eventId: fix.eventId,
      kind: 'organiser_digest',
    },
  })

describe('fifty contributions in ten minutes', () => {
  it('produce exactly one message to the organiser', async () => {
    const fix = await fixture()
    const start = new Date('2026-08-17T08:00:00.000Z') // 10:00 SAST

    // Fifty people, spread across ten minutes, each saying they paid.
    for (let index = 0; index < 50; index += 1) {
      await contributeAndReport(fix, { name: `Contributor ${String(index)}` })
    }

    expect(
      await app.digestEntry.count({
        where: { eventId: fix.eventId, notificationId: null },
      }),
    ).toBe(50)

    // The flush runs every hour; run it at three points inside the ten minutes
    // to prove the cap is the constraint and not the schedule.
    for (const minutes of [2, 6, 10]) {
      await flushNotifications(app, {
        now: new Date(start.getTime() + minutes * 60 * 1000),
        nodeEnv: 'test',
      })
    }

    expect(await digestsFor(fix)).toBe(1)

    // And every one of the fifty facts is accounted for by that one message.
    expect(
      await app.digestEntry.count({
        where: { eventId: fix.eventId, notificationId: null },
      }),
    ).toBe(0)

    const sent = sentWhatsApp().filter((message) => message.to === fix.organiserPhone)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.metaName).toBe('organiser_digest_v1')
    expect(sent[0]?.params.join(' ')).toContain('50 people said they paid')
  })

  it('sends the next one an hour later, not sooner', async () => {
    const fix = await fixture()
    const start = new Date('2026-08-17T08:00:00.000Z')

    await contributeAndReport(fix, { name: 'Thandi' })
    await flushNotifications(app, { now: start, nodeEnv: 'test' })

    await contributeAndReport(fix, { name: 'Sipho' })
    await flushNotifications(app, {
      now: new Date(start.getTime() + 59 * 60 * 1000),
      nodeEnv: 'test',
    })
    expect(await digestsFor(fix)).toBe(1)

    await flushNotifications(app, {
      now: new Date(start.getTime() + 61 * 60 * 1000),
      nodeEnv: 'test',
    })
    expect(await digestsFor(fix)).toBe(2)
  })

  it('gives an organiser running two imicimbi one message each', async () => {
    // Per organiser per umcimbi: a digest mixing a wedding and a funeral into
    // one message is the worst possible output of a batching rule.
    const funeral = await fixture()
    const wedding = await fixture({ archetype: 'umshado' })

    await app.event.update({
      where: { id: wedding.eventId },
      data: { organiserId: funeral.organiserId },
    })

    await contributeAndReport(funeral, { name: 'Thandi' })
    await contributeAndReport(wedding, { name: 'Sipho' })

    await flushNotifications(app, {
      now: new Date('2026-08-17T08:00:00.000Z'),
      nodeEnv: 'test',
    })

    expect(await digestsFor(funeral)).toBe(1)
    expect(
      await app.notification.count({
        where: { eventId: wedding.eventId, kind: 'organiser_digest' },
      }),
    ).toBe(1)
  })

  it('does not double-send when two flushes overlap', async () => {
    const fix = await fixture()
    const now = new Date('2026-08-17T08:00:00.000Z')

    await contributeAndReport(fix, { name: 'Thandi' })

    // Two cron runs on top of each other. The advisory lock serialises them and
    // the second finds nothing left to summarise.
    await Promise.all([
      buildDigest(app, { organiserId: fix.organiserId, eventId: fix.eventId, now }),
      buildDigest(app, { organiserId: fix.organiserId, eventId: fix.eventId, now }),
    ])

    expect(await digestsFor(fix)).toBe(1)
  })
})

describe('the quiet window', () => {
  it('sends nothing at three in the morning, and everything at seven', async () => {
    const fix = await fixture()
    const night = new Date('2026-08-17T01:00:00.000Z') // 03:00 SAST

    await contributeAndReport(fix, { name: 'Thandi' })
    await flushNotifications(app, { now: night, nodeEnv: 'test' })

    // Not built, not sent, and nothing lost: the facts are still waiting.
    expect(await digestsFor(fix)).toBe(0)
    expect(sentWhatsApp().filter((m) => m.to === fix.organiserPhone)).toHaveLength(0)
    expect(
      await app.digestEntry.count({
        where: { eventId: fix.eventId, notificationId: null },
      }),
    ).toBe(1)

    // Somebody else contributes at dawn. Holding the build rather than the send
    // is what puts them in the same message.
    await contributeAndReport(fix, { name: 'Sipho' })

    await flushNotifications(app, {
      now: new Date('2026-08-17T05:00:00.000Z'), // 07:00 SAST
      nodeEnv: 'test',
    })

    expect(await digestsFor(fix)).toBe(1)
    const sent = sentWhatsApp().filter((m) => m.to === fix.organiserPhone)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.params.join(' ')).toContain('2 people said they paid')
  })

  /**
   * Run at two fixed times, one on each side of 03:00 SAST.
   *
   * The expectation is identical at both, because it is about the quiet window
   * and not about the hour the suite happens to run: an immediate message is
   * never held. Before M2-08b this passed at 03:00 and failed at 14:00 — not
   * because the rule changed, but because the row was stamped with the wall
   * clock and the flush was asked about a fixed one.
   */
  it.each([
    ['03:00 SAST, inside the quiet window', new Date('2026-08-17T01:00:00.000Z')],
    ['14:00 SAST, outside it', new Date('2026-08-17T12:00:00.000Z')],
  ])('does not hold an immediate message (%s)', async (_label, now) => {
    // A contributor who has just been told their contribution is confirmed is
    // waiting for that. Only digests are held.
    const fix = await fixture()
    const contributorPhone = uniquePhone()

    const contributionId = await contributeAndReport(fix, {
      name: 'Thandi',
      phone: contributorPhone,
      now,
    })
    await confirmContribution(app, { contributionId, organiserId: fix.organiserId, now })

    await flushNotifications(app, { now, nodeEnv: 'test' })

    const sent = sentWhatsApp().filter((message) => message.to === contributorPhone)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.metaName).toBe('contribution_confirmed_v1')
  })
})

describe('who is told what', () => {
  /** Two fixed times, both inside the send window, and the same answer at each. */
  it.each([
    ['10:00 SAST', new Date('2026-08-17T08:00:00.000Z')],
    ['18:00 SAST', new Date('2026-08-17T16:00:00.000Z')],
  ])(
    'tells the contributor immediately and the organiser in the digest (%s)',
    async (_label, now) => {
      const fix = await fixture()
      const contributorPhone = uniquePhone()

      const contributionId = await contributeAndReport(fix, {
        name: 'Thandi',
        phone: contributorPhone,
        now,
      })
      await confirmContribution(app, {
        contributionId,
        organiserId: fix.organiserId,
        now,
      })

      await flushNotifications(app, { now, nodeEnv: 'test' })

      expect(sentWhatsApp().filter((m) => m.to === contributorPhone)).toHaveLength(1)
      expect(sentWhatsApp().filter((m) => m.to === fix.organiserPhone)).toHaveLength(1)
    },
  )

  it('sends a contributor with no number nothing at all', async () => {
    const fix = await fixture()
    const contributionId = await contributeAndReport(fix, { name: 'Thandi' })

    const before = sentWhatsApp().length
    await confirmContribution(app, { contributionId, organiserId: fix.organiserId })
    await flushNotifications(app, {
      now: new Date('2026-08-17T08:00:00.000Z'),
      nodeEnv: 'test',
    })

    // One message: the organiser's digest. Nothing for the contributor, and no
    // email invented for them (rule 4).
    expect(sentWhatsApp().length - before).toBe(1)
    expect(sentEmail()).toHaveLength(0)
  })

  it.each([
    ['10:00 SAST', new Date('2026-08-17T08:00:00.000Z')],
    ['18:00 SAST', new Date('2026-08-17T16:00:00.000Z')],
  ])(
    'tells somebody who claimed an item, and puts it in the digest (%s)',
    async (_label, now) => {
      const fix = await fixture()
      const claimantPhone = uniquePhone()

      const claim = await claimItem(app, {
        needItemId: fix.itemId,
        quantity: 10,
        claimantName: 'Nomsa',
        claimantPhoneE164: claimantPhone,
        now,
      })
      expect(claim.ok).toBe(true)

      await flushNotifications(app, { now, nodeEnv: 'test' })

      const sent = sentWhatsApp().filter((message) => message.to === claimantPhone)
      expect(sent).toHaveLength(1)
      expect(sent[0]?.metaName).toBe('claim_confirmed_v1')
      expect(sent[0]?.params).toContain('Chairs')

      expect(await digestsFor(fix)).toBe(1)
    },
  )

  it('warns a claim two days out, once and only once', async () => {
    const fix = await fixture()
    const claimantPhone = uniquePhone()

    const claim = await claimItem(app, {
      needItemId: fix.itemId,
      quantity: 5,
      claimantName: 'Nomsa',
      claimantPhoneE164: claimantPhone,
    })
    if (!claim.ok) throw new Error('expected the claim to succeed')
    // A person's claim always has one; only a group's is open-ended (M2-09).
    if (claim.expiresAt === null) throw new Error('expected a hold with an expiry')

    // Six days in: the seven-day hold has two days left.
    const nearly = new Date(claim.expiresAt.getTime() - 47 * 60 * 60 * 1000)

    // The sweep is global — other fixtures in this database have claims of
    // their own — so what is asserted is this claimant's messages, and that a
    // second sweep produces no more of them.
    expect(await warnExpiringClaims(app, nearly)).toBeGreaterThanOrEqual(1)
    await flushNotifications(app, { now: nearly, nodeEnv: 'test' })
    await warnExpiringClaims(app, nearly)
    await flushNotifications(app, { now: nearly, nodeEnv: 'test' })

    const warnings = sentWhatsApp().filter(
      (message) =>
        message.to === claimantPhone && message.metaName === 'claim_expiring_v1',
    )
    expect(warnings).toHaveLength(1)
  })
})

describe('when the BSP will not take it', () => {
  it('retries with a backoff before giving up', async () => {
    const fix = await fixture()
    const enqueued = await enqueueNotification(app, {
      kind: 'contribution_confirmed',
      templateId: 'contributor_contribution_confirmed',
      params: { eventTitle: fix.title, slug: 'slug' },
      recipient: { phoneE164: uniquePhone() },
      organiserId: fix.organiserId,
      eventId: fix.eventId,
    })
    if (enqueued === null) throw new Error('expected a notification')

    const now = new Date('2026-08-17T08:00:00.000Z')
    const first = await markFailed(app, {
      id: enqueued.id,
      errorCode: 'bsp-timeout',
      now,
    })

    expect(first.status).toBe('pending')
    const row = await app.notification.findUniqueOrThrow({ where: { id: enqueued.id } })
    expect(row.attempts).toBe(1)
    expect(row.scheduledFor.getTime()).toBe(now.getTime() + 60 * 1000)
    // A code, never a provider's prose — it can carry the number (rule 8).
    expect(row.lastErrorCode).toBe('bsp-timeout')

    // It is not due again until the backoff has passed.
    expect(
      (await dueNotifications(app, { now })).some((due) => due.id === enqueued.id),
    ).toBe(false)

    await markFailed(app, { id: enqueued.id, errorCode: 'bsp-timeout', now })
    const third = await markFailed(app, {
      id: enqueued.id,
      errorCode: 'bsp-timeout',
      now,
    })

    expect(third.status).toBe('failed')
    expect(
      (await app.notification.findUniqueOrThrow({ where: { id: enqueued.id } })).status,
    ).toBe('failed')
  })

  it('falls back to email for an organiser, and never for a contributor', async () => {
    const fix = await fixture({ email: `organiser${String(++phoneCounter)}@example.com` })

    const organiserMessage = await enqueueNotification(app, {
      kind: 'organiser_digest',
      templateId: 'organiser_digest',
      params: { eventTitle: fix.title, slug: 'slug', selfReported: '1' },
      recipient: { phoneE164: fix.organiserPhone },
      organiserId: fix.organiserId,
      eventId: fix.eventId,
    })
    if (organiserMessage === null) throw new Error('expected a notification')

    const now = new Date('2026-08-17T08:00:00.000Z')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await markFailed(app, { id: organiserMessage.id, errorCode: 'bsp-down', now })
    }
    const final = await markFailed(app, {
      id: organiserMessage.id,
      errorCode: 'bsp-down',
      now,
    })

    expect(final.status).toBe('failed')
    expect(final.fallbackId).toBeDefined()

    const fallback = await app.notification.findUniqueOrThrow({
      where: { id: final.fallbackId ?? '' },
    })
    expect(fallback.channel).toBe('email')
    expect(fallback.toEmail).not.toBeNull()

    // A contributor's failed message has nowhere to go, and inventing one would
    // mean asking for an address (rule 4).
    const contributorMessage = await enqueueNotification(app, {
      kind: 'contribution_confirmed',
      templateId: 'contributor_contribution_confirmed',
      params: { eventTitle: fix.title, slug: 'slug' },
      recipient: { phoneE164: uniquePhone() },
      eventId: fix.eventId,
    })
    if (contributorMessage === null) throw new Error('expected a notification')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await markFailed(app, { id: contributorMessage.id, errorCode: 'bsp-down', now })
    }
    const contributorFinal = await markFailed(app, {
      id: contributorMessage.id,
      errorCode: 'bsp-down',
      now,
    })

    expect(contributorFinal.status).toBe('failed')
    expect(contributorFinal.fallbackId).toBeUndefined()
  })

  it('sends a message once when two flushes race for it', async () => {
    const fix = await fixture()
    const enqueued = await enqueueNotification(app, {
      kind: 'contribution_confirmed',
      templateId: 'contributor_contribution_confirmed',
      params: { eventTitle: fix.title, slug: 'slug' },
      recipient: { phoneE164: uniquePhone() },
      eventId: fix.eventId,
    })
    if (enqueued === null) throw new Error('expected a notification')

    const now = new Date('2026-08-17T08:00:00.000Z')
    const results = await Promise.all([
      markSent(app, { id: enqueued.id, now }),
      markSent(app, { id: enqueued.id, now }),
    ])

    // Exactly one wins; the loser is told not to hand it to the BSP again.
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})

describe('retention', () => {
  it('prunes what has been dealt with, and keeps what has not', async () => {
    const fix = await fixture()
    const old = new Date('2026-06-01T08:00:00.000Z')

    const stale = await enqueueNotification(app, {
      kind: 'contribution_confirmed',
      templateId: 'contributor_contribution_confirmed',
      params: { eventTitle: fix.title, slug: 'slug' },
      recipient: { phoneE164: uniquePhone() },
      eventId: fix.eventId,
      now: old,
    })
    if (stale === null) throw new Error('expected a notification')

    // Only the status is set by hand. `createdAt` used to be corrected here
    // too, because `enqueueNotification` let the column default to the database
    // clock while the row was enqueued at a simulated one — a workaround that
    // documented the bug M2-08b fixed. Removing it is what makes this test
    // depend on the fix.
    await app.notification.update({
      where: { id: stale.id },
      data: { status: 'sent', sentAt: old },
    })

    const pendingStill = await enqueueNotification(app, {
      kind: 'contribution_confirmed',
      templateId: 'contributor_contribution_confirmed',
      params: { eventTitle: fix.title, slug: 'slug' },
      recipient: { phoneE164: uniquePhone() },
      eventId: fix.eventId,
      now: old,
    })
    if (pendingStill === null) throw new Error('expected a notification')

    const pruned = await pruneNotifications(app, {
      olderThanMs: 30 * 24 * 60 * 60 * 1000,
      now: new Date('2026-08-17T08:00:00.000Z'),
    })

    expect(pruned.notifications).toBeGreaterThanOrEqual(1)
    expect(await app.notification.findUnique({ where: { id: stale.id } })).toBeNull()
    // A message still waiting to go is never pruned, however old it is.
    expect(
      await app.notification.findUnique({ where: { id: pendingStill.id } }),
    ).not.toBeNull()
  })
})
