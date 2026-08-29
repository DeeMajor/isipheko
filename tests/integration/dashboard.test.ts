import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { organiserForPhone } from '@/db/repositories/auth'
import {
  confirmContribution,
  selfReport,
  startContribution,
} from '@/db/repositories/contribution'
import { createDraft, publishDraft, reconcileNeeds } from '@/db/repositories/event'
import type { PrismaClient } from '@/db/generated/client'
import {
  approveSuggestion,
  claimItem,
  confirmDelivery,
  organiserBoard,
  suggestItem,
} from '@/db/repositories/needs'
import {
  balanceForEvent,
  bankAccountVerified,
  payoutApprovedByWitness,
} from '@/db/repositories/payout'
import { formatMoney, fromCents } from '@/domain/money'
import { payoutConditions, unmetConditions } from '@/domain/payout'

import { clientFor } from '../setup/prisma'

/**
 * The dashboard's two reads against a real Postgres (M3-08).
 *
 * **The money split reads the ledger, not `contributions`.** A contribution row
 * can be updated by the application and a ledger row cannot (rule 3), so if the
 * two ever disagreed the number an organiser is shown should be the one nobody
 * can quietly change. That is asserted here rather than assumed, by confirming
 * real contributions through the real path and reading the split back.
 *
 * **The board separates claimed-not-delivered from unclaimed.** The public
 * board cannot: an item fully claimed and undelivered is invisible there, and
 * it is exactly the thing that does not arrive.
 *
 * Every assertion about the 72-hour window runs against a **fixed `now`**. The
 * window is three days wide, and `appendEntry` takes the timestamp from the
 * application (M2-01 §3), so this suite can simulate a clock rather than
 * passing or failing by the hour somebody runs it.
 */

let app: PrismaClient
let organiserId: string

let phoneCounter = 0
const nextPhone = () => `+2785${String(4_000_000 + ++phoneCounter).slice(-7)}`

const NOW = new Date('2026-08-18T09:00:00.000Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))

  const organiser = await organiserForPhone(app, nextPhone())
  organiserId = organiser.id

  await app.organiser.update({
    where: { id: organiserId },
    data: {
      displayName: 'Nomsa Mthembu',
      idVerificationStatus: 'verified',
      idVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
    },
  })
})

afterAll(async () => {
  await app.$disconnect()
})

async function publishedEvent(
  needs: readonly { label: string; note: string; quantityRequired?: number }[] = [],
): Promise<{ id: string; slug: string }> {
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: 'KwaMashu',
    eventDate: null,
  })

  if (needs.length > 0) {
    await reconcileNeeds(
      app,
      draft.id,
      needs.map((need) => ({ id: null, label: need.label, note: need.note })),
    )
  }

  await app.witness.create({
    data: { eventId: draft.id, name: 'Sipho Mthembu', phoneE164: nextPhone() },
  })
  await publishDraft(app, { id: draft.id, organiserId })

  return draft
}

/**
 * A contribution taken all the way to a ledger entry, **at a chosen instant.**
 *
 * `confirmContribution` threads `now` into the append, so the ledger row's
 * `created_at` is the simulated time rather than the wall clock — which is what
 * makes a three-day window testable at all (M2-01 §3, M2-08b §6).
 */
async function confirmedContribution(
  eventId: string,
  rands: number,
  at: Date,
): Promise<void> {
  const started = await startContribution(app, {
    eventId,
    eventTitle: 'Nokuthula Mthembu',
    contributorName: 'Thandi Ngcobo',
    amountCents: fromCents(BigInt(rands) * 100n),
    type: 'cash',
    message: null,
    visibility: 'public',
  })

  await selfReport(app, { contributionId: started.id, now: at })
  await confirmContribution(app, {
    contributionId: started.id,
    organiserId,
    now: at,
  })
}

