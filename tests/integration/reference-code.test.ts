import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { createDraft } from '@/db/repositories/event'
import {
  allocateContributionReference,
  allocateEventReference,
  resolveReference,
} from '@/db/repositories/reference'
import { organiserForPhone } from '@/db/repositories/auth'
import { formatReference, parseReference } from '@/domain/reference'

import { clientFor } from '../setup/prisma'

/**
 * Reference codes against the index that actually enforces them.
 *
 * The unique index on `(ref_prefix, ref_code)` is what makes "no collisions"
 * true — the generator only makes it unlikely. So the interesting tests here
 * are the ones where a code is already taken.
 */

let prisma: PrismaClient
let organiserId: string
let phoneCounter = 0

beforeAll(async () => {
  prisma = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(
    prisma,
    `+2784${String(++phoneCounter).padStart(7, '0')}`,
  )
  organiserId = organiser.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function newEvent(
  title = 'Nokuthula Mthembu',
): Promise<{ id: string; slug: string }> {
  return createDraft(prisma, {
    organiserId,
    archetype: 'umngcwabo',
    title,
    subtitle: null,
    place: null,
    eventDate: null,
  })
}

describe('every event gets a code when it is created', () => {
  it('has one, in the right shape, without anybody asking', async () => {
    const draft = await newEvent()
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: draft.id },
      select: { refPrefix: true, refCode: true },
    })

    // The trust panel tells a contributor to type this into /check themselves.
    // An event without one has nothing to offer that instruction.
    expect(event.refPrefix).toBe('NOK')
    expect(event.refCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/)
  })

  it('resolves back to the event it belongs to', async () => {
    const draft = await newEvent()
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: draft.id },
      select: { refPrefix: true, refCode: true },
    })

    const formatted = formatReference({
      prefix: event.refPrefix,
      code: event.refCode,
    })

    expect(await resolveReference(prisma, formatted)).toEqual({
      kind: 'event',
      id: draft.id,
      slug: draft.slug,
    })
  })

  it('resolves however it was typed', async () => {
    const draft = await newEvent()
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: draft.id },
      select: { refPrefix: true, refCode: true },
    })
    const formatted = formatReference({ prefix: event.refPrefix, code: event.refCode })

    for (const typed of [
      formatted,
      formatted.toLowerCase(),
      formatted.replace('-', ' '),
      formatted.replace('-', ''),
    ]) {
      expect(await resolveReference(prisma, typed), typed).toMatchObject({
        kind: 'event',
        id: draft.id,
      })
    }
  })

  it('resolves with O typed for zero and L typed for one', async () => {
    // The correction to the done-criteria: Crockford's own aliases, which are
    // the substitutions somebody makes reading a code off a screen.
    const draft = await newEvent()
    await prisma.event.update({
      where: { id: draft.id },
      data: { refPrefix: 'MTH', refCode: '40G1BX' },
    })

    for (const typed of ['MTH-40G1BX', 'mth-4og1bx', 'MTH-4OG1BX', 'MTH-4OGLBX']) {
      expect(await resolveReference(prisma, typed), typed).toMatchObject({
        kind: 'event',
        id: draft.id,
      })
    }
  })
})

