import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import { createDraft, publicEventBySlug } from '@/db/repositories/event'
import {
  approveSuggestion,
  boardForEvent,
  claimItem,
  confirmDelivery,
  declineSuggestion,
  expireLapsedClaims,
  suggestItem,
  suggestionsForOrganiser,
  withdrawClaim,
} from '@/db/repositories/needs'
import { CLAIM_HOLD_MS } from '@/domain/needs'

import { clientFor } from '../setup/prisma'

/**
 * The needs board against a real Postgres.
 *
 * The whole point of this file is the two things that cannot be tested without
 * one: **concurrent claims on the last chair**, which is a property of a
 * conditional UPDATE and not of any code we wrote, and **the CHECK constraint**,
 * which is what catches the day that UPDATE is written wrong.
 */

let app: PrismaClient
let organiserId: string
let phoneCounter = 0

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(
    app,
    `+2785${String(++phoneCounter).padStart(7, '0')}`,
  )
  organiserId = organiser.id
})

afterAll(async () => {
  await app.$disconnect()
})

/** An event with one item of the given quantity. */
async function boardWith(
  quantityRequired: number,
  label = 'Chairs',
): Promise<{ eventId: string; slug: string; itemId: string }> {
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  // createDraft seeds the archetype template; this test wants one known item.
  await app.needItem.deleteMany({ where: { eventId: draft.id } })

  const item = await app.needItem.create({
    data: { eventId: draft.id, label, quantityRequired, sortOrder: 0 },
    select: { id: true },
  })

  return { eventId: draft.id, slug: draft.slug, itemId: item.id }
}

describe('two people and one chair', () => {
  it('lets exactly one of them have it', async () => {
    const { itemId } = await boardWith(1, 'The last chair')

    const [first, second] = await Promise.all([
      claimItem(app, { needItemId: itemId, quantity: 1, claimantName: 'Thandi' }),
      claimItem(app, { needItemId: itemId, quantity: 1, claimantName: 'Sipho' }),
    ])

    // CLAUDE.md rule 5: two people tapping at the same moment must not both see
    // success.
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)

    const loser = first.ok ? second : first
    expect(loser).toEqual({ ok: false, reason: 'conflict' })
  })

  it('holds under twenty at once', async () => {
    const { itemId } = await boardWith(1, 'The last tent')

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        claimItem(app, {
          needItemId: itemId,
          quantity: 1,
          claimantName: `Claimant ${String(index)}`,
        }),
      ),
    )

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)

    const item = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantityClaimed).toBe(1)

    const claims = await app.needClaim.count({
      where: { needItemId: itemId, status: 'claimed' },
    })
    expect(claims).toBe(1)
  })

  it('never over-reserves when everybody takes a part at once', async () => {
    // 20kg of meat, twenty people asking for 2kg each. Ten can have it.
    const { itemId } = await boardWith(20, 'Meat')

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        claimItem(app, {
          needItemId: itemId,
          quantity: 2,
          claimantName: `Claimant ${String(index)}`,
        }),
      ),
    )

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(10)

    const item = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantityClaimed).toBe(20)
  })
})

describe('the CHECK behind the conditional update', () => {
  it('refuses an over-claim the query somehow let through', async () => {
    const { itemId } = await boardWith(4)

    // Written as raw SQL with no WHERE guard — the mistake a future query could
    // make. The database is what catches it.
    await expect(
      app.$executeRaw`UPDATE need_items SET quantity_claimed = 5 WHERE id = ${itemId}`,
    ).rejects.toThrow(/need_items_quantity_claimed_within_required/)
  })

  it('refuses a negative counter', async () => {
    const { itemId } = await boardWith(4)

    await expect(
      app.$executeRaw`UPDATE need_items SET quantity_claimed = -1 WHERE id = ${itemId}`,
    ).rejects.toThrow(/need_items_quantity_claimed_is_not_negative/)
  })

  it('refuses a claim of nothing', async () => {
    const { itemId } = await boardWith(4)

    // A zero-quantity claim would sit in the list looking like somebody had
    // taken something, and the chairs would appear taken for no findable reason.
    await expect(
      app.needClaim.create({
        data: { needItemId: itemId, quantity: 0, claimantName: 'Nobody' },
      }),
    ).rejects.toThrow(/need_claims_quantity_is_at_least_one/)
  })

  it('refuses an item that needs less than one of itself', async () => {
    const draft = await createDraft(app, {
      organiserId,
      archetype: 'umngcwabo',
      title: 'Nokuthula Mthembu',
      subtitle: null,
      place: null,
      eventDate: null,
    })

    await expect(
      app.needItem.create({
        data: { eventId: draft.id, label: 'Nothing', quantityRequired: 0 },
      }),
    ).rejects.toThrow(/need_items_quantity_required_is_at_least_one/)
  })
})