describe('the money split reads the ledger', () => {
  it('counts what has been confirmed, and only that', async () => {
    const event = await publishedEvent()

    // Started and never reported: no ledger entry, so no money.
    await startContribution(app, {
      eventId: event.id,
      eventTitle: 'Nokuthula Mthembu',
      contributorName: 'Somebody who looked',
      amountCents: fromCents(900_00n),
      type: 'cash',
      message: null,
      visibility: 'public',
    })

    await confirmedContribution(event.id, 500, hoursAgo(100))

    const balance = await balanceForEvent(app, { eventId: event.id, now: NOW })
    expect(formatMoney(balance.raised)).toBe('R500,00')
  })

  it('fences the recent portion and leaves the rest alone', async () => {
    /*
     * The done-criterion, against real rows. R40 000 last week and R50 an hour
     * ago must not leave a family unable to touch the R40 000 — that is the
     * failure discovered by somebody standing in a bank on the morning of a
     * funeral.
     */
    const event = await publishedEvent()

    await confirmedContribution(event.id, 40_000, hoursAgo(24 * 7))
    await confirmedContribution(event.id, 50, hoursAgo(1))

    const balance = await balanceForEvent(app, { eventId: event.id, now: NOW })

    expect(formatMoney(balance.raised)).toBe('R40 050,00')
    expect(formatMoney(balance.settling)).toBe('R50,00')
    expect(formatMoney(balance.available)).toBe('R40 000,00')
  })

  it('says when the fenced portion clears', async () => {
    const event = await publishedEvent()
    const at = hoursAgo(70)

    await confirmedContribution(event.id, 300, at)

    const balance = await balanceForEvent(app, { eventId: event.id, now: NOW })
    expect(balance.clearsAt).toEqual(new Date(at.getTime() + 72 * 60 * 60 * 1000))
  })

  it('leaves what people brought out of the money', async () => {
    // A tent is not money and cannot be paid out. It is on the board and on the
    // strand, which is where it belongs.
    const event = await publishedEvent([{ label: 'Tent', note: 'Around R1 200' }])
    const [item] = await app.needItem.findMany({ where: { eventId: event.id } })

    const claim = await claimItem(app, {
      needItemId: item?.id ?? '',
      claimantName: 'Musa Khumalo',
      claimantPhoneE164: null,
      quantity: 1,
      claimedIpHash: null,
    })

    expect(claim.ok).toBe(true)
    if (!claim.ok) return

    await confirmDelivery(app, { claimId: claim.claimId, organiserId, now: hoursAgo(1) })

    const balance = await balanceForEvent(app, { eventId: event.id, now: NOW })

    // The in-kind entry is on the chain — and in no figure here.
    const entries = await app.ledgerEntry.count({ where: { eventId: event.id } })
    expect(entries).toBe(1)
    expect(formatMoney(balance.raised)).toBe('R0,00')
    expect(formatMoney(balance.settling)).toBe('R0,00')
  })

  it('answers zero for an umcimbi nobody has contributed to', async () => {
    const event = await publishedEvent()
    const balance = await balanceForEvent(app, { eventId: event.id, now: NOW })

    expect(formatMoney(balance.raised)).toBe('R0,00')
    expect(formatMoney(balance.available)).toBe('R0,00')
    expect(balance.clearsAt).toBeNull()
  })
})

describe('the board from the organiser side', () => {
  it('separates claimed-not-delivered from unclaimed', async () => {
    const event = await publishedEvent([
      { label: 'Tent', note: 'One big one' },
      { label: 'Transport', note: 'From Johannesburg' },
    ])

    const items = await app.needItem.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: 'asc' },
    })
    const tent = items.find((item) => item.label === 'Tent')

    const claim = await claimItem(app, {
      needItemId: tent?.id ?? '',
      claimantName: 'Zanele Mkhize',
      claimantPhoneE164: null,
      quantity: 1,
      claimedIpHash: null,
    })
    expect(claim.ok).toBe(true)

    const board = await organiserBoard(app, { eventId: event.id, organiserId })

    expect(board.promised.map((row) => row.label)).toEqual(['Tent'])
    expect(board.promised[0]?.claimantName).toBe('Zanele Mkhize')
    expect(board.open.map((row) => row.label)).toEqual(['Transport'])
    expect(board.arrived).toEqual([])
  })

  it('moves a thing to arrived once she says it did', async () => {
    const event = await publishedEvent([{ label: 'Chairs', note: 'A hundred' }])
    const [item] = await app.needItem.findMany({ where: { eventId: event.id } })

    const claim = await claimItem(app, {
      needItemId: item?.id ?? '',
      claimantName: 'Zanele Mkhize',
      claimantPhoneE164: null,
      quantity: 1,
      claimedIpHash: null,
    })
    if (!claim.ok) throw new Error('claim failed')

    await confirmDelivery(app, { claimId: claim.claimId, organiserId, now: hoursAgo(2) })

    const board = await organiserBoard(app, { eventId: event.id, organiserId })

    expect(board.promised).toEqual([])
    expect(board.arrived.map((row) => row.label)).toEqual(['Chairs'])
    expect(board.arrived[0]?.deliveredAt).not.toBeNull()
  })

  it('shows an item that is claimed and undelivered, which the public board cannot', async () => {
    /*
     * The reason this read exists. `boardForEvent` answers *what can still be
     * taken*, so a fully-claimed item drops off it — and the thing nobody can
     * still take is exactly the thing that has to be chased.
     */
    const event = await publishedEvent([{ label: 'Gazebo', note: '' }])
    const [item] = await app.needItem.findMany({ where: { eventId: event.id } })

    const claim = await claimItem(app, {
      needItemId: item?.id ?? '',
      claimantName: 'Xolani Cele',
      claimantPhoneE164: null,
      quantity: 1,
      claimedIpHash: null,
    })
    expect(claim.ok).toBe(true)

    const { boardForEvent } = await import('@/db/repositories/needs')
    const publicBoard = await boardForEvent(app, event.id)
    const organiserView = await organiserBoard(app, { eventId: event.id, organiserId })

    expect(publicBoard.filter((row) => row.remaining > 0)).toEqual([])
    expect(organiserView.promised.map((row) => row.label)).toEqual(['Gazebo'])
  })

  it('surfaces a suggestion, which had no screen at all until now', async () => {
    // Built and tested in M2-04 and unreachable: a contributor could tell the
    // family they had forgotten something and no organiser could ever see it.
    const event = await publishedEvent()

    await suggestItem(app, {
      eventId: event.id,
      label: 'Ice',
      note: 'For the drinks',
      suggestedByName: 'MaDlamini',
    })

    const board = await organiserBoard(app, { eventId: event.id, organiserId })

    expect(board.suggested.map((row) => row.label)).toEqual(['Ice'])
    expect(board.suggested[0]?.claimantName).toBe('MaDlamini')
    // Not on her list until she says so.
    expect(board.open.map((row) => row.label)).not.toContain('Ice')
  })

  it('moves an approved suggestion onto the list', async () => {
    const event = await publishedEvent()
    const suggestion = await suggestItem(app, {
      eventId: event.id,
      label: 'Paraffin',
      note: null,
      suggestedByName: 'Themba',
    })

    expect(await approveSuggestion(app, { needItemId: suggestion.id, organiserId })).toBe(
      true,
    )

    const board = await organiserBoard(app, { eventId: event.id, organiserId })

    expect(board.suggested).toEqual([])
    expect(board.open.map((row) => row.label)).toContain('Paraffin')
  })

  it('answers for the organiser who owns the event and nobody else', async () => {
    const event = await publishedEvent([{ label: 'Tent', note: '' }])
    const stranger = await organiserForPhone(app, nextPhone())

    const board = await organiserBoard(app, {
      eventId: event.id,
      organiserId: stranger.id,
    })

    expect(board.open).toEqual([])
    expect(board.promised).toEqual([])
  })
})

