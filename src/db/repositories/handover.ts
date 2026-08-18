import type { PrismaClient } from '../generated/client.ts'
import { confirmHandover } from './collection.ts'
import {
  canAcknowledge,
  checkHandoverToken,
  generateHandoverToken,
  handoverTokenExpiresAt,
  hashHandoverToken,
  type HandoverTokenKind,
  type TokenRejection,
} from '../../domain/handover/index.ts'

/**
 * Handover links, and what happens when somebody taps one.
 *
 * **The host does nothing in the system** (rule 15). A witness — one of the
 * group, standing there — taps once on their own phone, and the record closes
 * with their name against it. If nobody can, the organiser closes it on her own
 * word and the record says which it was.
 *
 * The token is a capability in a URL, which docs/decisions.md M2-04 §3 refused
 * for undo. It is refused there and allowed here for a reason recorded in
 * M2-11: undo is a fifteen-second capability on a page the person is already
 * looking at, so a cookie works; a witness link has to reach a different
 * person's phone, and no cookie travels. What limits it is that it is single
 * use, expiring, scoped to one collection and one member, and confirms a
 * handover and nothing else. **No money moves** (rule 12).
 *
 * Relative imports, like the other repositories a script has to load — see
 * docs/decisions.md M2-01 §8.
 */

export interface IssuedToken {
  readonly id: string
  /**
   * The only time the token itself exists. The database holds its SHA-256, so a
   * dump yields no usable link — the same posture as a session (M1-06).
   */
  readonly token: string
  readonly expiresAt: Date
}

export type IssueOutcome =
  | { readonly ok: true; readonly issued: IssuedToken }
  | {
      readonly ok: false
      readonly reason: 'not-found' | 'not-a-member' | 'already-closed'
    }

/**
 * Asks one of the group to be the one who confirms it.
 *
 * The organiser picks who will be there; the link is hers to pass on the way
 * she already talks to these people. **Nothing sends it** — no BSP exists
 * (M2-08), and a WhatsApp template nobody can exercise is worse than an obvious
 * gap (M2-08 §6).
 *
 * Issuing again replaces the previous unredeemed link for that member: plans
 * change, and two live links for one person is a capability nobody is tracking.
 */
export async function issueWitnessToken(
  db: PrismaClient,
  {
    collectionId,
    memberId,
    organiserId,
    now = new Date(),
  }: { collectionId: string; memberId: string; organiserId: string; now?: Date },
): Promise<IssueOutcome> {
  const collection = await db.collection.findFirst({
    where: { id: collectionId, organiserId },
    select: { handoverStatus: true, members: { select: { id: true } } },
  })

  if (collection === null) return { ok: false, reason: 'not-found' }
  if (collection.handoverStatus !== 'not_started') {
    return { ok: false, reason: 'already-closed' }
  }

  // A witness is one of the contributors, present at the handover (Part D2.4).
  // Not the family, and not a stranger the organiser typed in.
  if (!collection.members.some((member) => member.id === memberId)) {
    return { ok: false, reason: 'not-a-member' }
  }

  const token = generateHandoverToken()
  const expiresAt = handoverTokenExpiresAt(now)

  await db.$transaction(async (tx) => {
    await tx.handoverToken.deleteMany({
      where: { collectionId, memberId, kind: 'witness', redeemedAt: null },
    })

    await tx.handoverToken.create({
      data: {
        collectionId,
        memberId,
        kind: 'witness',
        tokenHash: hashHandoverToken(token),
        expiresAt,
      },
    })
  })

  const issued = await db.handoverToken.findUniqueOrThrow({
    where: { tokenHash: hashHandoverToken(token) },
    select: { id: true },
  })

  return { ok: true, issued: { id: issued.id, token, expiresAt } }
}

/**
 * The optional one-tap acknowledgement for the family.
 *
 * **Never required** (rule 15). It exists so a host who wants to say "it
 * reached us" can, in one tap and with no account. Nothing waits on it: the
 * record is already closed by the time this link means anything, and no ledger
 * entry follows it.
 */
export async function issueHostToken(
  db: PrismaClient,
  {
    collectionId,
    organiserId,
    now = new Date(),
  }: { collectionId: string; organiserId: string; now?: Date },
): Promise<IssueOutcome> {
  const collection = await db.collection.findFirst({
    where: { id: collectionId, organiserId },
    select: { id: true },
  })

  if (collection === null) return { ok: false, reason: 'not-found' }

  const token = generateHandoverToken()
  const expiresAt = handoverTokenExpiresAt(now)

  await db.$transaction(async (tx) => {
    await tx.handoverToken.deleteMany({
      where: { collectionId, kind: 'host', redeemedAt: null },
    })

    await tx.handoverToken.create({
      data: {
        collectionId,
        kind: 'host',
        tokenHash: hashHandoverToken(token),
        expiresAt,
      },
    })
  })

  const issued = await db.handoverToken.findUniqueOrThrow({
    where: { tokenHash: hashHandoverToken(token) },
    select: { id: true },
  })

  return { ok: true, issued: { id: issued.id, token, expiresAt } }
}

export interface TokenSubject {
  readonly kind: HandoverTokenKind
  readonly collectionId: string
  readonly collectionTitle: string
  readonly collectionSlug: string | null
  readonly organiserName: string | null
  readonly memberName: string | null
  readonly handoverStatus: string
  readonly alreadyClosed: boolean
}

