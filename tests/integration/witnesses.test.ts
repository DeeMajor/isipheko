import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import {
  createDraft,
  publicEventBySlug,
  publishDraft,
  replaceNeeds,
  replaceWitnesses,
  witnessesForEvent,
} from '@/db/repositories/event'
import {
  issueWitnessInvite,
  respondToInvite,
  witnessForToken,
  witnessSummaryForEvent,
} from '@/db/repositories/witness'
import { WITNESS_INVITE_TTL_MS, hashInviteToken } from '@/domain/witness'

import { clientFor } from '../setup/prisma'

/**
 * Abakhaphi against a real Postgres (M3-03).
 *
 * Four things worth proving here and nowhere else: an answer is written once
 * however many times the link is tapped, the public read carries the names that
 * agreed and nothing else, a spent link stops being a capability, and — the one
 * that would otherwise be found by an organiser rather than by a test —
 * **editing the list does not wipe what anybody has already answered.**
 */

let prisma: PrismaClient
let organiserId: string

let phoneCounter = 0
const nextPhone = () => `+2784${String(1_000_000 + ++phoneCounter).slice(-7)}`

beforeAll(async () => {
  prisma = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(prisma, nextPhone())
  organiserId = organiser.id

  await prisma.organiser.update({
    where: { id: organiserId },
    data: {
      displayName: 'Nomsa Mthembu',
      // Publishing needs it (M3-02), and half these tests read a public page.
      idVerificationStatus: 'verified',
      idVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
    },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function eventWith(
  people: readonly { name: string; phoneE164: string }[],
): Promise<{ id: string; slug: string }> {
  const draft = await createDraft(prisma, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  await replaceNeeds(prisma, draft.id, [{ label: 'Tent', note: 'Around R1 200' }])
  await replaceWitnesses(prisma, draft.id, people)

  return draft
}

async function inviteFor(eventId: string, witnessId: string): Promise<string> {
  const outcome = await issueWitnessInvite(prisma, { witnessId, eventId, organiserId })
  if (!outcome.ok) throw new Error(`could not issue: ${outcome.reason}`)

  return outcome.issued.token
}

describe('asking somebody', () => {
  it('issues a link that resolves to them, without spending it', async () => {
    const event = await eventWith([{ name: 'Thandi Ngcobo', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)
    const token = await inviteFor(event.id, witness?.id ?? '')

    // Reading is not answering. Signal fails; somebody opening the link twice
    // has not used up their answer (M2-11 §2).
    const first = await witnessForToken(prisma, token)
    const second = await witnessForToken(prisma, token)

    expect(first?.witnessName).toBe('Thandi Ngcobo')
    expect(first?.eventTitle).toBe('Nokuthula Mthembu')
    expect(first?.status).toBe('invited')
    expect(second?.status).toBe('invited')
  })

  it('stores the hash and never the token', async () => {
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)
    const token = await inviteFor(event.id, witness?.id ?? '')

    const row = await prisma.witness.findUniqueOrThrow({
      where: { id: witness?.id ?? '' },
      select: { inviteTokenHash: true, inviteExpiresAt: true },
    })

    expect(row.inviteTokenHash).toBe(hashInviteToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(row.inviteExpiresAt?.getTime()).toBeGreaterThan(Date.now())
    expect(row.inviteExpiresAt?.getTime()).toBeLessThanOrEqual(
      Date.now() + WITNESS_INVITE_TTL_MS,
    )
  })

  it('replaces the previous link rather than leaving two live', async () => {
    // Plans change and phones are lost. Two live links for one person is a
    // capability nobody is tracking (M2-11 §7).
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)

    const first = await inviteFor(event.id, witness?.id ?? '')
    const second = await inviteFor(event.id, witness?.id ?? '')

    expect(await witnessForToken(prisma, first)).toBeNull()
    expect((await witnessForToken(prisma, second))?.witnessName).toBe('Thandi')
  })

  it('cannot be issued by somebody else', async () => {
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)
    const stranger = await organiserForPhone(prisma, nextPhone())

    expect(
      await issueWitnessInvite(prisma, {
        witnessId: witness?.id ?? '',
        eventId: event.id,
        organiserId: stranger.id,
      }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('answering', () => {
  it('records a yes once, however many taps race', async () => {
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)
    const token = await inviteFor(event.id, witness?.id ?? '')

    const [first, second] = await Promise.all([
      respondToInvite(prisma, { token, answer: 'accept' }),
      respondToInvite(prisma, { token, answer: 'accept' }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)

    const row = await prisma.witness.findUniqueOrThrow({
      where: { id: witness?.id ?? '' },
      select: { status: true, acceptedAt: true, declinedAt: true },
    })
    expect(row.status).toBe('accepted')
    expect(row.acceptedAt).not.toBeNull()
    expect(row.declinedAt).toBeNull()
  })

  it('records a no, and keeps it off the page', async () => {
    const event = await eventWith([{ name: 'Sipho', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)
    const token = await inviteFor(event.id, witness?.id ?? '')

    expect(await respondToInvite(prisma, { token, answer: 'decline' })).toEqual({
      ok: true,
      status: 'declined',
    })

    const row = await prisma.witness.findUniqueOrThrow({
      where: { id: witness?.id ?? '' },
      select: { status: true, declinedAt: true, acceptedAt: true },
    })
    expect(row.status).toBe('declined')
    expect(row.declinedAt).not.toBeNull()
    expect(row.acceptedAt).toBeNull()
  })

  it('answers once, and still shows them their answer afterwards', async () => {
    // The link stays readable on purpose. Clearing it would land somebody
    // re-opening their own answered link on "that link is not one of ours",
    // telling the person who answered correctly that they had done something
    // wrong — the bug M2-11 §2 had to fix on the handover tap.
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)
    const token = await inviteFor(event.id, witness?.id ?? '')

    await respondToInvite(prisma, { token, answer: 'accept' })

    expect((await witnessForToken(prisma, token))?.status).toBe('accepted')

    // And it grants nothing: the answer cannot be changed with it.
    expect(await respondToInvite(prisma, { token, answer: 'decline' })).toEqual({
      ok: false,
      reason: 'already-answered',
    })
    expect((await witnessForToken(prisma, token))?.status).toBe('accepted')
  })

  it('is final until a new link is issued', async () => {
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)

    await respondToInvite(prisma, {
      token: await inviteFor(event.id, witness?.id ?? ''),
      answer: 'decline',
    })

    // And she cannot quietly reopen the question with another link either —
    // removing them and asking again is a deliberate act.
    expect(
      await issueWitnessInvite(prisma, {
        witnessId: witness?.id ?? '',
        eventId: event.id,
        organiserId,
      }),
    ).toEqual({ ok: false, reason: 'already-answered' })
  })

  it('refuses an expired link', async () => {
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])
    const [witness] = await witnessesForEvent(prisma, event.id)
    const token = await inviteFor(event.id, witness?.id ?? '')

    const later = new Date(Date.now() + WITNESS_INVITE_TTL_MS + 1_000)

    expect(
      await respondToInvite(prisma, { token, answer: 'accept', now: later }),
    ).toEqual({ ok: false, reason: 'expired' })
  })
})

describe('editing the list', () => {
  it('does not wipe an acceptance, which is what it used to do', async () => {
    // The bug this task had to fix before the accept path was worth anything.
    // Every step of the setup flow saves what is on screen first (M1-07 §8), so
    // adding a third umkhaphi ran `replaceWitnesses` — which deleted every row
    // and wrote them again, taking the acceptances and the live links with it,
    // silently.
    const first = nextPhone()
    const second = nextPhone()
    const third = nextPhone()

    const event = await eventWith([
      { name: 'Thandi Ngcobo', phoneE164: first },
      { name: 'Sipho Mthembu', phoneE164: second },
    ])

    const saved = await witnessesForEvent(prisma, event.id)
    const thandi = saved.find((row) => row.phoneE164 === first)
    const sipho = saved.find((row) => row.phoneE164 === second)

    await respondToInvite(prisma, {
      token: await inviteFor(event.id, thandi?.id ?? ''),
      answer: 'accept',
    })
    const siphoToken = await inviteFor(event.id, sipho?.id ?? '')

    // She comes back and adds a third.
    await replaceWitnesses(prisma, event.id, [
      { name: 'Thandi Ngcobo', phoneE164: first },
      { name: 'Sipho Mthembu', phoneE164: second },
      { name: 'Mandla Zulu', phoneE164: third },
    ])

    const after = await witnessSummaryForEvent(prisma, {
      eventId: event.id,
      organiserId,
    })

    expect(after).toHaveLength(3)
    expect(after.find((row) => row.phoneE164 === first)?.status).toBe('accepted')
    // Thandi keeps her id, so nothing that pointed at her is now pointing at a
    // row that no longer exists.
    expect(after.find((row) => row.phoneE164 === first)?.id).toBe(thandi?.id)
    // And Sipho's live link still works.
    expect((await witnessForToken(prisma, siphoToken))?.witnessName).toBe('Sipho Mthembu')
  })

  it('keeps an answer when a name is corrected', async () => {
    // Fixing the spelling of somebody's name is not un-asking them.
    const phone = nextPhone()
    const event = await eventWith([{ name: 'Thandi Ncgobo', phoneE164: phone }])
    const [witness] = await witnessesForEvent(prisma, event.id)

    await respondToInvite(prisma, {
      token: await inviteFor(event.id, witness?.id ?? ''),
      answer: 'accept',
    })

    await replaceWitnesses(prisma, event.id, [
      { name: 'Thandi Ngcobo', phoneE164: phone },
    ])

    const [after] = await witnessSummaryForEvent(prisma, {
      eventId: event.id,
      organiserId,
    })
    expect(after?.name).toBe('Thandi Ngcobo')
    expect(after?.status).toBe('accepted')
    expect(after?.id).toBe(witness?.id)
  })

  it('removes somebody actually taken off the list', async () => {
    const staying = nextPhone()
    const going = nextPhone()

    const event = await eventWith([
      { name: 'Thandi', phoneE164: staying },
      { name: 'Sipho', phoneE164: going },
    ])

    await replaceWitnesses(prisma, event.id, [{ name: 'Thandi', phoneE164: staying }])

    const after = await witnessesForEvent(prisma, event.id)
    expect(after.map((row) => row.phoneE164)).toEqual([staying])
  })
})

describe('the public page', () => {
  it('names those who agreed, and nobody else', async () => {
    const yes = nextPhone()
    const no = nextPhone()
    const silent = nextPhone()

    const event = await eventWith([
      { name: 'Thandi Ngcobo', phoneE164: yes },
      { name: 'Sipho Mthembu', phoneE164: no },
      { name: 'Mandla Zulu', phoneE164: silent },
    ])

    const saved = await witnessesForEvent(prisma, event.id)
    const idFor = (phone: string) =>
      saved.find((row) => row.phoneE164 === phone)?.id ?? ''

    await respondToInvite(prisma, {
      token: await inviteFor(event.id, idFor(yes)),
      answer: 'accept',
    })
    await respondToInvite(prisma, {
      token: await inviteFor(event.id, idFor(no)),
      answer: 'decline',
    })

    await publishDraft(prisma, { id: event.id, organiserId })
    const published = await publicEventBySlug(prisma, event.slug)

    expect(published?.witnesses).toEqual(['Thandi Ngcobo'])

    // Honour, not audit: no phone number, no count, and nothing about the two
    // who said no or said nothing.
    const rendered = JSON.stringify(published)
    expect(rendered).not.toContain(yes)
    expect(rendered).not.toContain(no)
    expect(rendered).not.toContain('Sipho Mthembu')
    expect(rendered).not.toContain('Mandla Zulu')
  })

  it('carries nobody at all until somebody agrees', async () => {
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])
    await publishDraft(prisma, { id: event.id, organiserId })

    expect((await publicEventBySlug(prisma, event.slug))?.witnesses).toEqual([])
  })

  it('publishes with an invitation outstanding', async () => {
    // Deliberate: blocking a funeral page on somebody else tapping a link —
    // somebody who may be travelling to the same funeral — is a worse failure
    // than publishing with an invitation outstanding. The page shows only those
    // who agreed, so nothing claims an acceptance that has not happened.
    const event = await eventWith([{ name: 'Thandi', phoneE164: nextPhone() }])

    expect(await publishDraft(prisma, { id: event.id, organiserId })).toBe(true)
  })
})
