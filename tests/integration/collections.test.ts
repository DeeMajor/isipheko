import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import {
  abandonCollection,
  collectionsForOrganiser,
  claimAsGroup,
  collectionBySlug,
  collectionsForEvent,
  confirmHandover,
  confirmMember,
  createCollection,
  joinCollection,
  openCollection,
  shareCollection,
} from '@/db/repositories/collection'
import { createDraft } from '@/db/repositories/event'
import { entriesForChain } from '@/db/repositories/ledger'
import { claimItem } from '@/db/repositories/needs'
import { strandForEvent } from '@/db/repositories/strand'
import { verifyChain } from '@/domain/ledger'

import { clientFor } from '../setup/prisma'

/**
 * Collections against a real Postgres — the four things M2-09 is done when.
 *
 * **An attached collection is one entry on the host's chain**, never one per
 * member (rule 14). **A standalone collection resolves with its archetype.** **A
 * group claim reserves the whole item atomically**, through the same conditional
 * UPDATE everybody else uses — proved by racing it against an individual claim.
 * And the money path stays absent, which `collections-no-money-path.test.ts`
 * asserts structurally.
 */

let app: PrismaClient
let phoneCounter = 500

beforeAll(() => {
  app = clientFor(inject('appDatabaseUrl'))
})

afterAll(async () => {
  await app.$disconnect()
})

function uniquePhone(): string {
  return `+2788${String(++phoneCounter).padStart(7, '0')}`
}

async function organiser({ verified = false }: { verified?: boolean } = {}) {
  const record = await organiserForPhone(app, uniquePhone())

  if (verified) {
    // M3-01 sets this; nothing in the product does yet, which is why the share
    // gate refuses everybody today. Set directly so the gate can be exercised.
    await app.organiser.update({
      where: { id: record.id },
      data: { idVerificationStatus: 'verified', displayName: 'Nomsa Mthembu' },
    })
  }

  return record
}

/** A published funeral with one tent and one hundred chairs. */
async function hostEvent(organiserId: string) {
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  await app.event.update({ where: { id: draft.id }, data: { status: 'published' } })
  await app.needItem.deleteMany({ where: { eventId: draft.id } })

  const tent = await app.needItem.create({
    data: { eventId: draft.id, label: 'Tent', quantityRequired: 1, sortOrder: 0 },
    select: { id: true },
  })

  const chairs = await app.needItem.create({
    data: { eventId: draft.id, label: 'Chairs', quantityRequired: 100, sortOrder: 1 },
    select: { id: true },
  })

  return { eventId: draft.id, slug: draft.slug, tentId: tent.id, chairsId: chairs.id }
}

/** An open collection with confirmed members. */
async function groupOf(
  organiserId: string,
  {
    eventId = null,
    amounts = [20_000n, 30_000n],
    title = 'The Ngcobo cousins',
  }: { eventId?: string | null; amounts?: (bigint | null)[]; title?: string } = {},
): Promise<string> {
  const collection = await createCollection(app, {
    organiserId,
    archetype: 'umngcwabo',
    title,
    purpose: 'For the family',
    eventId,
    organiserBankHint: "Nomsa's Capitec, ending 4471",
  })

  await openCollection(app, { id: collection.id, organiserId })

  for (const [index, amountCents] of amounts.entries()) {
    const joined = await joinCollection(app, {
      collectionId: collection.id,
      name: `Member ${String(index + 1)}`,
      amountCents,
    })
    if (!joined.ok) throw new Error('expected the join to succeed')

    await confirmMember(app, { memberId: joined.memberId, organiserId })
  }

  return collection.id
}

