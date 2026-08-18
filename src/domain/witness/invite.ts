import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Abakhaphi — the people who stand with a family, and the link that asks them.
 *
 * **Being asked is a compliment, not an audit.** `design/setup.html` is explicit
 * about the register: *"Being asked to witness a family's umcimbi is not a
 * small thing — it says you trust them with the family's business. Most people
 * are honoured to be asked."* Nothing in this flow checks up on anybody; it
 * asks, and it takes yes or no as an answer.
 *
 * The invite is a **capability in a URL**, for the reason M2-11 §1 records for
 * the handover link and M2-04 §3 refuses for undo: it has to reach a phone we
 * have never seen. An umkhaphi is not an organiser, has no account and will
 * never have one, and asking somebody to sign in to answer a question would
 * give a person an account to say one word.
 *
 * What bounds it: it is **scoped** to one witness on one event, it **expires**,
 * it reveals nothing the public page does not, and answering it moves no money
 * and changes nobody's access to anything.
 *
 * The token lives on the witness row rather than in a table of its own, unlike
 * `handover_tokens`. A collection has many handover links across two kinds and
 * several members; a witness has exactly one live invite, so a hash on the row
 * says the same thing without a join. See docs/decisions.md M3-03.
 *
 * Pure — hashing, clocks and rules. `node:crypto` only, which the domain
 * boundary allows for exactly this (docs/decisions.md M1-01 §4).
 */

export type WitnessStatus = 'invited' | 'accepted' | 'declined'

/**
 * How long an invite lives, matching the handover link (M2-11).
 *
 * Long enough to be passed on, sat with, and answered after the weekend; short
 * enough that a link forwarded into a group chat is not a live capability a
 * year later. She can always issue another.
 */
export const WITNESS_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 32 bytes from the CSPRNG, base64url — the shape a session token uses (M1-06). */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * SHA-256, no pepper, like the session and handover tokens: a 256-bit random
 * value cannot be precomputed, so a peppered HMAC would add key management for
 * nothing. **The database holds the hash, so a dump yields no usable link.**
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function inviteTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashInviteToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function inviteExpiresAt(now: Date): Date {
  return new Date(now.getTime() + WITNESS_INVITE_TTL_MS)
}

/** Only what the rules need — never the Prisma row (rule 6). */
export interface InviteState {
  readonly status: WitnessStatus
  readonly expiresAt: Date | null
}

export type InviteRejection = 'expired' | 'already-answered' | 'withdrawn'

export type InviteDecision =
  { readonly ok: true } | { readonly ok: false; readonly reason: InviteRejection }

/**
 * Whether this link can still be answered.
 *
 * **A decision is final until the organiser issues a new link.** A link that
 * kept toggling for thirty days would make "who agreed" something that can
 * change under the page after people have read it, which undoes the reason for
 * showing it at all. Somebody who declines and reconsiders asks her for another
 * — which is a conversation, and this is a product about people who talk.
 *
 * Reading the page is not answering it. `checkInvite` gates the POST; the GET
 * renders whatever this says, including the refusals, so somebody who opens the
 * link twice on a bad connection has not used up their answer (M2-11 §2).
 */
export function checkInvite(invite: InviteState, now: Date): InviteDecision {
  if (invite.status !== 'invited') return { ok: false, reason: 'already-answered' }
  if (invite.expiresAt === null) return { ok: false, reason: 'withdrawn' }
  if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }

  return { ok: true }
}

export type InviteAnswer = 'accept' | 'decline'

export function isInviteAnswer(value: string): value is InviteAnswer {
  return value === 'accept' || value === 'decline'
}

export function statusForAnswer(answer: InviteAnswer): WitnessStatus {
  return answer === 'accept' ? 'accepted' : 'declined'
}

/**
 * Who appears on the public page.
 *
 * **Only those who said yes**, and only their names. A declined invite is a
 * private answer to a private question — publishing it would turn a courtesy
 * into a record of who refused a grieving family, which is the opposite of what
 * abakhaphi are for. An outstanding invite is not shown either: a name on the
 * page means that person agreed to be there.
 */
export function isPubliclyNamed(status: WitnessStatus): boolean {
  return status === 'accepted'
}
