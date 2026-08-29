import type { PrismaClient } from '../generated/client.ts'
import { appendEntryWithin } from './ledger.ts'
import { claimItem, withdrawClaim } from './needs.ts'
import { ARCHETYPES } from '../../domain/archetype/archetypes.ts'
import type { ArchetypeKey } from '../../domain/archetype/config.ts'
import {
  canClaimAsGroup,
  canConfirmHandover,
  canJoin,
  canShare,
  chainFor,
  groupInKindDescription,
  groupLedgerAmount,
  memberAmount,
  visibleMembers,
  type HandoverStatus,
  type MemberState,
  type MemberVisibility,
} from '../../domain/collection/index.ts'
// Straight at the module rather than the barrel: `src/domain/event/index.ts`
// re-exports values without file extensions, which plain Node cannot resolve
// (M2-08 §11 records the same for the archetype barrel).
import { generateSlug } from '../../domain/event/slug.ts'
import { toCents } from '../../domain/money/index.ts'

/**
 * Collections: the group, its members, its claim on the board, and the one
 * ledger entry it eventually produces.
 *
 * **There is no money path here and there must never be one** (rule 12). The
 * organiser holds what the group put in, in her own account; `organiserBankHint`
 * is free text — *"Nomsa's Capitec, ending 4471"* — so members know where to
 * send it. The moment that becomes an account we can verify or pay into, rule
 * 12 is gone and the regulatory position goes with it. An integration test
 * asserts the absence structurally, against the live schema.
 *
 * Relative imports, like the other repositories a script has to load — see
 * docs/decisions.md M2-01 §8.
 */

export interface CreateCollectionInput {
  readonly organiserId: string
  readonly archetype: ArchetypeKey
  readonly title: string
  readonly purpose?: string | null
  /** Attached to a host event, or standalone (Part D2.3). */
  readonly eventId?: string | null
  /** Display only. Never an account we hold, verify or pay into. */
  readonly organiserBankHint?: string | null
}

export async function createCollection(
  db: PrismaClient,
  input: CreateCollectionInput,
): Promise<{ id: string }> {
  const config = ARCHETYPES[input.archetype]

  return db.collection.create({
    data: {
      organiserId: input.organiserId,
      occasionArchetype: input.archetype,
      // Denormalised, and a CHECK refuses a pair that disagrees. Read from the
      // config rather than from a form, so the two cannot (M1-07 §10).
      occasionArchetypeGroup: config.group,
      title: input.title,
      purpose: input.purpose ?? null,
      eventId: input.eventId ?? null,
      organiserBankHint: input.organiserBankHint ?? null,
      // No slug until the organiser is verified. That is the share gate.
      slug: null,
      status: 'draft',
    },
    select: { id: true },
  })
}

/** Draft → open. Members can only join an open collection. */
export async function openCollection(
  db: PrismaClient,
  { id, organiserId }: { id: string; organiserId: string },
): Promise<boolean> {
  const { count } = await db.collection.updateMany({
    where: { id, organiserId, status: 'draft' },
    data: { status: 'open' },
  })

  return count === 1
}

export type ShareOutcome =
  | { readonly ok: true; readonly slug: string }
  | {
      readonly ok: false
      readonly reason: 'not-found' | 'not-verified' | 'already-shared'
    }

/**
 * Gives a collection its shareable link — **the one thing verification gates**
 * (rule 13).
 *
 * We never hold the money, so there is no payout to withhold. The absence of a
 * link is the only leverage that exists, and it is real leverage: a collection
 * that cannot be shared cannot ask anybody for anything.
 *
 * **Nothing satisfies this today.** M3-01 sets `idVerificationStatus` and M3-01
 * does not exist, so every call returns `not-verified`. That is the gate
 * working. A flag that always passed would be worse than no gate, because it
 * would look like one (M1-07 §5).
 */
export async function shareCollection(
  db: PrismaClient,
  { id, organiserId }: { id: string; organiserId: string },
): Promise<ShareOutcome> {
  const collection = await db.collection.findFirst({
    where: { id, organiserId },
    select: { slug: true, organiser: { select: { idVerificationStatus: true } } },
  })

  if (collection === null) return { ok: false, reason: 'not-found' }
  if (collection.slug !== null) return { ok: false, reason: 'already-shared' }
  if (!canShare(collection.organiser)) return { ok: false, reason: 'not-verified' }

  const slug = generateSlug()
  await db.collection.updateMany({
    where: { id, organiserId, slug: null },
    data: { slug },
  })

  return { ok: true, slug }
}

