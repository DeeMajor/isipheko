import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import {
  collectionPageBySlug,
  confirmHandover,
  confirmMember,
  createCollection,
  joinCollection,
  openCollection,
} from '@/db/repositories/collection'
import {
  handoverTokenSubject,
  issueHostToken,
  issueWitnessToken,
  pruneHandoverTokens,
  redeemHostToken,
  redeemWitnessToken,
} from '@/db/repositories/handover'
import { entriesForChain } from '@/db/repositories/ledger'
import { verifyChain } from '@/domain/ledger'

import { clientFor } from '../setup/prisma'

/**
 * The handover against a real Postgres — Part D2.4's three ways it can close,
 * and the one thing all of them must have in common: **one ledger entry**.
 *
 * **The host takes no action.** A witness who was there taps once, or the
 * organiser closes it on her own word. The family's acknowledgement is optional,
 * comes afterward, and writes nothing to the chain — a host's tap that completed
 * a handover would make the host's action required, which rule 15 forbids.
 */

let app: PrismaClient
let phoneCounter = 300

beforeAll(() => {
  app = clientFor(inject('appDatabaseUrl'))
})

afterAll(async () => {
  await app.$disconnect()
})

const uniquePhone = () => `+2789${String(++phoneCounter).padStart(7, '0')}`

interface Fixture {
  readonly collectionId: string
  readonly organiserId: string
  readonly memberIds: readonly string[]
  readonly slug: string
}

/** A shared collection with two confirmed members, ready to hand over. */
async function ready(): Promise<Fixture> {
  const organiser = await organiserForPhone(app, uniquePhone())
  await app.organiser.update({
    where: { id: organiser.id },
    data: {
      displayName: 'Nomsa Mthembu',
      idVerificationStatus: 'verified',
      idVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
    },
  })

  const collection = await createCollection(app, {
    organiserId: organiser.id,
    archetype: 'umngcwabo',
    title: 'The Ngcobo cousins',
    purpose: 'The Mthembu family',
  })

  await openCollection(app, { id: collection.id, organiserId: organiser.id })

  const memberIds: string[] = []
  for (const [name, cents] of [
    ['Thandi Ngcobo', 80_000n],
    ['Sanele Mthembu', 70_000n],
  ] as const) {
    const joined = await joinCollection(app, {
      collectionId: collection.id,
      name,
      amountCents: cents,
    })
    if (!joined.ok) throw new Error('expected the join to succeed')

    memberIds.push(joined.memberId)
    await confirmMember(app, { memberId: joined.memberId, organiserId: organiser.id })
  }

  const slug = `hnd${Math.random().toString(36).slice(2, 13)}`
    .padEnd(16, '0')
    .slice(0, 16)
  await app.collection.update({ where: { id: collection.id }, data: { slug } })

  return { collectionId: collection.id, organiserId: organiser.id, memberIds, slug }
}

const entries = (collectionId: string) => entriesForChain(app, { collectionId })