describe('an attached collection on the host event page', () => {
  it('is one entry on the host chain, not one per member', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)

    const collectionId = await groupOf(rallier.id, {
      eventId: event.eventId,
      amounts: [20_000n, 30_000n, 50_000n, null],
    })

    const handover = await confirmHandover(app, {
      collectionId,
      confirmedBy: 'witness',
      confirmedByName: 'Thandi Ngcobo',
    })
    expect(handover.ok).toBe(true)

    // Four members, one entry. Eight beads would read as eight small gifts
    // instead of one act by one group (rule 14).
    const entries = await entriesForChain(app, { eventId: event.eventId })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entryType).toBe('collection')
    expect(entries[0]?.referenceId).toBe(collectionId)
    expect(verifyChain(event.eventId, entries).problems).toEqual([])

    // And the strand draws it as a single group bead with the members inside.
    const beads = await strandForEvent(app, event.eventId)
    expect(beads).toHaveLength(1)
    expect(beads[0]?.form).toBe('group')
    expect(beads[0]?.name).toBe('The Ngcobo cousins')
    expect(beads[0]?.members).toEqual(['Member 1', 'Member 2', 'Member 3', 'Member 4'])
    expect(beads[0]?.memberCount).toBe(4)
  })

  it('carries the sum of confirmed members and no individual amounts', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)

    const collectionId = await groupOf(rallier.id, {
      eventId: event.eventId,
      amounts: [20_000n, 30_000n],
    })

    // Somebody who joined and never confirmed is not on the record.
    const pending = await joinCollection(app, {
      collectionId,
      name: 'Said they would',
      amountCents: 90_000n,
    })
    expect(pending.ok).toBe(true)

    await confirmHandover(app, { collectionId, confirmedBy: 'witness' })

    const entries = await entriesForChain(app, { eventId: event.eventId })
    expect(entries[0]?.amountCents).toBe(50_000n)

    // The bead opens to names, not to a breakdown: it carries the group's
    // total (which drives one diameter) and no member's amount at all.
    const beads = await strandForEvent(app, event.eventId)
    expect(beads[0]?.members).not.toContain('Said they would')
    expect(beads[0]?.members).toEqual(['Member 1', 'Member 2'])
    expect(
      String(beads[0] === undefined ? '' : Object.values(beads[0]).map(String).join(' ')),
    ).not.toContain('20000')
  })

  it('hides the name of a member who joined quietly, and still counts them', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)

    const collectionId = await createCollection(app, {
      organiserId: rallier.id,
      archetype: 'umngcwabo',
      title: 'The Zulu cousins',
      eventId: event.eventId,
    })
    await openCollection(app, { id: collectionId.id, organiserId: rallier.id })

    for (const [name, visibility] of [
      ['Thandi', 'public'],
      ['Quiet giver', 'anonymous'],
    ] as const) {
      const joined = await joinCollection(app, {
        collectionId: collectionId.id,
        name,
        amountCents: 10_000n,
        visibility,
      })
      if (!joined.ok) throw new Error('expected the join to succeed')
      await confirmMember(app, { memberId: joined.memberId, organiserId: rallier.id })
    }

    await confirmHandover(app, { collectionId: collectionId.id, confirmedBy: 'witness' })

    const beads = await strandForEvent(app, event.eventId)
    expect(beads[0]?.members).toEqual(['Thandi'])
    // They are inside the bead; the bead says how many people are in it.
    expect(beads[0]?.memberCount).toBe(2)
  })
})

describe('a standalone collection', () => {
  it('resolves by its slug, with its own archetype', async () => {
    const rallier = await organiser({ verified: true })
    const collectionId = await groupOf(rallier.id, { title: 'For Thabo' })

    const shared = await shareCollection(app, {
      id: collectionId,
      organiserId: rallier.id,
    })
    expect(shared.ok).toBe(true)
    if (!shared.ok) return

    const view = await collectionBySlug(app, shared.slug)

    expect(view?.title).toBe('For Thabo')
    // A collection always names an occasion, which drives the tone and the
    // copy even where no host event page exists (Part D2.3).
    expect(view?.archetype).toBe('umngcwabo')
    expect(view?.eventId).toBeNull()
    expect(view?.members.count).toBe(2)
  })

  it('keeps its ledger entry on its own chain', async () => {
    const rallier = await organiser()
    const collectionId = await groupOf(rallier.id, { amounts: [15_000n] })

    await confirmHandover(app, { collectionId, confirmedBy: 'organiser' })

    const entries = await entriesForChain(app, { collectionId })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.amountCents).toBe(15_000n)
    expect(verifyChain(collectionId, entries).problems).toEqual([])
  })

  it('cannot be shared by an organiser nobody has checked', async () => {
    // Rule 13, and today that is everybody: M3-01 does not exist. The gate
    // working is the same shape as M1-07 §5's missing verification clause.
    const rallier = await organiser()
    const collectionId = await groupOf(rallier.id)

    expect(
      await shareCollection(app, { id: collectionId, organiserId: rallier.id }),
    ).toEqual({
      ok: false,
      reason: 'not-verified',
    })

    const stored = await app.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(stored.slug).toBeNull()
  })
})