export interface JoinInput {
  readonly collectionId: string
  readonly name: string
  readonly phoneE164?: string | null
  /** Null for in-kind participation: part of the group, no amount. */
  readonly amountCents?: bigint | null
  readonly visibility?: MemberVisibility
}

export type JoinOutcome =
  | { readonly ok: true; readonly memberId: string }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-open' }

/**
 * Somebody joining the group.
 *
 * **No account, ever** (rule 4). A name, optionally a number so the organiser
 * can reach them, optionally an amount. Members arrive `pending` and confirm —
 * a person who said they would put in R200 and has not yet is not part of what
 * the record says reached the family.
 */
export async function joinCollection(
  db: PrismaClient,
  input: JoinInput,
): Promise<JoinOutcome> {
  const collection = await db.collection.findUnique({
    where: { id: input.collectionId },
    select: {
      status: true,
      handoverStatus: true,
      eventId: true,
      slug: true,
      needItemId: true,
    },
  })

  if (collection === null) return { ok: false, reason: 'not-found' }
  if (!canJoin(collection)) return { ok: false, reason: 'not-open' }

  const member = await db.collectionMember.create({
    data: {
      collectionId: input.collectionId,
      name: input.name,
      phoneE164: input.phoneE164 ?? null,
      amountCents: input.amountCents ?? null,
      visibility: input.visibility ?? 'public',
      status: 'pending',
    },
    select: { id: true },
  })

  return { ok: true, memberId: member.id }
}

/** The organiser marking that somebody's money actually arrived with her. */
export async function confirmMember(
  db: PrismaClient,
  { memberId, organiserId }: { memberId: string; organiserId: string },
): Promise<boolean> {
  const { count } = await db.collectionMember.updateMany({
    where: { id: memberId, status: 'pending', collection: { organiserId } },
    data: { status: 'confirmed' },
  })

  return count === 1
}

export async function withdrawMember(
  db: PrismaClient,
  { memberId }: { memberId: string },
): Promise<boolean> {
  const { count } = await db.collectionMember.updateMany({
    where: { id: memberId, status: { in: ['pending', 'confirmed'] } },
    data: { status: 'withdrawn' },
  })

  return count === 1
}

export type GroupClaimOutcome =
  | { readonly ok: true; readonly claimId: string }
  | {
      readonly ok: false
      readonly reason: 'not-found' | 'not-claimable' | 'wrong-event' | 'conflict'
    }

/**
 * The group claiming a need item **as a unit** (Part D2.5).
 *
 * Eight cousins jointly bringing the tent is how families actually operate:
 * unaffordable alone, trivial together. It also produces a better ledger entry
 * than cash — *"The Ngcobo cousins — the tent"* is specific and reciprocable,
 * and a grieving family with R5 000 still has to go and hire a tent.
 *
 * **The whole item, through the same reservation everybody else uses.** The
 * quantity taken is everything still needed, and it goes through M2-03's
 * conditional UPDATE rather than a second path — because two paths reserving
 * one tent is how two families arrive with one tent (M2-03 §1).
 */
export async function claimAsGroup(
  db: PrismaClient,
  {
    collectionId,
    organiserId,
    needItemId,
    now = new Date(),
  }: { collectionId: string; organiserId: string; needItemId: string; now?: Date },
): Promise<GroupClaimOutcome> {
  const collection = await db.collection.findFirst({
    where: { id: collectionId, organiserId },
    select: {
      status: true,
      handoverStatus: true,
      eventId: true,
      slug: true,
      needItemId: true,
      title: true,
      organiser: { select: { phoneE164: true } },
    },
  })

  if (collection === null) return { ok: false, reason: 'not-found' }
  if (!canClaimAsGroup(collection)) {
    return { ok: false, reason: 'not-claimable' }
  }

  const item = await db.needItem.findUnique({
    where: { id: needItemId },
    select: { eventId: true, quantityRequired: true, quantityClaimed: true },
  })

  if (item === null) return { ok: false, reason: 'not-found' }
  // A collection attached to one umcimbi cannot claim from another's board.
  if (item.eventId !== collection.eventId) return { ok: false, reason: 'wrong-event' }

  const remaining = item.quantityRequired - item.quantityClaimed
  if (remaining < 1) return { ok: false, reason: 'conflict' }

  const claim = await claimItem(db, {
    needItemId,
    // As a unit: whatever is still needed, taken whole.
    quantity: remaining,
    claimantName: collection.title,
    claimantPhoneE164: collection.organiser.phoneE164,
    collectionId,
    now,
  })

  if (!claim.ok) return { ok: false, reason: 'conflict' }

  // Conditional on the collection still holding no item, so two taps cannot
  // reserve two items for one group. The reservation above is already safe;
  // this keeps the collection's own record honest.
  const { count } = await db.collection.updateMany({
    where: { id: collectionId, needItemId: null },
    data: { needItemId },
  })

  if (count !== 1) {
    // Somebody claimed a different item in the meantime. Give this one back
    // rather than holding a tent nobody's collection is pointing at.
    await withdrawClaim(db, claim.claimId)
    return { ok: false, reason: 'conflict' }
  }

  return { ok: true, claimId: claim.claimId }
}

