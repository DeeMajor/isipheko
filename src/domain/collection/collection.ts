import { add, fromCents, zero, type Money } from '../money/index.ts'

/**
 * Collections — the second organiser role (implementation-plan Part D2).
 *
 * A guest rallies cousins, colleagues or a congregation; they pool into **her
 * own account**; she hands it over to the family as one act. The host does
 * nothing in the system (rule 15), and **no money passes through us** (rule 12).
 *
 * Three rules in this file are the ones that matter, and none of them is a
 * preference:
 *
 * **Verification gates sharing, not payout** (rule 13). We never hold the
 * money, so there is no payout to withhold; the absence of a shareable link is
 * the only leverage that exists. `canShare` is where that lives.
 *
 * **One ledger entry per collection, never one per member** (rule 14). Eight
 * beads would read as eight small gifts instead of one act by one group, and
 * the host would learn who among the cousins gave least — which is nobody's
 * business and not what the record is for.
 *
 * **A group claims a need item as a unit** (Part D2.5). Eight cousins jointly
 * bringing the tent is how families actually operate: unaffordable alone,
 * trivial together, and a better ledger entry than cash because a grieving
 * family still has to go and hire a tent.
 */

export type CollectionStatus = 'draft' | 'open' | 'closed' | 'handed_over' | 'abandoned'

export type CollectionMemberStatus = 'pending' | 'confirmed' | 'withdrawn'

export type HandoverStatus =
  'not_started' | 'witness_confirmed' | 'organiser_evidenced' | 'host_acknowledged'

export type MemberVisibility = 'public' | 'name_only' | 'anonymous'

/** Only what the rules need — never the Prisma row (rule 6). */
export interface CollectionState {
  readonly status: CollectionStatus
  readonly handoverStatus: HandoverStatus
  /** Null for a standalone collection; set for one attached to a host event. */
  readonly eventId: string | null
  /** Null until the organiser is verified — that is the whole share gate. */
  readonly slug: string | null
  readonly needItemId: string | null
}

export interface MemberState {
  readonly name: string
  readonly amount: Money | null
  readonly visibility: MemberVisibility
  readonly status: CollectionMemberStatus
}

/**
 * Whether a collection can be given a shareable link.
 *
 * **Nothing satisfies this today.** Identity verification is M3-01 and nothing
 * sets an organiser's status, so every collection created now is unshareable —
 * which is rule 13 working rather than failing. The alternative, a gate that
 * always passes, is worse than none because it looks like one (the same call
 * M1-07 §5 made about `canPublish`).
 */
export function canShare(organiser: { idVerificationStatus: string }): boolean {
  return organiser.idVerificationStatus === 'verified'
}

/** Somebody can join while it is open, and only then. */
export function canJoin(collection: CollectionState): boolean {
  return collection.status === 'open'
}

/**
 * Whether this collection may claim a need item as a unit.
 *
 * Attached only: a standalone collection has no host event, so there is no
 * board to claim from. One item, once — a collection that could hold two items
 * would be two groups' worth of reservation held by one group.
 */
export function canClaimAsGroup(collection: CollectionState): boolean {
  if (collection.eventId === null) return false
  if (collection.needItemId !== null) return false

  return collection.status === 'open'
}

/**
 * Whether the handover can be confirmed.
 *
 * Not from `draft` — nothing was collected — and not twice. `closed` and `open`
 * both qualify: a group that hands over while still open has still handed over,
 * and refusing that would make the record disagree with the day.
 */
export function canConfirmHandover(collection: CollectionState): boolean {
  if (collection.status === 'handed_over') return false
  if (collection.status === 'abandoned' || collection.status === 'draft') return false

  return collection.handoverStatus === 'not_started'
}

/** A member's contribution counts once they have confirmed it. */
export function countsTowardTotal(member: MemberState): boolean {
  return member.status === 'confirmed'
}

/**
 * What the collection's single ledger entry is worth.
 *
 * Confirmed members only: `pending` is somebody who said they would and has not
 * yet, and putting that on a host's page would be the record claiming money
 * that has not moved.
 *
 * Members with no amount are in-kind participation — they are part of the group
 * and part of the bead, and they add nothing to the sum.
 */
export function groupLedgerAmount(members: readonly MemberState[]): Money | null {
  const confirmed = members.filter(countsTowardTotal)
  const amounts = confirmed.flatMap((member) =>
    member.amount === null ? [] : [member.amount],
  )

  if (amounts.length === 0) return null

  return amounts.reduce((total, amount) => add(total, amount), zero)
}

/**
 * The names the group bead opens to reveal.
 *
 * Anonymous members are counted and not named — they are in the group, and the
 * bead says how many people are inside it. Withdrawn members are neither.
 *
 * **No amounts.** The bead opens to names, not to a breakdown: the host learns
 * that the cousins stood with them, not who among the cousins gave least.
 */
export interface GroupMembers {
  readonly names: readonly string[]
  /** Everyone confirmed, including those who chose not to be named. */
  readonly count: number
}

export function visibleMembers(members: readonly MemberState[]): GroupMembers {
  const confirmed = members.filter(countsTowardTotal)

  return {
    names: confirmed
      .filter((member) => member.visibility !== 'anonymous')
      .map((member) => member.name),
    count: confirmed.length,
  }
}

/**
 * Where a collection's ledger entry belongs.
 *
 * **One chain, never two.** An attached collection's entry goes on the host
 * event's chain, because that is what makes it appear on the host page as a
 * single entry; a standalone collection's goes on its own. A reasonable person
 * might expect an attached collection to keep its own chain as well — it must
 * not. Two chains would be two records of one act, and the ledger's entire
 * claim is that there is one. See docs/decisions.md M2-09.
 */
export type CollectionChain =
  { readonly eventId: string } | { readonly collectionId: string }

export function chainFor(
  collection: CollectionState,
  collectionId: string,
): CollectionChain {
  return collection.eventId === null ? { collectionId } : { eventId: collection.eventId }
}

/**
 * What the entry says was brought, when a group claimed something.
 *
 * "The Ngcobo cousins — the tent" is specific, memorable and reciprocable in a
 * way that "R5 000" is not (Part D2.5). The description is hashed into the
 * chain (M2-01 §1), so this string is part of the trust artefact rather than a
 * label.
 */
export function groupInKindDescription(title: string, item: string): string {
  return `${title} — ${item}`
}

/** Cents in, `Money` out, for the one caller that reads a raw column. */
export function memberAmount(cents: bigint | null): Money | null {
  return cents === null ? null : fromCents(cents)
}