describe('allocation when the code is already taken', () => {
  it('retries past a collision rather than failing', async () => {
    const taken = await newEvent()
    await prisma.event.update({
      where: { id: taken.id },
      data: { refPrefix: 'NOK', refCode: 'TAKEN1' },
    })

    // A real collision is about a one-in-a-billion draw, so it is forced here.
    // The retry is the thing that makes "no duplicates" true rather than
    // likely, and untested retry logic in that path is where a silent bug goes.
    const draws = ['TAKEN1', 'TAKEN1', 'FREE01']
    let index = 0

    const other = await newEvent()
    const allocated = await allocateEventReference(prisma, {
      eventId: other.id,
      title: 'Nokuthula Mthembu',
      generate: () => draws[index++] ?? 'FREE02',
    })

    expect(allocated.code).toBe('FREE01')
    expect(allocated.formatted).toBe('NOK-FREE01')
    expect(index).toBe(3)
  })

  it('gives up loudly rather than looping when every draw is taken', async () => {
    const taken = await newEvent()
    await prisma.event.update({
      where: { id: taken.id },
      data: { refPrefix: 'NOK', refCode: 'ALLGON' },
    })

    const other = await newEvent()

    // A generator that always returns the same code is not bad luck — it is a
    // seeded or broken generator, and the message says so.
    await expect(
      allocateEventReference(prisma, {
        eventId: other.id,
        title: 'Nokuthula Mthembu',
        generate: () => 'ALLGON',
      }),
    ).rejects.toThrow(/fixed seed/)
  })

  it('refuses a duplicate pair at the database, not just in code', async () => {
    const first = await newEvent()
    const second = await newEvent()

    await prisma.event.update({
      where: { id: first.id },
      data: { refPrefix: 'DUP', refCode: 'ABCDEF' },
    })

    // This is the guarantee. Everything else is an optimisation on top of it.
    await expect(
      prisma.event.update({
        where: { id: second.id },
        data: { refPrefix: 'DUP', refCode: 'ABCDEF' },
      }),
    ).rejects.toThrow(/Unique constraint/i)
  })

  it('allocates a hundred codes with the same prefix and no duplicates', async () => {
    const events = await Promise.all(
      Array.from({ length: 100 }, () => newEvent('Thandiwe Ngcobo')),
    )

    const allocated = await Promise.all(
      events.map((event) =>
        allocateEventReference(prisma, { eventId: event.id, title: 'Thandiwe Ngcobo' }),
      ),
    )

    const codes = new Set(allocated.map((reference) => reference.code))

    expect(allocated.every((reference) => reference.prefix === 'THA')).toBe(true)
    expect(codes.size).toBe(100)
  })
})

describe('contributions', () => {
  it('get their own code, resolving to the contribution', async () => {
    const event = await newEvent()
    const contribution = await prisma.contribution.create({
      data: {
        eventId: event.id,
        contributorName: 'Thandi Ngcobo',
        type: 'cash',
        amountCents: 50_000n,
        verificationSource: 'organiser_confirmed',
      },
      select: { id: true },
    })

    const reference = await allocateContributionReference(prisma, {
      contributionId: contribution.id,
      title: 'Nokuthula Mthembu',
    })

    expect(await resolveReference(prisma, reference.formatted)).toEqual({
      kind: 'contribution',
      id: contribution.id,
    })
  })

  it('do not collide with an event holding the same pair', async () => {
    // Both tables are searched, events first. A contribution sharing a pair
    // with an event would be unreachable — so the shape of the answer matters.
    const event = await newEvent()
    const stored = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { refPrefix: true, refCode: true },
    })

    const contribution = await prisma.contribution.create({
      data: {
        eventId: event.id,
        contributorName: 'Thandi Ngcobo',
        type: 'cash',
        amountCents: 1_000n,
        verificationSource: 'organiser_confirmed',
        refPrefix: stored.refPrefix,
        refCode: stored.refCode,
      },
      select: { id: true },
    })

    const resolved = await resolveReference(
      prisma,
      formatReference({ prefix: stored.refPrefix, code: stored.refCode }),
    )

    // Documented behaviour rather than an accident: the event wins.
    expect(resolved).toMatchObject({ kind: 'event', id: event.id })
    expect(contribution.id).toBeDefined()
  })
})

describe('nonsense', () => {
  it('resolves to nothing rather than to something', async () => {
    for (const input of ['', 'not a code', 'MTH-40G1B', 'MTH-40G1BU']) {
      expect(await resolveReference(prisma, input), input).toBeNull()
      expect(parseReference(input)).toBeNull()
    }
  })

  it('resolves a well-formed code nobody was issued to nothing', async () => {
    expect(await resolveReference(prisma, 'QQQ-ZZZZZY')).toBeNull()
  })
})
