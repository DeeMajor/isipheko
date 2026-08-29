import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import {
  createDraft,
  draftForOrganiser,
  eventsForOrganiser,
  needsForEvent,
  publicEventBySlug,
  publishDraft,
  reconcileNeeds,
  replaceWitnesses,
  witnessesForEvent,
} from '@/db/repositories/event'
import { organiserForPhone } from '@/db/repositories/auth'
import { claimItem } from '@/db/repositories/needs'
import { ARCHETYPES } from '@/domain/archetype'
import { canPublish, isValidSlug } from '@/domain/event'
import { needTemplate } from '@/copy/need-templates'

import { clientFor } from '../setup/prisma'

/**
 * Creating an umcimbi, against a real Postgres.
 *
 * The two things worth proving here cannot be proved anywhere else: that a
 * draft is invisible to the public read however correct the slug is, and that
 * the bereavement CHECK still refuses a target on a funeral even when the row
 * comes through this path.
 */

let prisma: PrismaClient
let organiserId: string

let phoneCounter = 0
const nextPhone = () => `+2783${String(1_000_000 + ++phoneCounter).slice(-7)}`

/**
 * Verifying an organiser directly, which is state-setting rather than a door in
 * the product: the application path is M3-01's check, and there is no flag that
 * bypasses it. The same posture the collection tests and the size gate use.
 */
async function verify(id: string): Promise<void> {
  await prisma.organiser.update({
    where: { id },
    data: {
      idVerificationStatus: 'verified',
      idVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
    },
  })
}