export type HandoverConfirmedBy = 'witness' | 'organiser' | 'host'

const HANDOVER_STATUS: Record<HandoverConfirmedBy, HandoverStatus> = {
  witness: 'witness_confirmed',
  organiser: 'organiser_evidenced',
  host: 'host_acknowledged',
}

export type HandoverOutcome =
  | { readonly ok: true; readonly ledgerEntryId: string }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-confirmable' }

/**
 * The handover, and **the only thing that writes a collection to the ledger**.
 *
 * The entry is written when the money and the goods reach the family, not when
 * the collection closes. A collection that closed at R5 000 and never reached
 * anybody has not given the family R5 000, and a host's page showing that money
 * would be lying in the most damaging way available to this product.
 *
 * **One entry, on one chain.** Attached goes on the host event's chain, which
 * is what makes it render there as a single entry; standalone goes on its own.
 * Never both — two chains would be two records of one act, and the ledger's
 * whole claim is that there is one (docs/decisions.md M2-09).
 *
 * **One entry per collection, never one per member** (rule 14). Eight beads
 * would read as eight small gifts instead of one act by one group.
 *
 * The host does nothing here (rule 15): a witness confirms by default, the
 * organiser can confirm with evidence, and a one-tap host acknowledgement
 * exists but is never required. M2-11 builds that experience; this is the rule
 * and the append underneath it.
 */
export async function confirmHandover(
  db: PrismaClient,
  {
    collectionId,
    confirmedBy,
    confirmedByName,
    confirmedByMemberId,
    evidenceKey,
    now = new Date(),
  }: {
    collectionId: string
    confirmedBy: HandoverConfirmedBy
    confirmedByName?: string | null
    /**
     * The member who was there and tapped it. **Null is exactly the
     * organiser-marked case** — she closed it on her own word, and the record
     * says so for as long as the paper lasts (M2-11).
     */
    confirmedByMemberId?: string | null
    evidenceKey?: string | null
    now?: Date
  },
): Promise<HandoverOutcome> {
  return db.$transaction(async (tx) => {
    const collection = await tx.collection.findUnique({
      where: { id: collectionId },
      select: {
        status: true,
        handoverStatus: true,
        eventId: true,
        slug: true,
        needItemId: true,
        title: true,
        needItem: { select: { label: true } },
        members: {
          select: { name: true, amountCents: true, visibility: true, status: true },
        },
      },
    })

    if (collection === null) return { ok: false as const, reason: 'not-found' as const }
    if (!canConfirmHandover(collection)) {
      return { ok: false as const, reason: 'not-confirmable' as const }
    }

    const members: MemberState[] = collection.members.map((member) => ({
      name: member.name,
      amount: memberAmount(member.amountCents),
      visibility: member.visibility,
      status: member.status,
    }))

    const amount = groupLedgerAmount(members)

    const { count } = await tx.collection.updateMany({
      where: { id: collectionId, handoverStatus: 'not_started' },
      data: {
        status: 'handed_over',
        handoverStatus: HANDOVER_STATUS[confirmedBy],
        handoverConfirmedBy: confirmedByName ?? null,
        handoverConfirmedMemberId: confirmedByMemberId ?? null,
        handoverEvidenceKey: evidenceKey ?? null,
        handoverAt: now,
      },
    })

    // Somebody confirmed a moment ago. One handover, one entry.
    if (count !== 1) return { ok: false as const, reason: 'not-confirmable' as const }

    const entry = await appendEntryWithin(tx as PrismaClient, {
      chain: chainFor(collection, collectionId),
      entryType: 'collection',
      direction: 'credit',
      amountCents: amount,
      inKindDescription:
        collection.needItem === null
          ? null
          : groupInKindDescription(collection.title, collection.needItem.label),
      referenceId: collectionId,
      createdAt: now,
    })

    return { ok: true as const, ledgerEntryId: entry.id }
  })
}

/**
 * Releases what the group was holding and closes it.
 *
 * The item goes back on the board: a group claim does not expire on a timer —
 * a named organiser with a page is what replaces the seven-day hold — so this
 * is the thing that gives a tent back when the group falls through.
 */