describe('a group claiming a need item as a unit', () => {
  it('takes the whole item, through the same reservation as everybody else', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)
    const collectionId = await groupOf(rallier.id, { eventId: event.eventId })

    const claim = await claimAsGroup(app, {
      collectionId,
      organiserId: rallier.id,
      needItemId: event.chairsId,
    })
    expect(claim.ok).toBe(true)

    const item = await app.needItem.findUniqueOrThrow({ where: { id: event.chairsId } })
    // All hundred, as a unit — not a share of them.
    expect(item.quantityClaimed).toBe(100)

    const row = await app.needClaim.findFirstOrThrow({ where: { collectionId } })
    expect(row.quantity).toBe(100)
    expect(row.claimantName).toBe('The Ngcobo cousins')
    // A group claim holds until the group releases it: a named organiser with
    // a page is what replaces the seven-day timer.
    expect(row.expiresAt).toBeNull()
  })

  it('loses to somebody who was quicker, rather than over-claiming', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)
    const collectionId = await groupOf(rallier.id, { eventId: event.eventId })

    // One tent. A person and a group reach for it at the same moment.
    const [individual, group] = await Promise.all([
      claimItem(app, { needItemId: event.tentId, quantity: 1, claimantName: 'Sipho' }),
      claimAsGroup(app, {
        collectionId,
        organiserId: rallier.id,
        needItemId: event.tentId,
      }),
    ])

    expect([individual.ok, group.ok].filter(Boolean)).toHaveLength(1)

    const item = await app.needItem.findUniqueOrThrow({ where: { id: event.tentId } })
    expect(item.quantityClaimed).toBe(1)
  })

  it('claims one item, once', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)
    const collectionId = await groupOf(rallier.id, { eventId: event.eventId })

    expect(
      (
        await claimAsGroup(app, {
          collectionId,
          organiserId: rallier.id,
          needItemId: event.tentId,
        })
      ).ok,
    ).toBe(true)

    // Two items held by one group is two groups' worth of reservation.
    expect(
      await claimAsGroup(app, {
        collectionId,
        organiserId: rallier.id,
        needItemId: event.chairsId,
      }),
    ).toEqual({ ok: false, reason: 'not-claimable' })

    const chairs = await app.needItem.findUniqueOrThrow({ where: { id: event.chairsId } })
    expect(chairs.quantityClaimed).toBe(0)
  })

  it('cannot claim from the board of a different umcimbi', async () => {
    const host = await organiser()
    const other = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)
    const elsewhere = await hostEvent(other.id)
    const collectionId = await groupOf(rallier.id, { eventId: event.eventId })

    expect(
      await claimAsGroup(app, {
        collectionId,
        organiserId: rallier.id,
        needItemId: elsewhere.tentId,
      }),
    ).toEqual({ ok: false, reason: 'wrong-event' })
  })

  it('gives the item back when the group falls through', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)
    const collectionId = await groupOf(rallier.id, { eventId: event.eventId })

    await claimAsGroup(app, {
      collectionId,
      organiserId: rallier.id,
      needItemId: event.tentId,
    })
    expect(
      await abandonCollection(app, { id: collectionId, organiserId: rallier.id }),
    ).toBe(true)

    // A group claim does not lapse on a timer, so this is what releases it.
    const item = await app.needItem.findUniqueOrThrow({ where: { id: event.tentId } })
    expect(item.quantityClaimed).toBe(0)
  })

  it('records what was brought, by name, in the chain', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)
    const collectionId = await groupOf(rallier.id, {
      eventId: event.eventId,
      amounts: [null, null],
    })

    await claimAsGroup(app, {
      collectionId,
      organiserId: rallier.id,
      needItemId: event.tentId,
    })
    await confirmHandover(app, { collectionId, confirmedBy: 'witness' })

    const entries = await entriesForChain(app, { eventId: event.eventId })
    expect(entries[0]?.inKindDescription).toBe('The Ngcobo cousins — Tent')
    // Nobody put cash in: the entry has no amount rather than a zero.
    expect(entries[0]?.amountCents).toBeNull()
    // The description is hashed into the chain, so it cannot be edited later.
    expect(verifyChain(event.eventId, entries).problems).toEqual([])
  })
})

