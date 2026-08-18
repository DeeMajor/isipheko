import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import { confirmContribution, startContribution } from '@/db/repositories/contribution'
import { createDraft } from '@/db/repositories/event'
import { appendReversal, entriesForChain } from '@/db/repositories/ledger'
import { claimItem, confirmDelivery } from '@/db/repositories/needs'
import { strandForEvent } from '@/db/repositories/strand'
import { verifyChain } from '@/domain/ledger'
import { fromCents } from '@/domain/money'

import { clientFor } from '../setup/prisma'

/**
 * The Ledger Strand's data, against a real Postgres.
 *
 * The strand is read from `ledger_entries`, not from `contributions`, so what
 * is under test here is that **the picture and the record are the same thing**:
 * order, what a reversal does to a bead, and — the part M2-06 added — that
 * confirming a delivery writes an in-kind contribution and its ledger entry
 * atomically, with the chain still verifying afterwards.
 */

let app: PrismaClient
let organiserId: string
let phoneCounter = 700

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(
    app,
    `+2786${String(++phoneCounter).padStart(7, '0')}`,
  )
  organiserId = organiser.id
})

afterAll(async () => {
  await app.$disconnect()
})

async function eventWithOneItem(
  label = 'Chairs',
  quantityRequired = 1,
): Promise<{ eventId: string; itemId: string; title: string }> {
  const title = 'Nokuthula Mthembu'
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umngcwabo',
    title,
    subtitle: null,
    place: null,
    eventDate: null,
  })

  await app.needItem.deleteMany({ where: { eventId: draft.id } })
  const item = await app.needItem.create({
    data: { eventId: draft.id, label, quantityRequired, sortOrder: 0 },
    select: { id: true },
  })

  return { eventId: draft.id, itemId: item.id, title }
}

/** A confirmed cash contribution, the M2-05 path end to end. */
async function cash(
  event: { eventId: string; title: string },
  {
    name,
    rands,
    visibility = 'public',
    message = null,
  }: {
    name: string
    rands: number
    visibility?: 'public' | 'name_only' | 'anonymous'
    message?: string | null
  },
): Promise<string> {
  const started = await startContribution(app, {
    eventId: event.eventId,
    eventTitle: event.title,
    type: 'cash',
    amountCents: fromCents(BigInt(rands) * 100n),
    contributorName: name,
    message,
    visibility,
  })

  const confirmed = await confirmContribution(app, {
    contributionId: started.id,
    organiserId,
  })

  if (!confirmed.ok) throw new Error('expected the confirmation to succeed')

  return confirmed.ledgerEntryId
}

describe('the strand is the chain', () => {
  it('returns beads in the order the chain recorded them', async () => {
    const event = await eventWithOneItem()

    await cash(event, { name: 'Thandi', rands: 50 })
    await cash(event, { name: 'Sipho', rands: 800 })
    await cash(event, { name: 'Nomsa', rands: 5_000 })

    const beads = await strandForEvent(app, event.eventId)

    expect(beads.map((bead) => bead.name)).toEqual(['Thandi', 'Sipho', 'Nomsa'])
    expect(beads.every((bead) => bead.form === 'cash')).toBe(true)
  })

  it('withholds the name of somebody who gave quietly, and nobody else', async () => {
    const event = await eventWithOneItem()

    await cash(event, { name: 'Thandi', rands: 50, visibility: 'anonymous' })
    // `name_only` hides the amount, not the person — and the strand shows no
    // amounts for anybody, so the bead is unremarkable.
    await cash(event, { name: 'Sipho', rands: 800, visibility: 'name_only' })

    const beads = await strandForEvent(app, event.eventId)

    expect(beads.map((bead) => bead.name)).toEqual([null, 'Sipho'])
  })

  it('drops a bead the organiser has reversed, and keeps the chain whole', async () => {
    const event = await eventWithOneItem()

    const first = await cash(event, { name: 'Thandi', rands: 50 })
    await cash(event, { name: 'Sipho', rands: 800 })

    await appendReversal(app, { chain: { eventId: event.eventId }, reversing: first })

    const beads = await strandForEvent(app, event.eventId)

    // The reversal is a row of its own and the chain still holds it — what it
    // must not do is leave a bead on the page for money that never arrived.
    expect(beads.map((bead) => bead.name)).toEqual(['Sipho'])

    const entries = await entriesForChain(app, { eventId: event.eventId })
    expect(entries).toHaveLength(3)
    expect(verifyChain(event.eventId, entries).problems).toEqual([])
  })

  it('shows nothing at all for an event nobody has contributed to', async () => {
    const event = await eventWithOneItem()

    expect(await strandForEvent(app, event.eventId)).toEqual([])
  })
})

