import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'

import { clientFor } from '../setup/prisma'
import { uniqueRefCode } from '../setup/reference'

/**
 * CLAUDE.md rule 1, at the database layer.
 *
 * The rule is enforced in three places — database, type system, runtime render
 * guard. This file tests the first, and the first is the one that still holds
 * when a row arrives from a migration, a seed script, or a person at a psql
 * prompt. Getting it wrong on a real funeral is not recoverable.
 */

let prisma: PrismaClient
let organiserId: string

beforeAll(async () => {
  prisma = clientFor(inject('appDatabaseUrl'))

  const organiser = await prisma.organiser.create({
    data: { phoneE164: '+27820000001', displayName: 'Nomsa Mthembu' },
  })
  organiserId = organiser.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

let slugCounter = 0
const nextSlug = () => `test-slug-${String(++slugCounter).padStart(4, '0')}-aaaaaaaaaaaa`

describe('bereavement events cannot carry a target', () => {
  it('rejects a target on a funeral', async () => {
    await expect(
      prisma.event.create({
        data: {
          organiserId,
          slug: nextSlug(),
          archetype: 'umngcwabo',
          archetypeGroup: 'bereavement',
          refPrefix: 'TST',
          refCode: uniqueRefCode(),
          title: 'Umngcwabo kaMaMthembu',
          targetAmountCents: 5000_00n,
        },
      }),
    ).rejects.toThrow(/events_bereavement_has_no_target/)
  })

  it('accepts a funeral with no target', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Umngcwabo kaMaMthembu',
      },
    })

    expect(event.targetAmountCents).toBeNull()
  })

  // The constraint has to survive an update, not only an insert. An event
  // created as a wedding and later corrected to a funeral is a realistic path,
  // and it is the one where a target would already be sitting in the row.
  it('rejects a target added to an existing funeral by update', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Umngcwabo',
      },
    })

    await expect(
      prisma.event.update({
        where: { id: event.id },
        data: { targetAmountCents: 1000_00n },
      }),
    ).rejects.toThrow(/events_bereavement_has_no_target/)
  })

  it('rejects a wedding being switched to a funeral while it still has a target', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'umshado',
        archetypeGroup: 'union',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Umshado',
        targetAmountCents: 5000_00n,
      },
    })

    await expect(
      prisma.event.update({
        where: { id: event.id },
        data: { archetype: 'umngcwabo', archetypeGroup: 'bereavement' },
      }),
    ).rejects.toThrow(/events_bereavement_has_no_target/)
  })

  it('allows a target on a wedding', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'umshado',
        archetypeGroup: 'union',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Umshado kaThandi noSipho',
        targetAmountCents: 5000_00n,
      },
    })

    expect(event.targetAmountCents).toBe(5000_00n)
  })

  it('rejects a target of zero, on any archetype', async () => {
    await expect(
      prisma.event.create({
        data: {
          organiserId,
          slug: nextSlug(),
          archetype: 'itiye',
          archetypeGroup: 'gathering',
          refPrefix: 'TST',
          refCode: uniqueRefCode(),
          title: 'Itiye',
          targetAmountCents: 0n,
        },
      }),
    ).rejects.toThrow(/events_target_is_positive/)
  })
})

/**
 * `archetype_group` is denormalised so that the bereavement CHECK can be written
 * in pure SQL. A denormalised column that is allowed to drift is worse than no
 * column at all: an event could claim to be a wedding while carrying the funeral
 * group, or — the direction that matters — carry the wedding group while being a
 * funeral, and be handed a progress bar.
 */