describe('expiry', () => {
  it('returns the quantity when the sweep runs', async () => {
    const { itemId } = await boardWith(2)
    const longAgo = new Date(Date.now() - CLAIM_HOLD_MS - 60_000)

    const claim = await claimItem(app, {
      needItemId: itemId,
      quantity: 2,
      claimantName: 'Thandi',
      now: longAgo,
    })
    expect(claim.ok).toBe(true)

    const before = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(before.quantityClaimed).toBe(2)

    const swept = await expireLapsedClaims(app)

    expect(swept.claims).toBeGreaterThanOrEqual(1)
    const after = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(after.quantityClaimed).toBe(0)
  })

  it('does not block somebody now, even before the sweep has run', async () => {
    // The failure this prevents would look like a bug in the board rather than
    // in the schedule: a chair that came free on Tuesday still taken on
    // Thursday because nothing happened to run.
    const { itemId } = await boardWith(1)
    const longAgo = new Date(Date.now() - CLAIM_HOLD_MS - 60_000)

    await claimItem(app, {
      needItemId: itemId,
      quantity: 1,
      claimantName: 'Forgot about it',
      now: longAgo,
    })

    const second = await claimItem(app, {
      needItemId: itemId,
      quantity: 1,
      claimantName: 'Still needs a chair',
    })

    expect(second.ok).toBe(true)

    const item = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantityClaimed).toBe(1)
  })

  it('is idempotent — two sweeps do not give back the same chair twice', async () => {
    const { itemId } = await boardWith(3)
    const longAgo = new Date(Date.now() - CLAIM_HOLD_MS - 60_000)

    await claimItem(app, {
      needItemId: itemId,
      quantity: 3,
      claimantName: 'Thandi',
      now: longAgo,
    })

    await expireLapsedClaims(app)
    await expireLapsedClaims(app)

    const item = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantityClaimed).toBe(0)
  })

  it('leaves a live claim alone', async () => {
    const { itemId } = await boardWith(2)
    await claimItem(app, { needItemId: itemId, quantity: 2, claimantName: 'Thandi' })

    await expireLapsedClaims(app)

    const item = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantityClaimed).toBe(2)
  })
})

describe('withdrawal and delivery', () => {
  it('gives the quantity back when a claim is withdrawn', async () => {
    const { itemId } = await boardWith(10)
    const claim = await claimItem(app, {
      needItemId: itemId,
      quantity: 4,
      claimantName: 'Thandi',
    })
    expect(claim.ok).toBe(true)
    if (!claim.ok) return

    const released = await withdrawClaim(app, claim.claimId)

    expect(released).toEqual({ ok: true, remaining: 10 })
    const item = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantityClaimed).toBe(0)
  })

  it('keeps the quantity held once it is delivered', async () => {
    // Delivered means the thing arrived. The item is no less taken for it.
    const { itemId } = await boardWith(10)
    const claim = await claimItem(app, {
      needItemId: itemId,
      quantity: 4,
      claimantName: 'Thandi',
    })
    if (!claim.ok) throw new Error('expected the claim to succeed')

    expect(await confirmDelivery(app, { claimId: claim.claimId, organiserId })).toEqual({
      ok: true,
    })

    const item = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantityClaimed).toBe(4)

    // And it can no longer be withdrawn out from under the record.
    expect(await withdrawClaim(app, claim.claimId)).toEqual({
      ok: false,
      reason: 'not-releasable',
    })
  })

  it('lets only the organiser who owns the event confirm', async () => {
    const { itemId } = await boardWith(1)
    const claim = await claimItem(app, {
      needItemId: itemId,
      quantity: 1,
      claimantName: 'Thandi',
    })
    if (!claim.ok) throw new Error('expected the claim to succeed')

    const stranger = await organiserForPhone(
      app,
      `+2785${String(++phoneCounter).padStart(7, '0')}`,
    )

    expect(
      await confirmDelivery(app, { claimId: claim.claimId, organiserId: stranger.id }),
    ).toEqual({ ok: false, reason: 'not-yours' })
  })
})

