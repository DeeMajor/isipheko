import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import { check, parseLookup } from '@/db/repositories/check'
import { createDraft, publishDraft, replaceNeeds } from '@/db/repositories/event'
import { allocateContributionReference } from '@/db/repositories/reference'
import { allowCheck, clearCheckLimits } from '@/lib/check-rate-limit'

import { clientFor } from '../setup/prisma'

/**
 * `/check` against a real Postgres — the independent answer to *"is this
 * real?"* (M3-05, built with M3-04).
 *
 * Three properties, and the second is the one somebody would otherwise find by
 * accident: it **resolves by code and by slug**, it **exposes nothing the
 * public page does not**, and **a draft answers exactly like a code nobody was
 * issued** — because a lookup that distinguished them would be the one way to
 * discover a page a family has not shared.
 */

let prisma: PrismaClient
let organiserId: string

let phoneCounter = 0
const nextPhone = () => `+2785${String(1_000_000 + ++phoneCounter).slice(-7)}`

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

async function published(): Promise<{ id: string; slug: string; reference: string }> {
  const draft = await createDraft(prisma, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  await replaceNeeds(prisma, draft.id, [{ label: 'Tent', note: 'Around R1 200' }])
  await prisma.witness.create({
    data: { eventId: draft.id, name: 'Thandi', phoneE164: nextPhone() },
  })
  await publishDraft(prisma, { id: draft.id, organiserId })

  const row = await prisma.event.findUniqueOrThrow({
    where: { id: draft.id },
    select: { refPrefix: true, refCode: true },
  })

  return { ...draft, reference: `${row.refPrefix}-${row.refCode}` }
}

describe('what somebody can type in', () => {
  it('reads a reference code, however they wrote it down', () => {
    expect(parseLookup('MTH-4K7B2X')).toEqual({
      kind: 'reference',
      prefix: 'MTH',
      code: '4K7B2X',
    })
    expect(parseLookup('mth 4k7b2x')).toEqual({
      kind: 'reference',
      prefix: 'MTH',
      code: '4K7B2X',
    })
    // Crockford's aliases: O is 0, I and L are 1 (M2-02 §3).
    expect(parseLookup('MTH-4OG1BX')).toEqual({
      kind: 'reference',
      prefix: 'MTH',
      code: '40G1BX',
    })
  })

  it('reads a whole link, because pasting one is the careful thing to do', () => {
    const slug = 'AbCdEf0123456789'

    expect(parseLookup(`https://isipheko.co.za/e/${slug}`)).toEqual({
      kind: 'slug',
      slug,
    })
    expect(parseLookup(`isipheko.co.za/e/${slug}/contribute`)).toEqual({
      kind: 'slug',
      slug,
    })
    expect(parseLookup(slug)).toEqual({ kind: 'slug', slug })
  })

  it('refuses anything that is neither', () => {
    expect(parseLookup('')).toBeNull()
    expect(parseLookup('   ')).toBeNull()
    expect(parseLookup('hello')).toBeNull()
    expect(parseLookup('MTH-4K7B2')).toBeNull()
  })
})

describe('the answer', () => {
  it('resolves a published event by its code', async () => {
    const event = await published()
    const lookup = parseLookup(event.reference)

    expect(lookup).not.toBeNull()
    const result = await check(prisma, lookup!)

    expect(result?.title).toBe('Nokuthula Mthembu')
    expect(result?.organiserName).toBe('Nomsa Mthembu')
    expect(result?.verifiedAt).toEqual(new Date('2026-08-12T00:00:00.000Z'))
  })

  it('resolves the same event by its slug', async () => {
    const event = await published()

    expect((await check(prisma, { kind: 'slug', slug: event.slug }))?.reference).toBe(
      event.reference,
    )
  })

  it('resolves a contribution code to the event behind it', async () => {
    // Somebody holding the reference off their own payment is the person most
    // likely to be checking, and the event is what they are asking about.
    const event = await published()
    const contribution = await prisma.contribution.create({
      data: {
        eventId: event.id,
        contributorName: 'Thandi',
        type: 'cash',
        amountCents: 20_000n,
        verificationSource: 'organiser_confirmed',
      },
      select: { id: true },
    })

    const reference = await allocateContributionReference(prisma, {
      contributionId: contribution.id,
      title: 'Nokuthula Mthembu',
    })

    const result = await check(prisma, {
      kind: 'reference',
      prefix: reference.prefix,
      code: reference.code,
    })

    expect(result?.title).toBe('Nokuthula Mthembu')
    // And it answers about the event, never about their contribution.
    expect(result?.reference).toBe(event.reference)
  })

  it('exposes nothing the public page does not', async () => {
    const event = await published()
    const result = await check(prisma, { kind: 'slug', slug: event.slug })

    // The whole shape, so a field added later has to be considered rather than
    // arriving by accident on an endpoint that takes no session.
    expect(Object.keys(result ?? {}).sort()).toEqual([
      'organiserName',
      'reference',
      'title',
      'verifiedAt',
    ])

    const rendered = JSON.stringify(result)
    expect(rendered).not.toContain('+2785')
    expect(rendered).not.toContain('Tent')
    expect(rendered).not.toContain('Thandi')
    expect(rendered).not.toMatch(/R\s?\d/)
  })
})

describe('what it will not answer', () => {
  it('says nothing about a draft, exactly as it says nothing about a wrong code', async () => {
    // M1-07 §7 made drafts unreachable. This must not become the exception
    // that finds them.
    const draft = await createDraft(prisma, {
      organiserId,
      archetype: 'umngcwabo',
      title: 'Not shared yet',
      subtitle: null,
      place: null,
      eventDate: null,
    })

    const row = await prisma.event.findUniqueOrThrow({
      where: { id: draft.id },
      select: { refPrefix: true, refCode: true },
    })

    expect(
      await check(prisma, {
        kind: 'reference',
        prefix: row.refPrefix,
        code: row.refCode,
      }),
    ).toBeNull()
    expect(await check(prisma, { kind: 'slug', slug: draft.slug })).toBeNull()

    // And a code nobody was issued gets the identical answer.
    expect(
      await check(prisma, { kind: 'reference', prefix: 'ZZZ', code: '000000' }),
    ).toBeNull()
  })
})

describe('the rate limit', () => {
  it('lets an ordinary person check, and stops a script', () => {
    clearCheckLimits()
    const now = new Date('2026-08-17T10:00:00.000Z')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(allowCheck('address-a', now, 5)).toBe(true)
    }

    expect(allowCheck('address-a', now, 5)).toBe(false)
    // Somebody else is unaffected: a family behind one NAT is ordinary, but a
    // different address is a different person.
    expect(allowCheck('address-b', now, 5)).toBe(true)
  })

  it('opens again once the window has passed', () => {
    clearCheckLimits()
    const now = new Date('2026-08-17T10:00:00.000Z')

    expect(allowCheck('address-c', now, 1)).toBe(true)
    expect(allowCheck('address-c', now, 1)).toBe(false)

    const later = new Date(now.getTime() + 60 * 60 * 1000 + 1)
    expect(allowCheck('address-c', later, 1)).toBe(true)
  })

  it('does not apply where there is no address to count against', () => {
    clearCheckLimits()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(allowCheck(null, new Date(), 1)).toBe(true)
    }
  })
})