beforeAll(async () => {
  prisma = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(prisma, nextPhone())
  organiserId = organiser.id

  // Publishing requires a verified organiser since M3-02. Every test below that
  // reaches a published page needs one, so the shared fixture has one.
  await verify(organiserId)
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function draftFor(archetype: keyof typeof ARCHETYPES, title = 'Nokuthula Mthembu') {
  return createDraft(prisma, {
    organiserId,
    archetype,
    title,
    subtitle: 'uMaZondi',
    place: 'KwaMashu, KwaZulu-Natal',
    eventDate: new Date('2026-09-12T00:00:00.000Z'),
  })
}

describe('creating a draft', () => {
  it('gets an unguessable slug', async () => {
    const draft = await draftFor('umngcwabo')

    expect(isValidSlug(draft.slug)).toBe(true)
    expect(draft.slug).toMatch(/^[0-9A-Za-z]{16}$/)
  })

  it('starts as a draft, not something already public', async () => {
    const { id } = await draftFor('umshado', 'Lindiwe & Sipho')
    const summary = await draftForOrganiser(prisma, { id, organiserId })

    expect(summary?.isPublished).toBe(false)
  })

  it('pre-fills the needs from the archetype template', async () => {
    const { id } = await draftFor('umngcwabo')
    const needs = await needsForEvent(prisma, id)

    expect(needs.map((need) => need.label)).toEqual(
      needTemplate(ARCHETYPES.umngcwabo.needsTemplate).map((item) => item.label),
    )
    // Marked as ours until the organiser saves the step.
    expect(needs.every((need) => need.fromTemplate)).toBe(true)
  })

  it('keeps a note that has no quantity in it, unparsed', async () => {
    const { id } = await draftFor('umngcwabo')
    const needs = await needsForEvent(prisma, id)

    expect(needs.find((need) => need.label === 'Groceries')?.note).toBe(
      'Mealie meal, rice, sugar, oil',
    )
  })

  it('sets the denormalised group from the config, so the CHECK cannot fire', async () => {
    // The group is taken from ARCHETYPES rather than from the form, so the
    // archetype/group CHECK has nothing to catch. This is the test that would
    // fail if somebody wired the group to a hidden input.
    const { id } = await draftFor('umngcwabo')
    const row = await prisma.event.findUniqueOrThrow({ where: { id } })

    expect(row.archetypeGroup).toBe('bereavement')
  })

  it('defaults a bereavement event to hidden amounts', async () => {
    const { id } = await draftFor('umngcwabo')
    const row = await prisma.event.findUniqueOrThrow({ where: { id } })

    expect(row.visibilityDefault).toBe('name_only')
  })

  it('still cannot be given a target on a funeral', async () => {
    // CLAUDE.md rule 1 at the database layer, reached through this path.
    const { id } = await draftFor('umngcwabo')

    await expect(
      prisma.event.update({ where: { id }, data: { targetAmountCents: 100_00n } }),
    ).rejects.toThrow(/events_bereavement_has_no_target/)
  })
})

describe('editing the draft', () => {
  it('replaces the needs list with what the organiser left on screen', async () => {
    const { id } = await draftFor('umngcwabo')

    await reconcileNeeds(prisma, id, [
      { id: null, label: 'Tent', note: 'Around R1 200 to hire' },
      { id: null, label: 'Chairs', note: '' },
    ])

    const needs = await needsForEvent(prisma, id)
    expect(needs.map((need) => need.label)).toEqual(['Tent', 'Chairs'])
    expect(needs[1]?.note).toBeNull()
    // No longer suggested — the list is theirs now.
    expect(needs.every((need) => !need.fromTemplate)).toBe(true)
  })

  /**
   * UX-03. The old shape was delete-everything-and-recreate, which was
   * harmless while a need item was only a label and stopped being harmless
   * when M2-03 hung claims off the rows: `need_claims.need_item_id` cascades,
   * so one revisit of this screen after publishing deleted every claim on the
   * umcimbi — the M3-03 §1 class, one table over.
   */
  it('keeps a row’s claims when the list is saved again', async () => {
    const { id } = await draftFor('umngcwabo')
    await reconcileNeeds(prisma, id, [{ id: null, label: 'Tent', note: '' }])

    const [tent] = await needsForEvent(prisma, id)
    const claim = await claimItem(prisma, {
      needItemId: tent?.id ?? '',
      quantity: 1,
      claimantName: 'Thandi Ngcobo',
    })
    expect(claim.ok).toBe(true)

    // The save that used to destroy it: same row back, same id, edited note.
    const outcome = await reconcileNeeds(prisma, id, [
      { id: tent?.id ?? '', label: 'Tent', note: 'Around R1 200 to hire' },
    ])
    expect(outcome.kept).toEqual([])

    const claims = await prisma.needClaim.findMany({
      where: { needItem: { eventId: id } },
    })
    expect(claims).toHaveLength(1)
    expect(claims[0]?.status).toBe('claimed')

    const [after] = await needsForEvent(prisma, id)
    expect(after?.id).toBe(tent?.id)
    expect(after?.note).toBe('Around R1 200 to hire')
  })

  it('refuses to delete a row with a live claim, and names it', async () => {
    const { id } = await draftFor('umngcwabo')
    await reconcileNeeds(prisma, id, [
      { id: null, label: 'Tent', note: '' },
      { id: null, label: 'Chairs', note: '' },
    ])

    const rows = await needsForEvent(prisma, id)
    const tent = rows.find((row) => row.label === 'Tent')
    const chairs = rows.find((row) => row.label === 'Chairs')

    const claim = await claimItem(prisma, {
      needItemId: tent?.id ?? '',
      quantity: 1,
      claimantName: 'Thandi Ngcobo',
    })
    expect(claim.ok).toBe(true)

    // She removes both. The unclaimed row goes; the claimed one stays, and the
    // caller is told which so the screen can say why.
    const outcome = await reconcileNeeds(prisma, id, [])
    expect(outcome.kept).toEqual(['Tent'])

    const after = await needsForEvent(prisma, id)
    expect(after.map((row) => row.label)).toEqual(['Tent'])
    expect(after.find((row) => row.label === 'Chairs')).toBeUndefined()
    expect(chairs).toBeDefined()

    const claims = await prisma.needClaim.findMany({
      where: { needItem: { eventId: id } },
    })
    expect(claims).toHaveLength(1)
  })

  it('leaves suggested rows alone — they were never on the form', async () => {
    const { id } = await draftFor('umngcwabo')
    await reconcileNeeds(prisma, id, [{ id: null, label: 'Tent', note: '' }])

    await prisma.needItem.create({
      data: {
        eventId: id,
        label: 'Ice',
        status: 'suggested',
        suggestedByName: 'Sipho',
        sortOrder: 99,
      },
    })

    // A save that keeps only the tent must not read the suggestion as a
    // removed row: the screen shows active rows only, so it was never there.
    const [tent] = await needsForEvent(prisma, id)
    await reconcileNeeds(prisma, id, [{ id: tent?.id ?? '', label: 'Tent', note: '' }])

    const suggestion = await prisma.needItem.findFirst({
      where: { eventId: id, status: 'suggested' },
    })
    expect(suggestion?.label).toBe('Ice')
  })

  it('stores abakhaphi as invited, and sends nothing', async () => {
    const { id } = await draftFor('umngcwabo')

    await replaceWitnesses(prisma, id, [
      { name: 'Thandi Ngcobo', phoneE164: '+27821234567' },
    ])

    const witnesses = await witnessesForEvent(prisma, id)
    expect(witnesses).toHaveLength(1)

    const row = await prisma.witness.findFirstOrThrow({ where: { eventId: id } })
    expect(row.status).toBe('invited')
    expect(row.acceptedAt).toBeNull()
  })

  it('counts what publishing needs', async () => {
    const { id } = await draftFor('umngcwabo')
    await reconcileNeeds(prisma, id, [{ id: null, label: 'Tent', note: '' }])
    await replaceWitnesses(prisma, id, [
      { name: 'Thandi Ngcobo', phoneE164: '+27821234568' },
    ])

    const summary = await draftForOrganiser(prisma, { id, organiserId })

    expect(summary?.needCount).toBe(1)
    expect(summary?.witnessCount).toBe(1)
    expect(canPublish(summary!)).toEqual({ ok: true })
  })
})

describe('somebody else’s draft', () => {
  it('is indistinguishable from one that does not exist', async () => {
    const { id } = await draftFor('umngcwabo')
    const stranger = await organiserForPhone(prisma, nextPhone())

    // An id in a URL is not a permission. The scoped read returns null, which
    // is the same answer a made-up id gets.
    expect(await draftForOrganiser(prisma, { id, organiserId: stranger.id })).toBeNull()
    expect(
      await draftForOrganiser(prisma, {
        id: '01999999-9999-7999-8999-999999999999',
        organiserId,
      }),
    ).toBeNull()
  })

  it('does not appear in their list of events', async () => {
    const { id } = await draftFor('umngcwabo')
    const stranger = await organiserForPhone(prisma, nextPhone())

    const theirs = await eventsForOrganiser(prisma, stranger.id)
    expect(theirs.map((event) => event.id)).not.toContain(id)
  })
})

describe('the public read', () => {
  it('refuses a draft, however correct the slug', async () => {
    const draft = await draftFor('umngcwabo')

    expect(await publicEventBySlug(prisma, draft.slug)).toBeNull()
  })

  it('returns the event once it is published', async () => {
    const draft = await draftFor('umngcwabo')
    await reconcileNeeds(prisma, draft.id, [
      { id: null, label: 'Tent', note: 'Around R1 200' },
    ])
    await replaceWitnesses(prisma, draft.id, [
      { name: 'Thandi Ngcobo', phoneE164: '+27821234569' },
    ])

    expect(await publishDraft(prisma, { id: draft.id, organiserId })).toBe(true)

    const published = await publicEventBySlug(prisma, draft.slug)
    expect(published?.title).toBe('Nokuthula Mthembu')
    expect(published?.subtitle).toBe('uMaZondi')
    expect(published?.needs.map((need) => need.label)).toEqual(['Tent'])
  })

  it('publishes once, however many times the button is pressed', async () => {
    const draft = await draftFor('umngcwabo')

    const first = await publishDraft(prisma, { id: draft.id, organiserId })
    const second = await publishDraft(prisma, { id: draft.id, organiserId })

    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('refuses to publish an unverified organiser, in SQL', async () => {
    // The second layer, and the reason it is not "one guard with a spare"
    // (M2-05 §7): this calls the repository directly, never asks `canPublish`,
    // and Postgres refuses anyway because the condition is part of the UPDATE.
    const unverified = await organiserForPhone(prisma, nextPhone())
    const draft = await createDraft(prisma, {
      organiserId: unverified.id,
      archetype: 'umngcwabo',
      title: 'Nokuthula Mthembu',
      subtitle: null,
      place: null,
      eventDate: null,
    })

    expect(await publishDraft(prisma, { id: draft.id, organiserId: unverified.id })).toBe(
      false,
    )
    expect(await publicEventBySlug(prisma, draft.slug)).toBeNull()

    const row = await prisma.event.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true },
    })
    expect(row.status).toBe('draft')
  })

  it('publishes the same draft once the organiser has been verified', async () => {
    const later = await organiserForPhone(prisma, nextPhone())
    const draft = await createDraft(prisma, {
      organiserId: later.id,
      archetype: 'umngcwabo',
      title: 'Nokuthula Mthembu',
      subtitle: null,
      place: null,
      eventDate: null,
    })

    expect(await publishDraft(prisma, { id: draft.id, organiserId: later.id })).toBe(
      false,
    )

    await verify(later.id)

    expect(await publishDraft(prisma, { id: draft.id, organiserId: later.id })).toBe(true)
  })

  it('carries the verification date onto the public page', async () => {
    const draft = await draftFor('umngcwabo')
    await publishDraft(prisma, { id: draft.id, organiserId })

    const published = await publicEventBySlug(prisma, draft.slug)

    // What the badge above the fold is rendered from. Read rather than assumed:
    // the page states the date, and a date it invented would be a lie about
    // when somebody was checked.
    expect(published?.organiserVerifiedAt).toEqual(new Date('2026-08-12T00:00:00.000Z'))
  })

  it('tells the setup flow whether the organiser is verified', async () => {
    const unverified = await organiserForPhone(prisma, nextPhone())
    const draft = await createDraft(prisma, {
      organiserId: unverified.id,
      archetype: 'umngcwabo',
      title: 'Nokuthula Mthembu',
      subtitle: null,
      place: null,
      eventDate: null,
    })

    const summary = await draftForOrganiser(prisma, {
      id: draft.id,
      organiserId: unverified.id,
    })
    expect(summary?.organiserVerified).toBe(false)
    expect(
      canPublish({ ...summary!, title: 'x', needCount: 1, witnessCount: 1 }),
    ).toEqual({ ok: false, blocker: 'not-verified' })
  })

  it('cannot be published by somebody else', async () => {
    const draft = await draftFor('umngcwabo')
    const stranger = await organiserForPhone(prisma, nextPhone())

    expect(await publishDraft(prisma, { id: draft.id, organiserId: stranger.id })).toBe(
      false,
    )
    expect(await publicEventBySlug(prisma, draft.slug)).toBeNull()
  })

  it('has no answer for a slug nobody was issued', async () => {
    expect(await publicEventBySlug(prisma, 'aaaaaaaaaaaaaaaa')).toBeNull()
  })
})