export async function abandonCollection(
  db: PrismaClient,
  { id, organiserId }: { id: string; organiserId: string },
): Promise<boolean> {
  const claim = await db.needClaim.findFirst({
    where: { collectionId: id, status: 'claimed' },
    select: { id: true },
  })

  if (claim !== null) await withdrawClaim(db, claim.id)

  const { count } = await db.collection.updateMany({
    where: { id, organiserId, status: { in: ['draft', 'open', 'closed'] } },
    data: { status: 'abandoned', needItemId: null },
  })

  return count === 1
}

export interface CollectionView {
  readonly id: string
  readonly slug: string | null
  readonly archetype: ArchetypeKey
  readonly title: string
  readonly purpose: string | null
  readonly eventId: string | null
  readonly organiserName: string | null
  /** Display only, and free text. Never an account (rule 12). */
  readonly organiserBankHint: string | null
  readonly status: string
  readonly handoverStatus: HandoverStatus
  readonly needItem: { readonly id: string; readonly label: string } | null
  /** Names of members who chose to be named, and how many there are in total. */
  readonly members: { readonly names: readonly string[]; readonly count: number }
  /** What the group has confirmed, in cents. Never a balance we hold. */
  readonly confirmedCents: bigint | null
}

function toView(collection: {
  id: string
  slug: string | null
  occasionArchetype: ArchetypeKey
  title: string
  purpose: string | null
  eventId: string | null
  organiserBankHint: string | null
  status: string
  handoverStatus: HandoverStatus
  needItemId: string | null
  organiser: { displayName: string | null }
  needItem: { id: string; label: string } | null
  members: {
    name: string
    amountCents: bigint | null
    visibility: MemberVisibility
    status: string
  }[]
}): CollectionView {
  const members: MemberState[] = collection.members.map((member) => ({
    name: member.name,
    amount: memberAmount(member.amountCents),
    visibility: member.visibility,
    status: member.status as MemberState['status'],
  }))

  const amount = groupLedgerAmount(members)

  return {
    id: collection.id,
    slug: collection.slug,
    archetype: collection.occasionArchetype,
    title: collection.title,
    purpose: collection.purpose,
    eventId: collection.eventId,
    organiserName: collection.organiser.displayName,
    organiserBankHint: collection.organiserBankHint,
    status: collection.status,
    handoverStatus: collection.handoverStatus,
    needItem: collection.needItem,
    members: visibleMembers(members),
    confirmedCents: amount === null ? null : toCents(amount),
  }
}

/**
 * Whether she attached a photograph to her own handover (M4-01b).
 *
 * **Deliberately not on `CollectionView`.** `CollectionPage` extends that type,
 * so a field added there appears on the public page — and whether a photograph
 * exists is between the organiser and whoever later reviews the record, not
 * something a link publishes.
 *
 * A boolean, never the key. Nothing renders the photograph yet, and the surface
 * that eventually should is the reviewer's rather than a public page's: a key on
 * a view is a key one render away from a URL.
 */
export async function handoverHasEvidence(
  db: PrismaClient,
  { id, organiserId }: { id: string; organiserId: string },
): Promise<boolean> {
  const row = await db.collection.findFirst({
    where: { id, organiserId },
    select: { handoverEvidenceKey: true },
  })

  return row?.handoverEvidenceKey != null
}

const VIEW_SELECT = {
  id: true,
  slug: true,
  occasionArchetype: true,
  title: true,
  purpose: true,
  eventId: true,
  organiserBankHint: true,
  status: true,
  handoverStatus: true,
  needItemId: true,
  organiser: { select: { displayName: true } },
  needItem: { select: { id: true, label: true } },
  members: {
    select: { name: true, amountCents: true, visibility: true, status: true },
  },
} as const

/**
 * A standalone collection, by the slug it was shared with.
 *
 * It resolves with its own archetype — a collection always names an occasion,
 * which drives the tone and the copy, even when no host event page exists
 * (Part D2.3). A collection with no slug has never been shareable and answers
 * the same as one that does not exist.
 */
export async function collectionBySlug(
  db: PrismaClient,
  slug: string,
): Promise<CollectionView | null> {
  const collection = await db.collection.findFirst({
    where: { slug, status: { not: 'draft' } },
    select: VIEW_SELECT,
  })

  return collection === null ? null : toView(collection)
}

/** For the organiser's own screens, where the slug may not exist yet. */
export async function collectionForOrganiser(
  db: PrismaClient,
  { id, organiserId }: { id: string; organiserId: string },
): Promise<CollectionView | null> {
  const collection = await db.collection.findFirst({
    where: { id, organiserId },
    select: VIEW_SELECT,
  })

  return collection === null ? null : toView(collection)
}