describe('a thing that was brought', () => {
  it('becomes an in-kind contribution and a ledger entry, or neither', async () => {
    const event = await eventWithOneItem('Chairs', 100)

    const claim = await claimItem(app, {
      needItemId: event.itemId,
      quantity: 100,
      claimantName: 'Thandi Ngcobo',
    })
    if (!claim.ok) throw new Error('expected the claim to succeed')

    // Claiming alone records nothing: the thing has not arrived yet.
    expect(await strandForEvent(app, event.eventId)).toEqual([])

    expect(await confirmDelivery(app, { claimId: claim.claimId, organiserId })).toEqual({
      ok: true,
    })

    const beads = await strandForEvent(app, event.eventId)
    expect(beads).toHaveLength(1)
    expect(beads[0]?.form).toBe('in_kind')
    expect(beads[0]?.name).toBe('Thandi Ngcobo')
    // No amount is invented for it. An estimated cost would put a number on
    // the strand that nobody gave.
    expect(beads[0]?.amount).toBeNull()
    // The description is the contribution, and the quantity is part of it.
    expect(beads[0]?.description).toBe('Chairs × 100')

    const contribution = await app.contribution.findFirstOrThrow({
      where: { eventId: event.eventId, type: 'in_kind' },
    })
    expect(contribution.status).toBe('confirmed')
    expect(contribution.amountCents).toBeNull()
    expect(contribution.needItemId).toBe(event.itemId)

    // The claim points at the contribution it produced.
    const stored = await app.needClaim.findUniqueOrThrow({ where: { id: claim.claimId } })
    expect(stored.contributionId).toBe(contribution.id)
    expect(stored.status).toBe('delivered')

    const entries = await entriesForChain(app, { eventId: event.eventId })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.inKindDescription).toBe('Chairs × 100')
    expect(entries[0]?.contributionId).toBe(contribution.id)
    // The hash covers the description precisely so "the tent" cannot become
    // "a chair" (M2-01 §1). Until now no row exercised that.
    expect(verifyChain(event.eventId, entries).problems).toEqual([])
  })

  it('writes one bead when the organiser taps confirm twice', async () => {
    const event = await eventWithOneItem('Tent')

    const claim = await claimItem(app, {
      needItemId: event.itemId,
      quantity: 1,
      claimantName: 'Sipho',
    })
    if (!claim.ok) throw new Error('expected the claim to succeed')

    const [first, second] = await Promise.all([
      confirmDelivery(app, { claimId: claim.claimId, organiserId }),
      confirmDelivery(app, { claimId: claim.claimId, organiserId }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect(await strandForEvent(app, event.eventId)).toHaveLength(1)
  })

  it('records nothing when the confirmation is not theirs to make', async () => {
    const event = await eventWithOneItem('Tent')

    const claim = await claimItem(app, {
      needItemId: event.itemId,
      quantity: 1,
      claimantName: 'Sipho',
    })
    if (!claim.ok) throw new Error('expected the claim to succeed')

    const stranger = await organiserForPhone(
      app,
      `+2786${String(++phoneCounter).padStart(7, '0')}`,
    )

    expect(
      await confirmDelivery(app, { claimId: claim.claimId, organiserId: stranger.id }),
    ).toEqual({ ok: false, reason: 'not-yours' })

    expect(await strandForEvent(app, event.eventId)).toEqual([])
    expect(await app.contribution.count({ where: { eventId: event.eventId } })).toBe(0)
  })

  it('puts cash and provisions on one strand, in the order they came', async () => {
    const event = await eventWithOneItem('Meat', 20)

    await cash(event, { name: 'Thandi', rands: 200 })

    const claim = await claimItem(app, {
      needItemId: event.itemId,
      quantity: 20,
      claimantName: 'Nomsa',
    })
    if (!claim.ok) throw new Error('expected the claim to succeed')
    await confirmDelivery(app, { claimId: claim.claimId, organiserId })

    await cash(event, { name: 'Sipho', rands: 50 })

    const beads = await strandForEvent(app, event.eventId)

    expect(beads.map((bead) => [bead.name, bead.form])).toEqual([
      ['Thandi', 'cash'],
      ['Nomsa', 'in_kind'],
      ['Sipho', 'cash'],
    ])
  })
})