describe('a witness closes it', () => {
  it('writes one entry, with their name against it, and the host does nothing', async () => {
    const fix = await ready()

    const issued = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    if (!issued.ok) throw new Error('expected a token')

    // Reading the page does not spend the link: signal fails at gravesides and
    // somebody may open it twice before tapping.
    expect((await handoverTokenSubject(app, { token: issued.issued.token })).ok).toBe(
      true,
    )
    expect((await handoverTokenSubject(app, { token: issued.issued.token })).ok).toBe(
      true,
    )

    const redeemed = await redeemWitnessToken(app, { token: issued.issued.token })
    expect(redeemed.ok).toBe(true)

    const chain = await entries(fix.collectionId)
    expect(chain).toHaveLength(1)
    expect(chain[0]?.entryType).toBe('collection')
    expect(chain[0]?.amountCents).toBe(150_000n)
    expect(verifyChain(fix.collectionId, chain).problems).toEqual([])

    const page = await collectionPageBySlug(app, fix.slug)
    expect(page?.handoverStatus).toBe('witness_confirmed')
    // A fact rather than a string somebody typed (M2-11).
    expect(page?.witnessName).toBe('Thandi Ngcobo')
    // Nothing was asked of the family, and nothing records them acting.
    expect(page?.hostAcknowledgedAt).toBeNull()
  })

  it('cannot be tapped twice, however the link travels', async () => {
    const fix = await ready()
    const issued = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    if (!issued.ok) throw new Error('expected a token')

    const [first, second] = await Promise.all([
      redeemWitnessToken(app, { token: issued.issued.token }),
      redeemWitnessToken(app, { token: issued.issued.token }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    // The single-use guard and the ledger's own guard are the same thing twice
    // over: one entry either way.
    expect(await entries(fix.collectionId)).toHaveLength(1)

    expect(await redeemWitnessToken(app, { token: issued.issued.token })).toEqual({
      ok: false,
      reason: 'already-used',
    })
  })

  it('refuses a link that has run out', async () => {
    const fix = await ready()
    const issued = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    if (!issued.ok) throw new Error('expected a token')

    await app.handoverToken.update({
      where: { id: issued.issued.id },
      data: { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
    })

    expect(await redeemWitnessToken(app, { token: issued.issued.token })).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(await entries(fix.collectionId)).toHaveLength(0)
  })

  it('refuses a made-up link without saying anything about a collection', async () => {
    expect(await redeemWitnessToken(app, { token: 'not-a-real-token' })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('can only be asked of somebody in the group', async () => {
    // A witness is one of the contributors, present at the handover (D2.4) —
    // not the family, and not a name the organiser typed in.
    const fix = await ready()
    const other = await ready()

    expect(
      await issueWitnessToken(app, {
        collectionId: fix.collectionId,
        memberId: other.memberIds[0] ?? '',
        organiserId: fix.organiserId,
      }),
    ).toEqual({ ok: false, reason: 'not-a-member' })
  })

  it('replaces a previous unused link for the same person', async () => {
    const fix = await ready()
    const first = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    const second = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    if (!first.ok || !second.ok) throw new Error('expected both to issue')

    // Plans change; two live links for one person is a capability nobody is
    // tracking.
    expect(await redeemWitnessToken(app, { token: first.issued.token })).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect((await redeemWitnessToken(app, { token: second.issued.token })).ok).toBe(true)
  })

  it('is not offered once the record is closed', async () => {
    const fix = await ready()
    await confirmHandover(app, {
      collectionId: fix.collectionId,
      confirmedBy: 'organiser',
    })

    expect(
      await issueWitnessToken(app, {
        collectionId: fix.collectionId,
        memberId: fix.memberIds[0] ?? '',
        organiserId: fix.organiserId,
      }),
    ).toEqual({ ok: false, reason: 'already-closed' })
  })
})

describe('the organiser closes it herself', () => {
  it('records that it was her word, and the record says so', async () => {
    const fix = await ready()

    const outcome = await confirmHandover(app, {
      collectionId: fix.collectionId,
      confirmedBy: 'organiser',
      confirmedByName: 'Nomsa Mthembu',
      confirmedByMemberId: null,
    })
    expect(outcome.ok).toBe(true)

    const page = await collectionPageBySlug(app, fix.slug)
    expect(page?.handoverStatus).toBe('organiser_evidenced')
    // Null is exactly this case: nobody was there to tap it.
    expect(page?.witnessName).toBeNull()

    expect(await entries(fix.collectionId)).toHaveLength(1)
  })
})

describe('the family acknowledges, or does not', () => {
  it('writes no ledger entry and does not change who closed the record', async () => {
    const fix = await ready()
    const witness = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[1] ?? '',
      organiserId: fix.organiserId,
    })
    if (!witness.ok) throw new Error('expected a token')
    await redeemWitnessToken(app, { token: witness.issued.token })

    const host = await issueHostToken(app, {
      collectionId: fix.collectionId,
      organiserId: fix.organiserId,
    })
    if (!host.ok) throw new Error('expected a token')

    expect((await redeemHostToken(app, { token: host.issued.token })).ok).toBe(true)

    const page = await collectionPageBySlug(app, fix.slug)
    // Still one entry, and still witnessed by the person who was there: the
    // family's tap is an extra line, not a better account (rule 15).
    expect(await entries(fix.collectionId)).toHaveLength(1)
    expect(page?.handoverStatus).toBe('witness_confirmed')
    expect(page?.witnessName).toBe('Sanele Mthembu')
    expect(page?.hostAcknowledgedAt).not.toBeNull()
  })

  it('cannot be tapped twice either', async () => {
    /*
     * Worth its own test: the witness path has a second guard behind it — the
     * ledger append refuses a handover that is already closed — so removing
     * the token's single-use check there changes only the message. **The host
     * path has no such guard.** Nothing else stops a forwarded acknowledgement
     * link being tapped again and again, so the conditional update is the only
     * thing making it single use, and this is what proves it.
     */
    const fix = await ready()
    await confirmHandover(app, {
      collectionId: fix.collectionId,
      confirmedBy: 'organiser',
    })

    const host = await issueHostToken(app, {
      collectionId: fix.collectionId,
      organiserId: fix.organiserId,
    })
    if (!host.ok) throw new Error('expected a token')

    // Two taps at once, on a link nobody has spent: the conditional update is
    // the only thing that can decide between them.
    const [first, second] = await Promise.all([
      redeemHostToken(app, { token: host.issued.token }),
      redeemHostToken(app, { token: host.issued.token }),
    ])
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)

    // And once more, long after: the read refuses it before the update does.
    expect(await redeemHostToken(app, { token: host.issued.token })).toEqual({
      ok: false,
      reason: 'already-used',
    })
  })

  it('cannot acknowledge a handover nobody has confirmed', async () => {
    const fix = await ready()
    const host = await issueHostToken(app, {
      collectionId: fix.collectionId,
      organiserId: fix.organiserId,
    })
    if (!host.ok) throw new Error('expected a token')

    expect(await redeemHostToken(app, { token: host.issued.token })).toEqual({
      ok: false,
      reason: 'not-confirmable',
    })
  })

  it('is never required for the handover to be complete', async () => {
    // The record closes without the family touching anything, which is the
    // whole of M2-11's done-criterion.
    const fix = await ready()
    const witness = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    if (!witness.ok) throw new Error('expected a token')

    await redeemWitnessToken(app, { token: witness.issued.token })

    const collection = await app.collection.findUniqueOrThrow({
      where: { id: fix.collectionId },
    })
    expect(collection.status).toBe('handed_over')
    expect(collection.hostAcknowledgedAt).toBeNull()
    expect(await entries(fix.collectionId)).toHaveLength(1)
  })

  it('refuses a witness link used as a host link, and the reverse', async () => {
    const fix = await ready()
    const witness = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    const host = await issueHostToken(app, {
      collectionId: fix.collectionId,
      organiserId: fix.organiserId,
    })
    if (!witness.ok || !host.ok) throw new Error('expected both to issue')

    expect(await redeemHostToken(app, { token: witness.issued.token })).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(await redeemWitnessToken(app, { token: host.issued.token })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })
})

describe('links are capabilities, not evidence', () => {
  it('prunes what has been spent or has run out', async () => {
    const fix = await ready()
    const issued = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    if (!issued.ok) throw new Error('expected a token')

    await redeemWitnessToken(app, { token: issued.issued.token })
    await pruneHandoverTokens(app)

    expect(
      await app.handoverToken.findUnique({ where: { id: issued.issued.id } }),
    ).toBeNull()
    // The record it closed is untouched: the ledger keeps that, not the link.
    expect(await entries(fix.collectionId)).toHaveLength(1)
  })

  it('never stores the token itself', async () => {
    const fix = await ready()
    const issued = await issueWitnessToken(app, {
      collectionId: fix.collectionId,
      memberId: fix.memberIds[0] ?? '',
      organiserId: fix.organiserId,
    })
    if (!issued.ok) throw new Error('expected a token')

    const row = await app.handoverToken.findUniqueOrThrow({
      where: { id: issued.issued.id },
    })

    // A database dump yields no usable link — the same posture as a session.
    expect(row.tokenHash).not.toBe(issued.issued.token)
    expect(JSON.stringify(row)).not.toContain(issued.issued.token)
  })
})