/**
 * Every collection this organiser runs, for her account screen (UX-04).
 *
 * Before this, `/account` listed nothing: an organiser who lost the tab had no
 * way back to her collection at all. Titles and a closed/open fact only — the
 * screen links, it does not summarise.
 */
export async function collectionsForOrganiser(
  db: PrismaClient,
  organiserId: string,
): Promise<readonly { id: string; title: string; isClosed: boolean }[]> {
  const collections = await db.collection.findMany({
    where: { organiserId },
    // The id makes the order total (M3-07b §3): `created_at` is milliseconds
    // and two rows created in one can come back either way round otherwise.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, title: true, handoverStatus: true },
  })

  return collections.map((collection) => ({
    id: collection.id,
    title: collection.title,
    isClosed: collection.handoverStatus !== 'not_started',
  }))
}

/** Every collection attached to one umcimbi, for the host's page. */
export async function collectionsForEvent(
  db: PrismaClient,
  eventId: string,
): Promise<readonly CollectionView[]> {
  const collections = await db.collection.findMany({
    where: { eventId, status: { not: 'draft' } },
    orderBy: { createdAt: 'asc' },
    select: VIEW_SELECT,
  })

  return collections.map(toView)
}

export interface RosterMember {
  readonly id: string
  /** Null for somebody who joined quietly. The amount still counts. */
  readonly name: string | null
  readonly amountCents: bigint | null
  readonly status: string
  readonly joinedAt: Date
}

export interface CollectionPage extends CollectionView {
  /**
   * The group's own roster, **with amounts**.
   *
   * This is the asymmetry M2-10 settled: the host's page shows one bead that
   * opens to names and no breakdown, and the group's own page shows what each
   * of them put in. These are people who know each other and whose total has to
   * add up for them. Somebody who joined quietly is quiet from the wider world,
   * not from the eight cousins — their name is withheld and their amount is
   * still in the list, because hiding both would make the group's own total
   * unauditable to the group itself.
   */
  readonly roster: readonly RosterMember[]
  /** The occasion, when there is a host page behind it. */
  readonly event: {
    readonly slug: string
    readonly title: string
    readonly reference: string
  } | null
  /** Set only when it is true. Never softened into "coming soon" (M1-08 §5). */
  readonly organiserVerifiedAt: Date | null

  /**
   * The member who confirmed the handover, by name.
   *
   * Null is exactly the organiser-marked case — she closed it on her own word.
   * The incwadi says which for as long as the paper lasts (M2-11).
   */
  readonly witnessName: string | null
  readonly handoverAt: Date | null
  /** The family's optional acknowledgement. Nothing ever waited on it. */
  readonly hostAcknowledgedAt: Date | null
}

/**
 * Everything the collection's own page draws.
 *
 * By slug, and a collection only has a slug once its organiser was verified —
 * so this read is only ever reachable for a collection that passed the share
 * gate (rule 13). That is why the verified line on the page can be stated as
 * fact rather than hedged.
 */
export async function collectionPageBySlug(
  db: PrismaClient,
  slug: string,
): Promise<CollectionPage | null> {
  const collection = await db.collection.findFirst({
    where: { slug, status: { not: 'draft' } },
    select: {
      ...VIEW_SELECT,
      createdAt: true,
      handoverAt: true,
      hostAcknowledgedAt: true,
      handoverConfirmedMember: { select: { name: true } },
      organiser: { select: { displayName: true, idVerifiedAt: true } },
      event: { select: { slug: true, title: true, refPrefix: true, refCode: true } },
      members: {
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true,
          name: true,
          amountCents: true,
          visibility: true,
          status: true,
          joinedAt: true,
        },
      },
    },
  })

  if (collection === null) return null

  const view = toView(collection)

  return {
    ...view,
    organiserName: collection.organiser.displayName,
    organiserVerifiedAt: collection.organiser.idVerifiedAt,
    witnessName: collection.handoverConfirmedMember?.name ?? null,
    handoverAt: collection.handoverAt,
    hostAcknowledgedAt: collection.hostAcknowledgedAt,
    event:
      collection.event === null
        ? null
        : {
            slug: collection.event.slug,
            title: collection.event.title,
            reference: `${collection.event.refPrefix}-${collection.event.refCode}`,
          },
    roster: collection.members
      .filter((member) => member.status !== 'withdrawn')
      .map((member) => ({
        id: member.id,
        // Quiet from the wider world, not from the group's own total.
        name: member.visibility === 'anonymous' ? null : member.name,
        amountCents: member.amountCents,
        status: member.status,
        joinedAt: member.joinedAt,
      })),
  }
}