/**
 * What a link points at, without spending it.
 *
 * The page a witness opens has to say what they are confirming before they tap,
 * and reading must not consume the capability — somebody who opens the link,
 * loses signal and opens it again has not used up their one tap.
 */
export async function handoverTokenSubject(
  db: PrismaClient,
  { token, now = new Date() }: { token: string; now?: Date },
): Promise<
  | { readonly ok: true; readonly subject: TokenSubject }
  | { readonly ok: false; readonly reason: TokenRejection | 'not-found' }
> {
  const row = await db.handoverToken.findUnique({
    where: { tokenHash: hashHandoverToken(token) },
    select: {
      kind: true,
      expiresAt: true,
      redeemedAt: true,
      collectionId: true,
      member: { select: { name: true } },
      collection: {
        select: {
          title: true,
          slug: true,
          handoverStatus: true,
          organiser: { select: { displayName: true } },
        },
      },
    },
  })

  if (row === null) return { ok: false, reason: 'not-found' }

  const check = checkHandoverToken(row, now)
  if (!check.ok) return { ok: false, reason: check.reason }

  return {
    ok: true,
    subject: {
      kind: row.kind,
      collectionId: row.collectionId,
      collectionTitle: row.collection.title,
      collectionSlug: row.collection.slug,
      organiserName: row.collection.organiser.displayName,
      memberName: row.member?.name ?? null,
      handoverStatus: row.collection.handoverStatus,
      alreadyClosed: row.collection.handoverStatus !== 'not_started',
    },
  }
}

export type RedeemOutcome =
  | {
      readonly ok: true
      readonly collectionId: string
      readonly collectionSlug: string | null
    }
  | {
      readonly ok: false
      readonly reason: TokenRejection | 'not-found' | 'not-confirmable'
    }

/**
 * The tap itself.
 *
 * Spending the token is a **conditional update** on `redeemed_at` being null —
 * two taps on a slow connection, or a link forwarded to somebody else, redeem
 * once. That single statement is the whole mitigation for the capability living
 * in a URL.
 *
 * The ledger entry is written by `confirmHandover` (M2-09), which is itself
 * conditional on the handover not having been closed, so the two guards are the
 * one thing twice over: the token cannot be spent twice, and even if it were,
 * one entry.
 */
export async function redeemWitnessToken(
  db: PrismaClient,
  { token, now = new Date() }: { token: string; now?: Date },
): Promise<RedeemOutcome> {
  const hash = hashHandoverToken(token)

  const row = await db.handoverToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      kind: true,
      expiresAt: true,
      redeemedAt: true,
      collectionId: true,
      memberId: true,
      member: { select: { name: true } },
      collection: { select: { slug: true } },
    },
  })

  if (row === null || row.kind !== 'witness') return { ok: false, reason: 'not-found' }

  const check = checkHandoverToken(row, now)
  if (!check.ok) return { ok: false, reason: check.reason }

  const { count } = await db.handoverToken.updateMany({
    where: { id: row.id, redeemedAt: null },
    data: { redeemedAt: now },
  })

  // Somebody tapped it a moment ago.
  if (count !== 1) return { ok: false, reason: 'already-used' }

  const outcome = await confirmHandover(db, {
    collectionId: row.collectionId,
    confirmedBy: 'witness',
    confirmedByName: row.member?.name ?? null,
    confirmedByMemberId: row.memberId,
    now,
  })

  if (!outcome.ok) return { ok: false, reason: 'not-confirmable' }

  return {
    ok: true,
    collectionId: row.collectionId,
    collectionSlug: row.collection.slug,
  }
}

/**
 * The family saying it reached them.
 *
 * **Writes no ledger entry.** The record was closed when the handover was
 * confirmed; this is an extra line on it, not a better one, and treating it as
 * the thing that completes a handover would make the host's action required —
 * which rule 15 forbids and Part D2.4 designed around.
 */
export async function redeemHostToken(
  db: PrismaClient,
  { token, now = new Date() }: { token: string; now?: Date },
): Promise<RedeemOutcome> {
  const row = await db.handoverToken.findUnique({
    where: { tokenHash: hashHandoverToken(token) },
    select: {
      id: true,
      kind: true,
      expiresAt: true,
      redeemedAt: true,
      collectionId: true,
      collection: { select: { slug: true, handoverStatus: true } },
    },
  })

  if (row === null || row.kind !== 'host') return { ok: false, reason: 'not-found' }

  const check = checkHandoverToken(row, now)
  if (!check.ok) return { ok: false, reason: check.reason }

  // Acknowledging a handover nobody has confirmed would be the family
  // confirming something that has not happened.
  if (!canAcknowledge(row.collection.handoverStatus)) {
    return { ok: false, reason: 'not-confirmable' }
  }

  const { count } = await db.handoverToken.updateMany({
    where: { id: row.id, redeemedAt: null },
    data: { redeemedAt: now },
  })

  if (count !== 1) return { ok: false, reason: 'already-used' }

  await db.collection.updateMany({
    where: { id: row.collectionId },
    data: { hostAcknowledgedAt: now },
  })

  return {
    ok: true,
    collectionId: row.collectionId,
    collectionSlug: row.collection.slug,
  }
}

/** Prunes links nobody can use. They are capabilities, not evidence. */
export async function pruneHandoverTokens(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await db.handoverToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { redeemedAt: { not: null } }] },
  })

  return count
}