describe('the counter and the claims behind it', () => {
  it('still agree after claiming, expiring and withdrawing', async () => {
    // The drift the CHECK cannot catch: a counter that no longer matches the
    // claims it is meant to summarise.
    const { itemId } = await boardWith(20, 'Chairs')
    const longAgo = new Date(Date.now() - CLAIM_HOLD_MS - 60_000)

    const stale = await claimItem(app, {
      needItemId: itemId,
      quantity: 5,
      claimantName: 'Lapsed',
      now: longAgo,
    })
    const kept = await claimItem(app, {
      needItemId: itemId,
      quantity: 4,
      claimantName: 'Kept',
    })
    const dropped = await claimItem(app, {
      needItemId: itemId,
      quantity: 3,
      claimantName: 'Withdrawn',
    })

    if (!stale.ok || !kept.ok || !dropped.ok) throw new Error('setup failed')

    await withdrawClaim(app, dropped.claimId)
    await expireLapsedClaims(app)

    const item = await app.needItem.findUniqueOrThrow({ where: { id: itemId } })
    const held = await app.needClaim.findMany({
      where: { needItemId: itemId, status: { in: ['claimed', 'delivered'] } },
      select: { quantity: true },
    })

    const sum = held.reduce((total, claim) => total + claim.quantity, 0)

    expect(item.quantityClaimed).toBe(sum)
    expect(item.quantityClaimed).toBe(4)
  })
})

describe('suggested items', () => {
  it('do not appear on the public board until the organiser approves', async () => {
    const { eventId, slug } = await boardWith(1, 'Chairs')

    const suggestion = await suggestItem(app, {
      eventId,
      label: 'Firewood',
      note: 'Enough for the day',
      suggestedByName: 'Thandi Ngcobo',
    })

    expect((await boardForEvent(app, eventId)).map((item) => item.label)).toEqual([
      'Chairs',
    ])
    const published = await publicEventBySlug(app, slug)
    expect(published).toBeNull() // still a draft — the point is the query below

    const organiserView = await suggestionsForOrganiser(app, { eventId, organiserId })
    expect(organiserView).toEqual([
      {
        id: suggestion.id,
        label: 'Firewood',
        note: 'Enough for the day',
        suggestedByName: 'Thandi Ngcobo',
      },
    ])
  })

  it('cannot be claimed while they are only suggested', async () => {
    const { eventId } = await boardWith(1)
    const suggestion = await suggestItem(app, {
      eventId,
      label: 'Firewood',
      suggestedByName: 'Thandi',
    })

    expect(
      await claimItem(app, {
        needItemId: suggestion.id,
        quantity: 1,
        claimantName: 'Eager',
      }),
    ).toEqual({ ok: false, reason: 'not-open' })
  })

  it('join the board once approved', async () => {
    const { eventId } = await boardWith(1)
    const suggestion = await suggestItem(app, {
      eventId,
      label: 'Firewood',
      suggestedByName: 'Thandi',
    })

    expect(await approveSuggestion(app, { needItemId: suggestion.id, organiserId })).toBe(
      true,
    )

    expect((await boardForEvent(app, eventId)).map((item) => item.label)).toContain(
      'Firewood',
    )
  })

  it('stay off it when declined, and stop appearing in the queue', async () => {
    // "Declined" and "not yet looked at" are different things to an organiser
    // working down a list.
    const { eventId } = await boardWith(1)
    const suggestion = await suggestItem(app, {
      eventId,
      label: 'A marquee',
      suggestedByName: 'Thandi',
    })

    expect(await declineSuggestion(app, { needItemId: suggestion.id, organiserId })).toBe(
      true,
    )

    expect((await boardForEvent(app, eventId)).map((item) => item.label)).not.toContain(
      'A marquee',
    )
    expect(await suggestionsForOrganiser(app, { eventId, organiserId })).toEqual([])
  })

  it('cannot be approved by somebody else', async () => {
    const { eventId } = await boardWith(1)
    const suggestion = await suggestItem(app, {
      eventId,
      label: 'Firewood',
      suggestedByName: 'Thandi',
    })

    const stranger = await organiserForPhone(
      app,
      `+2785${String(++phoneCounter).padStart(7, '0')}`,
    )

    expect(
      await approveSuggestion(app, {
        needItemId: suggestion.id,
        organiserId: stranger.id,
      }),
    ).toBe(false)
  })
})
