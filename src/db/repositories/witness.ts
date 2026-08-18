import type { PrismaClient } from '../generated/client.ts'
import {
  checkInvite,
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  statusForAnswer,
  type InviteAnswer,
  type InviteRejection,
  type WitnessStatus,
} from '../../domain/witness/index.ts'

/**
 * Asking somebody to stand with a family, and taking their answer.
 *
 * **Nothing is sent.** No SMS provider and no WhatsApp BSP exist (M1-06 §6,
 * M2-08 §12), so the organiser is given the link and passes it on the way she
 * already talks to these people — exactly what M2-11 §7 does with the handover
 * link, and for the same reason: a registered template nobody can exercise is
 * worse than an obvious gap.
 *
 * Relative imports with extensions, like the other repositories (M2-01 §8).
 */

export interface IssuedInvite {
  readonly witnessId: string
  readonly name: string
  /**
   * The only moment the token exists. The database holds its SHA-256, so a dump
   * yields no usable link.
   */
  readonly token: string
  readonly expiresAt: Date
}

export type IssueOutcome =
  | { readonly ok: true; readonly issued: IssuedInvite }
  | { readonly ok: false; readonly reason: 'not-found' | 'already-answered' }

/**
 * Issues a link for one umkhaphi.
 *
 * Issuing again **replaces** the previous one: plans change, a phone is lost,
 * and two live links for one person is a capability nobody is tracking
 * (M2-11 §7).
 *
 * Refused once they have answered. Re-asking somebody who already said yes is
 * noise; re-asking somebody who said no is the organiser's to do deliberately,
 * by removing them and asking again, rather than by a button that quietly
 * reopens a question they have closed.
 */
export async function issueWitnessInvite(
  db: PrismaClient,
  {
    witnessId,
    eventId,
    organiserId,
    now = new Date(),
  }: { witnessId: string; eventId: string; organiserId: string; now?: Date },
): Promise<IssueOutcome> {
  const witness = await db.witness.findFirst({
    where: { id: witnessId, eventId, event: { is: { organiserId } } },
    select: { id: true, name: true, status: true },
  })

  if (witness === null) return { ok: false, reason: 'not-found' }
  if (witness.status !== 'invited') return { ok: false, reason: 'already-answered' }

  const token = generateInviteToken()
  const expiresAt = inviteExpiresAt(now)

  await db.witness.update({
    where: { id: witness.id },
    data: { inviteTokenHash: hashInviteToken(token), inviteExpiresAt: expiresAt },
  })

  return {
    ok: true,
    issued: { witnessId: witness.id, name: witness.name, token, expiresAt },
  }
}

export interface InviteSubject {
  readonly witnessId: string
  readonly witnessName: string
  readonly eventId: string
  readonly eventTitle: string
  readonly archetype: string
  readonly organiserName: string | null
  readonly status: WitnessStatus
  /** Null once answered — the link is spent and the row keeps no expiry. */
  readonly expiresAt: Date | null
}

/**
 * Who a link is about, **without spending it**.
 *
 * Signal fails, and somebody who opens the link, loses the connection and opens
 * it again has not used up their answer. Only the POST decides anything — the
 * distinction M2-11 §2 had to learn the hard way, where re-reading a spent
 * token told the person who had just tapped correctly that their link was
 * already used.
 */
export async function witnessForToken(
  db: PrismaClient,
  token: string,
): Promise<InviteSubject | null> {
  const witness = await db.witness.findUnique({
    where: { inviteTokenHash: hashInviteToken(token) },
    select: {
      id: true,
      name: true,
      status: true,
      inviteExpiresAt: true,
      event: {
        select: {
          id: true,
          title: true,
          archetype: true,
          organiser: { select: { displayName: true } },
        },
      },
    },
  })

  if (witness === null) return null

  return {
    witnessId: witness.id,
    witnessName: witness.name,
    eventId: witness.event.id,
    eventTitle: witness.event.title,
    archetype: witness.event.archetype,
    organiserName: witness.event.organiser.displayName,
    status: witness.status,
    expiresAt: witness.inviteExpiresAt,
  }
}

export type RespondOutcome =
  | { readonly ok: true; readonly status: WitnessStatus }
  | { readonly ok: false; readonly reason: InviteRejection | 'not-found' }

/**
 * Yes or no, once.
 *
 * The answer is a **conditional update** on the row still being `invited`, so
 * two taps racing on a slow connection produce one answer and the loser is told
 * it is already answered rather than overwriting it. The same shape as every
 * other decision in this product (M2-03 §1, M2-11 §8).
 *
 * **A decision is final until the organiser issues a new link** — a link that
 * kept toggling would make "who agreed" something that changes under the page
 * after people have read it.
 *
 * The link stays *readable* afterwards, deliberately. Clearing the hash would
 * make somebody re-opening their own answered link land on "that link is not
 * one of ours" — telling the person who answered correctly that they had done
 * something wrong, which is precisely the bug M2-11 §2 had to fix on the
 * handover tap. What it grants once answered is nothing: the update below is
 * conditional on the row still being `invited`, and `checkInvite` refuses
 * before it. Reading it shows them their own answer, which is all it is for.
 */
export async function respondToInvite(
  db: PrismaClient,
  {
    token,
    answer,
    now = new Date(),
  }: { token: string; answer: InviteAnswer; now?: Date },
): Promise<RespondOutcome> {
  const subject = await witnessForToken(db, token)
  if (subject === null) return { ok: false, reason: 'not-found' }

  const allowed = checkInvite(
    { status: subject.status, expiresAt: subject.expiresAt },
    now,
  )
  if (!allowed.ok) return { ok: false, reason: allowed.reason }

  const status = statusForAnswer(answer)

  const { count } = await db.witness.updateMany({
    where: { id: subject.witnessId, status: 'invited' },
    data: {
      status,
      ...(status === 'accepted' ? { acceptedAt: now } : { declinedAt: now }),
    },
  })

  return count === 1 ? { ok: true, status } : { ok: false, reason: 'already-answered' }
}

export interface WitnessSummary {
  readonly id: string
  readonly name: string
  readonly phoneE164: string
  readonly status: WitnessStatus
  readonly hasLiveInvite: boolean
}

/** The organiser's own view: who she asked, and who has answered. */
export async function witnessSummaryForEvent(
  db: PrismaClient,
  { eventId, organiserId }: { eventId: string; organiserId: string },
): Promise<readonly WitnessSummary[]> {
  const rows = await db.witness.findMany({
    where: { eventId, event: { is: { organiserId } } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      phoneE164: true,
      status: true,
      inviteTokenHash: true,
    },
  })

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phoneE164: row.phoneE164,
    status: row.status,
    hasLiveInvite: row.inviteTokenHash !== null,
  }))
}
