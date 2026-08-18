import { describe, expect, it } from 'vitest'

import { archetypeCollectionCopy, collectionCopy } from '@/copy/collection'
import { ARCHETYPES, type ArchetypeKey } from '@/domain/archetype'
import {
  canClaimAsGroup,
  canConfirmHandover,
  canJoin,
  canShare,
  chainFor,
  countsTowardTotal,
  groupInKindDescription,
  groupLedgerAmount,
  memberAmount,
  visibleMembers,
  type CollectionState,
  type MemberState,
} from '@/domain/collection'
import { fromCents, toCents } from '@/domain/money'

/**
 * The rules a collection lives by.
 *
 * Three of them are the reason this part of the product is safe rather than
 * merely useful, and all three are asserted here rather than inferred from a
 * screen: verification gates *sharing* (rule 13), one entry per collection and
 * never one per member (rule 14), and a member's amount is nobody's business
 * but the group's.
 */

const OPEN: CollectionState = {
  status: 'open',
  handoverStatus: 'not_started',
  eventId: null,
  slug: null,
  needItemId: null,
}

const member = (over: Partial<MemberState> = {}): MemberState => ({
  name: 'Thandi Ngcobo',
  amount: fromCents(20_000n),
  visibility: 'public',
  status: 'confirmed',
  ...over,
})

describe('the share gate', () => {
  it('opens only for an organiser whose identity has been checked', () => {
    expect(canShare({ idVerificationStatus: 'verified' })).toBe(true)
    expect(canShare({ idVerificationStatus: 'unverified' })).toBe(false)
    expect(canShare({ idVerificationStatus: 'pending' })).toBe(false)
    expect(canShare({ idVerificationStatus: 'failed' })).toBe(false)
  })

  it('is the only leverage there is, because we never hold the money', () => {
    // Rule 13. With a host we could withhold a payout; with a collection she
    // already has the money before we could object, so the link is the whole
    // of it. Nothing in this file gates anything else on verification.
    expect(canJoin({ ...OPEN })).toBe(true)
    expect(canConfirmHandover({ ...OPEN })).toBe(true)
  })
})

describe('joining', () => {
  it('is possible while it is open and at no other time', () => {
    expect(canJoin({ ...OPEN, status: 'open' })).toBe(true)
    expect(canJoin({ ...OPEN, status: 'draft' })).toBe(false)
    expect(canJoin({ ...OPEN, status: 'closed' })).toBe(false)
    expect(canJoin({ ...OPEN, status: 'handed_over' })).toBe(false)
    expect(canJoin({ ...OPEN, status: 'abandoned' })).toBe(false)
  })
})

describe('claiming a need item as a group', () => {
  const attached: CollectionState = { ...OPEN, eventId: 'event-1' }

  it('needs a host board to claim from', () => {
    expect(canClaimAsGroup(attached)).toBe(true)
    // A standalone collection has no event page and therefore no board.
    expect(canClaimAsGroup({ ...attached, eventId: null })).toBe(false)
  })

  it('is one item, once', () => {
    // Two items held by one group is two groups' worth of reservation.
    expect(canClaimAsGroup({ ...attached, needItemId: 'item-1' })).toBe(false)
  })

  it('is not possible before it opens or after it ends', () => {
    expect(canClaimAsGroup({ ...attached, status: 'draft' })).toBe(false)
    expect(canClaimAsGroup({ ...attached, status: 'handed_over' })).toBe(false)
  })

  it('names the group and the thing, which is the point of it', () => {
    // "The Ngcobo cousins — the tent" is specific, memorable and reciprocable
    // in a way that "R5 000" is not (Part D2.5), and it is hashed into the
    // chain, so it is part of the trust artefact rather than a label.
    expect(groupInKindDescription('The Ngcobo cousins', 'Tent')).toBe(
      'The Ngcobo cousins — Tent',
    )
  })
})

describe('the handover', () => {
  it('can be confirmed once, from open or closed', () => {
    expect(canConfirmHandover({ ...OPEN, status: 'open' })).toBe(true)
    expect(canConfirmHandover({ ...OPEN, status: 'closed' })).toBe(true)
  })

  it('cannot be confirmed twice', () => {
    expect(canConfirmHandover({ ...OPEN, handoverStatus: 'witness_confirmed' })).toBe(
      false,
    )
    expect(canConfirmHandover({ ...OPEN, status: 'handed_over' })).toBe(false)
  })

  it('cannot be confirmed for a draft or an abandoned group', () => {
    expect(canConfirmHandover({ ...OPEN, status: 'draft' })).toBe(false)
    expect(canConfirmHandover({ ...OPEN, status: 'abandoned' })).toBe(false)
  })
})

describe('one chain, never two', () => {
  it('puts an attached collection on the host event chain', () => {
    // Which is what makes it render on the host page as a single entry.
    expect(chainFor({ ...OPEN, eventId: 'event-1' }, 'collection-1')).toEqual({
      eventId: 'event-1',
    })
  })

  it('gives a standalone collection its own', () => {
    expect(chainFor({ ...OPEN, eventId: null }, 'collection-1')).toEqual({
      collectionId: 'collection-1',
    })
  })

  it('never returns both', () => {
    // Two chains would be two records of one act, and the ledger's entire
    // claim is that there is one. A reasonable person expects an attached
    // collection to keep its own chain as well; it must not.
    for (const eventId of ['event-1', null]) {
      const chain = chainFor({ ...OPEN, eventId }, 'collection-1')

      expect(Object.keys(chain)).toHaveLength(1)
    }
  })
})