describe('the payout conditions, against what actually exists', () => {
  it('are all unmet on a working umcimbi except the one that has a screen', async () => {
    const event = await publishedEvent()
    await confirmedContribution(event.id, 40_000, hoursAgo(1))

    const balance = await balanceForEvent(app, { eventId: event.id, now: NOW })

    const conditions = payoutConditions({
      identityVerified: true,
      bankVerified: await bankAccountVerified(app, organiserId),
      settling: balance.settling,
      available: balance.available,
      witnessApproved: await payoutApprovedByWitness(app, event.id),
    })

    const unmet = unmetConditions(conditions).map((condition) => condition.id)

    // Bank: nothing writes `bank_accounts` — verification needs the Stitch BAV
    // integration in Part F, which is Mode B work.
    expect(unmet).toContain('bank')
    // Hold: everything arrived an hour ago.
    expect(unmet).toContain('hold')
    expect(unmet).not.toContain('identity')
  })

  it('has nothing to approve, because there is no payout to approve', async () => {
    // Not an oversight. Mode B is Milestone 5 and gated on the legal opinion
    // (architecture §15 item 1); `payouts` exists and nothing writes to it.
    const event = await publishedEvent()

    expect(await payoutApprovedByWitness(app, event.id)).toBe(false)
    expect(await app.payout.count({ where: { eventId: event.id } })).toBe(0)
  })

  it('meets the hold once the money has aged past the window', async () => {
    const event = await publishedEvent()
    await confirmedContribution(event.id, 1_000, hoursAgo(100))

    const balance = await balanceForEvent(app, { eventId: event.id, now: NOW })
    const conditions = payoutConditions({
      identityVerified: true,
      bankVerified: false,
      settling: balance.settling,
      available: balance.available,
      witnessApproved: false,
    })

    expect(unmetConditions(conditions).map((c) => c.id)).not.toContain('hold')
    expect(formatMoney(balance.available)).toBe('R1 000,00')
  })

  it('needs no second signature on a small event, and says so', async () => {
    const event = await publishedEvent()
    await confirmedContribution(event.id, 400, hoursAgo(100))

    const balance = await balanceForEvent(app, { eventId: event.id, now: NOW })
    const conditions = payoutConditions({
      identityVerified: true,
      bankVerified: true,
      settling: balance.settling,
      available: balance.available,
      witnessApproved: false,
    })

    expect(balance.available < fromCents(5_000_00n)).toBe(true)
    expect(unmetConditions(conditions)).toEqual([])
  })
})