describe('the handover', () => {
  it('is what writes the entry, and closing is not', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)
    const collectionId = await groupOf(rallier.id, { eventId: event.eventId })

    await app.collection.update({
      where: { id: collectionId },
      data: { status: 'closed' },
    })

    // A collection that closed at R500 and never reached anybody has not given
    // the family R500, and a host's page showing it would be lying.
    expect(await entriesForChain(app, { eventId: event.eventId })).toHaveLength(0)

    await confirmHandover(app, { collectionId, confirmedBy: 'witness' })
    expect(await entriesForChain(app, { eventId: event.eventId })).toHaveLength(1)
  })

  it('writes one entry when two people confirm at once', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)
    const collectionId = await groupOf(rallier.id, { eventId: event.eventId })

    const [first, second] = await Promise.all([
      confirmHandover(app, { collectionId, confirmedBy: 'witness' }),
      confirmHandover(app, { collectionId, confirmedBy: 'organiser' }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect(await entriesForChain(app, { eventId: event.eventId })).toHaveLength(1)
  })

  it('records how it was confirmed, without needing the host', async () => {
    // Rule 15: the host does nothing in the system during a handover.
    const rallier = await organiser()
    const collectionId = await groupOf(rallier.id)

    await confirmHandover(app, {
      collectionId,
      confirmedBy: 'witness',
      confirmedByName: 'Thandi Ngcobo',
    })

    const stored = await app.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(stored.handoverStatus).toBe('witness_confirmed')
    expect(stored.handoverConfirmedBy).toBe('Thandi Ngcobo')
    expect(stored.status).toBe('handed_over')
  })
})

describe('the host page', () => {
  it('lists the collections attached to it, and no drafts', async () => {
    const host = await organiser()
    const rallier = await organiser()
    const event = await hostEvent(host.id)

    const open = await groupOf(rallier.id, { eventId: event.eventId })
    const draft = await createCollection(app, {
      organiserId: rallier.id,
      archetype: 'umngcwabo',
      title: 'Not started yet',
      eventId: event.eventId,
    })

    const attached = await collectionsForEvent(app, event.eventId)

    expect(attached.map((collection) => collection.id)).toEqual([open])
    expect(attached.map((collection) => collection.id)).not.toContain(draft.id)
    // Free text, and never an account we could pay into (rule 12).
    expect(attached[0]?.organiserBankHint).toBe("Nomsa's Capitec, ending 4471")
  })
})

describe('the organiser’s own list (UX-04)', () => {
  it('lists her collections, newest first, and nobody else’s', async () => {
    const nomsa = await organiser({ verified: true })
    const stranger = await organiser()

    const first = await groupOf(nomsa.id, { title: 'The Ngcobo cousins' })
    const second = await groupOf(nomsa.id, { title: 'The office collection' })
    await groupOf(stranger.id, { title: 'Somebody else’s group' })

    const mine = await collectionsForOrganiser(app, nomsa.id)

    expect(mine.map((collection) => collection.title)).toEqual([
      'The office collection',
      'The Ngcobo cousins',
    ])
    expect(mine.map((collection) => collection.id)).toEqual([second, first])
    expect(mine.every((collection) => !collection.isClosed)).toBe(true)
  })

  it('marks a handed-over collection closed, whoever closed it', async () => {
    const nomsa = await organiser({ verified: true })
    const collectionId = await groupOf(nomsa.id)

    await confirmHandover(app, {
      collectionId,
      confirmedBy: 'organiser',
      confirmedByName: 'Nomsa Mthembu',
      confirmedByMemberId: null,
      evidenceKey: null,
    })

    const [row] = await collectionsForOrganiser(app, nomsa.id)
    expect(row?.isClosed).toBe(true)
  })
})