describe('what the one entry is worth', () => {
  it('sums the members who have actually confirmed', () => {
    const amount = groupLedgerAmount([
      member({ amount: fromCents(20_000n) }),
      member({ amount: fromCents(30_000n) }),
    ])

    expect(amount === null ? null : toCents(amount)).toBe(50_000n)
  })

  it('leaves out somebody who said they would and has not', () => {
    // Putting a pending member on a host's page would be the record claiming
    // money that has not moved.
    const amount = groupLedgerAmount([
      member({ amount: fromCents(20_000n) }),
      member({ amount: fromCents(30_000n), status: 'pending' }),
      member({ amount: fromCents(90_000n), status: 'withdrawn' }),
    ])

    expect(amount === null ? null : toCents(amount)).toBe(20_000n)
  })

  it('is null for a group that brought a thing rather than money', () => {
    // In-kind participation: part of the group, no amount to add.
    expect(groupLedgerAmount([member({ amount: null })])).toBeNull()
    expect(groupLedgerAmount([])).toBeNull()
  })

  it('counts a member exactly once, whatever else is true of them', () => {
    expect(countsTowardTotal(member({ status: 'confirmed' }))).toBe(true)
    expect(countsTowardTotal(member({ status: 'pending' }))).toBe(false)
    expect(countsTowardTotal(member({ status: 'withdrawn' }))).toBe(false)
  })

  it('reads cents into Money and nothing else', () => {
    expect(memberAmount(null)).toBeNull()
    expect(toCents(memberAmount(1_500n) ?? fromCents(0n))).toBe(1_500n)
  })
})

describe('who the bead opens to reveal', () => {
  it('names the members who chose to be named', () => {
    const visible = visibleMembers([
      member({ name: 'Thandi' }),
      member({ name: 'Sipho' }),
    ])

    expect(visible.names).toEqual(['Thandi', 'Sipho'])
    expect(visible.count).toBe(2)
  })

  it('counts somebody who gave quietly without naming them', () => {
    // They are in the group, and the bead says how many people are inside it.
    const visible = visibleMembers([
      member({ name: 'Thandi' }),
      member({ name: 'Quiet giver', visibility: 'anonymous' }),
    ])

    expect(visible.names).toEqual(['Thandi'])
    expect(visible.count).toBe(2)
  })

  it('leaves out somebody who withdrew, in both', () => {
    const visible = visibleMembers([
      member({ name: 'Thandi' }),
      member({ name: 'Gone', status: 'withdrawn' }),
    ])

    expect(visible.names).toEqual(['Thandi'])
    expect(visible.count).toBe(1)
  })

  it('reveals no amounts at all', () => {
    // The bead opens to names, not to a breakdown: the host learns that the
    // cousins stood with them, not who among the cousins gave least.
    const visible = visibleMembers([member({ amount: fromCents(500_000n) })])

    expect(JSON.stringify(visible)).not.toContain('500000')
    expect(Object.keys(visible).sort()).toEqual(['count', 'names'])
  })
})

describe('the honesty requirement', () => {
  it('says who holds the money, by name', () => {
    // Part D2.6. The contributors are trusting her, not us, and copy that
    // implied otherwise would be the one dishonest thing in the product.
    const line = collectionCopy.holdsTheMoney('Nomsa Mthembu')

    expect(line).toContain('Nomsa Mthembu')
    expect(line).toContain('her own account')
    expect(line.toLowerCase()).toContain('isipheko does not hold it')
  })

  it('claims nothing about holding, protecting or refunding', () => {
    const strings = [
      collectionCopy.holdsTheMoney('Nomsa Mthembu'),
      collectionCopy.holdsTheMoneyShort('Nomsa Mthembu'),
      collectionCopy.whatWeDo,
      collectionCopy.shareBlocked,
      collectionCopy.handover.hostDoesNothing,
      ...(Object.keys(ARCHETYPES) as ArchetypeKey[]).flatMap((key) => [
        archetypeCollectionCopy[key].purposeLead,
        archetypeCollectionCopy[key].beadNote,
      ]),
    ]

    for (const line of strings) {
      const lower = line.toLowerCase()

      // Nothing that implies we are between the group and the money.
      expect(lower, line).not.toContain('we hold')
      expect(lower, line).not.toContain('held safely')
      expect(lower, line).not.toContain('protected')
      expect(lower, line).not.toContain('guarantee')
      expect(lower, line).not.toContain('escrow')
      // "cannot refund" is the honest sentence; "we refund" is not.
      expect(lower, line).not.toMatch(/\bwe (can )?refund/)
    }
  })

  it('says plainly that the host does nothing', () => {
    // Rule 15: the handover cannot depend on somebody who is not in the system.
    expect(collectionCopy.handover.hostDoesNothing.toLowerCase()).toContain(
      'does not have to do anything',
    )
  })

  it('does not use a celebratory register for a bereavement occasion', () => {
    for (const key of ['umngcwabo', 'umbuyiso'] as const) {
      const copy = archetypeCollectionCopy[key]

      expect(copy.beadNote.toLowerCase(), key).toContain('stood together')
      expect(copy.beadNote.toLowerCase(), key).not.toContain('gave together')
      expect(copy.purposeLead.toLowerCase(), key).toContain('family')
    }

    expect(archetypeCollectionCopy.umshado.beadNote.toLowerCase()).toContain(
      'gave together',
    )
  })

  it('says the link is gated, why, and what to do about it', () => {
    // Until M3-01 this said the check was not switched on, which was true and
    // left her at a refusal with nothing to do. The gate is unchanged; what
    // changed is that there is now a way through it.
    const blocked = collectionCopy.shareBlocked.toLowerCase()

    expect(blocked).toContain('cannot be shared yet')
    expect(blocked).toContain('identity has been checked')
    expect(blocked).not.toContain('not switched on')
  })
})