describe('archetype and archetype_group cannot disagree', () => {
  it('rejects a funeral labelled as a union', async () => {
    await expect(
      prisma.event.create({
        data: {
          organiserId,
          slug: nextSlug(),
          archetype: 'umngcwabo',
          archetypeGroup: 'union',
          refPrefix: 'TST',
          refCode: uniqueRefCode(),
          title: 'Mislabelled',
        },
      }),
    ).rejects.toThrow(/events_archetype_matches_group/)
  })

  it('rejects a wedding labelled as bereavement', async () => {
    await expect(
      prisma.event.create({
        data: {
          organiserId,
          slug: nextSlug(),
          archetype: 'umshado',
          archetypeGroup: 'bereavement',
          refPrefix: 'TST',
          refCode: uniqueRefCode(),
          title: 'Mislabelled',
        },
      }),
    ).rejects.toThrow(/events_archetype_matches_group/)
  })

  it('rejects the group being changed away from its key by update', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Umngcwabo',
      },
    })

    await expect(
      prisma.event.update({ where: { id: event.id }, data: { archetypeGroup: 'union' } }),
    ).rejects.toThrow(/events_archetype_matches_group/)
  })

  // Every key, so a new archetype added later without a mapping fails loudly
  // here rather than silently defaulting.
  it.each([
    ['umshado', 'union'],
    ['umembeso', 'union'],
    ['umngcwabo', 'bereavement'],
    ['umbuyiso', 'remembrance'],
    ['imbeleko', 'arrival'],
    ['graduation', 'achievement'],
    ['itiye', 'gathering'],
  ] as const)('accepts %s in group %s', async (archetype, archetypeGroup) => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype,
        archetypeGroup,
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Valid',
      },
    })

    expect(event.archetypeGroup).toBe(archetypeGroup)
  })

  it('applies the same agreement rule to a collection occasion', async () => {
    await expect(
      prisma.collection.create({
        data: {
          organiserId,
          occasionArchetype: 'umngcwabo',
          occasionArchetypeGroup: 'gathering',
          title: 'The cousins in Johannesburg',
        },
      }),
    ).rejects.toThrow(/collections_archetype_matches_group/)
  })
})

/**
 * Part D2.8: a contribution belongs to an event or to a collection. A standalone
 * collection has no event, so `event_id` is nullable — and without the
 * constraint, nullable quietly becomes orphaned.
 */
describe('a contribution belongs to exactly one parent', () => {
  it('rejects a contribution with neither an event nor a collection', async () => {
    await expect(
      prisma.contribution.create({
        data: {
          contributorName: 'MaDlamini',
          type: 'cash',
          amountCents: 200_00n,
          verificationSource: 'organiser_confirmed',
        },
      }),
    ).rejects.toThrow(/contributions_belong_to_exactly_one_parent/)
  })

  it('rejects a contribution attached to both', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Umngcwabo',
      },
    })
    const collection = await prisma.collection.create({
      data: {
        organiserId,
        occasionArchetype: 'umngcwabo',
        occasionArchetypeGroup: 'bereavement',
        title: 'The cousins',
      },
    })

    await expect(
      prisma.contribution.create({
        data: {
          eventId: event.id,
          collectionId: collection.id,
          contributorName: 'MaDlamini',
          type: 'cash',
          amountCents: 200_00n,
          verificationSource: 'organiser_confirmed',
        },
      }),
    ).rejects.toThrow(/contributions_belong_to_exactly_one_parent/)
  })

  it('accepts a contribution on an event alone', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Umngcwabo',
      },
    })

    const contribution = await prisma.contribution.create({
      data: {
        eventId: event.id,
        contributorName: 'MaDlamini',
        type: 'cash',
        amountCents: 200_00n,
        verificationSource: 'organiser_confirmed',
      },
    })

    expect(contribution.collectionId).toBeNull()
  })

  it('accepts a contribution on a standalone collection alone', async () => {
    const collection = await prisma.collection.create({
      data: {
        organiserId,
        occasionArchetype: 'umngcwabo',
        occasionArchetypeGroup: 'bereavement',
        title: 'The cousins in Johannesburg',
      },
    })

    const contribution = await prisma.contribution.create({
      data: {
        collectionId: collection.id,
        contributorName: 'Sanele',
        type: 'cash',
        amountCents: 500_00n,
        verificationSource: 'organiser_confirmed',
      },
    })

    expect(contribution.eventId).toBeNull()
  })

  it('rejects a cash contribution with no amount', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'itiye',
        archetypeGroup: 'gathering',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Itiye',
      },
    })

    await expect(
      prisma.contribution.create({
        data: {
          eventId: event.id,
          contributorName: 'MaDlamini',
          type: 'cash',
          verificationSource: 'organiser_confirmed',
        },
      }),
    ).rejects.toThrow(/contributions_cash_has_an_amount/)
  })

  // In-kind is the core of what isipheko means, not a lesser case. A tent with
  // no rand value attached must be a first-class row.
  it('accepts an in-kind contribution with no amount', async () => {
    const event = await prisma.event.create({
      data: {
        organiserId,
        slug: nextSlug(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'TST',
        refCode: uniqueRefCode(),
        title: 'Umngcwabo',
      },
    })

    const contribution = await prisma.contribution.create({
      data: {
        eventId: event.id,
        contributorName: 'Bab’ Radebe',
        type: 'in_kind',
        verificationSource: 'organiser_confirmed',
      },
    })

    expect(contribution.amountCents).toBeNull()
  })
})
