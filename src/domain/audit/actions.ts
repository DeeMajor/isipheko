/**
 * What the audit log is allowed to say happened.
 *
 * Architecture §4.2 and §10: an append-only record of every security-relevant
 * action. The taxonomy is here, in the pure layer, because it is a contract
 * rather than an implementation detail — the writer is in `src/lib/audit.ts`,
 * the reader is `src/db/repositories/audit.ts`, and both have to agree on the
 * same closed set of strings or the log becomes a pile of free text nobody can
 * query.
 *
 * **A string is added here before it is written anywhere.** That is the point
 * of a union: a call site cannot invent an action, and a reviewer reading this
 * file sees the whole of what the product records about itself.
 *
 * ## What never goes in a row
 *
 * Rule 8. The log answers *what happened*, *when*, and *was this the same
 * person* — never *who*. Identifiers are HMAC'd by the writer; the metadata
 * carries outcomes, codes and counts and nothing else. A one-time code is not
 * written at all, hashed or otherwise, and neither is an ID number, a bank
 * account, a phone number in the clear, or the words somebody typed into a
 * report.
 *
 * ## Reserved, not built — the payout hook
 *
 * `payout.requested`, `payout.approved` and `payout.released` are the names the
 * disbursement path will use, and they are **deliberately absent from the union
 * below**. Mode B is Milestone 5 and is gated on the legal opinion
 * (architecture §15 item 1): there is no payout to request today, so a logger
 * for one would be dead code wearing the appearance of a reviewed control.
 *
 * When M5 builds the state machine in architecture §5.4, the three strings join
 * `PayoutAction` here, the writer gains `recordPayoutEvent`, and the call sites
 * are the transitions themselves — not the screen that triggers them, because a
 * payout that is approved by a witness and released by a job is two actors and
 * two rows. Whoever picks it up should read docs/decisions.md M3-07 §6 first.
 *
 * Pure: strings and shapes. No I/O.
 */

/**
 * Signing in, and the ways it fails.
 *
 * Failure is logged as loudly as success on purpose: a run of
 * `auth.otp.rejected` against one number is the shape of somebody guessing, and
 * a log that only recorded the successes would show nothing at all.
 */
export type AuthAction =
  | 'auth.otp.requested'
  | 'auth.otp.rate_limited'
  | 'auth.otp.verified'
  | 'auth.otp.rejected'
  | 'auth.otp.exhausted'
  | 'auth.organiser.created'
  | 'auth.session.started'
  | 'auth.session.ended'
  | 'auth.session.ended_everywhere'

/**
 * Identity verification (M3-01). Every one of these is security-relevant and
 * some of them cost money, so the log is also how somebody paying the Home
 * Affairs bill can see what it was spent on.
 *
 * **The metadata carries codes and never a number.** Not the ID number, not its
 * hash, not the provider's message — a failure is `no-match`, and which
 * identity it was about is not a question this log needs to answer.
 */
export type IdentityAction =
  | 'identity.consent.captured'
  | 'identity.check.started'
  | 'identity.check.verified'
  | 'identity.check.failed'
  | 'identity.check.refused'

/**
 * Publishing (M3-02) — the moment a page becomes something strangers can be
 * asked for money on, and therefore the single most consequential thing an
 * organiser does.
 */
export type EventAction = 'event.published'

/**
 * Money and provisions moving onto the ledger.
 *
 * The ledger is itself append-only and hash-chained, so this is not a second
 * copy of it. It records *who was signed in when the entry was appended*, which
 * the ledger row does not carry and which is the question asked after the fact.
 */
export type ConfirmAction =
  | 'contribution.confirmed'
  | 'delivery.confirmed'
  | 'handover.confirmed'
  /**
   * The organiser giving a claim back to the board (UX-05). No ledger entry —
   * nothing was ever confirmed — but it takes a promise out of somebody's
   * name, which is exactly the kind of act the question "what happened to
   * this event?" is asked about.
   */
  | 'claim.released'

/**
 * Reports (M3-06) and what a person does about them.
 *
 * `report.filed` names no reporter: the row carries the reported subject and
 * the request fingerprint, never the words and never the number. **What is in a
 * report is among the most sensitive things this product holds** — somebody
 * accusing a family of fraud, possibly wrongly, possibly a member of that
 * family — and an audit log is read by more people than the report is.
 */
export type ReportAction = 'report.filed' | 'report.triaged'

/**
 * Somebody with the queue open.
 *
 * **Reading is logged, not only acting.** A queue of reports is a list of
 * families somebody has been accused of defrauding, and knowing who looked
 * matters as much as knowing who acted — an admin who reads every report about
 * one family and changes nothing leaves no trace at all under a
 * writes-only log.
 *
 * `admin.access.refused` is the one worth alerting on: a signed-in organiser
 * who is not on the allowlist asking for the review screen is either a bug or
 * somebody trying the door.
 */
export type AdminAction =
  'admin.queue.viewed' | 'admin.report.opened' | 'admin.access.refused'

export type AuditAction =
  AuthAction | IdentityAction | EventAction | ConfirmAction | ReportAction | AdminAction

/**
 * Mirrors the `actor_type` enum in the database. Declared here rather than
 * imported from Prisma because rule 6 forbids the domain knowing the ORM; a
 * unit test asserts the two lists have not drifted apart.
 */
export type AuditActorType = 'organiser' | 'contributor' | 'witness' | 'system' | 'admin'

/**
 * What a row is *about*, when it is about anything.
 *
 * Deliberately coarse. A confirmation targets the **umcimbi** rather than the
 * contribution, because the question the trail is read to answer is *what has
 * happened to this event* — a log split one target per contribution answers
 * nobody's question and cannot be assembled back into the one that was asked.
 * The narrower id goes in the metadata.
 */
export type AuditTargetType = 'organiser' | 'event' | 'collection' | 'report'

/**
 * Outcomes, codes, counts, and the narrower row id a coarse target left out.
 * **Never a personal identifier and never free text.**
 *
 * A contribution id belongs here; a phone number, an ID number, a bank account
 * or the words somebody typed into a report do not, in any form. An audit log
 * is exported, shipped and kept far longer than the row it describes.
 *
 * The type cannot enforce that on its own — every phone number is also a
 * string — so it is held by three things together: this comment, the writer
 * hashing the identifiers it is given, and
 * `tests/unit/audit.test.ts`, which reads the call sites.
 */
export type AuditMetadata = Record<string, string | number | boolean>

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'auth.otp.requested',
  'auth.otp.rate_limited',
  'auth.otp.verified',
  'auth.otp.rejected',
  'auth.otp.exhausted',
  'auth.organiser.created',
  'auth.session.started',
  'auth.session.ended',
  'auth.session.ended_everywhere',
  'identity.consent.captured',
  'identity.check.started',
  'identity.check.verified',
  'identity.check.failed',
  'identity.check.refused',
  'event.published',
  'contribution.confirmed',
  'delivery.confirmed',
  'handover.confirmed',
  'claim.released',
  'report.filed',
  'report.triaged',
  'admin.queue.viewed',
  'admin.report.opened',
  'admin.access.refused',
]

/**
 * The action strings Milestone 5 will add, named so that the hook is documented
 * rather than merely intended. Nothing writes these and nothing may: they are
 * not in `AuditAction`, so a call site that reaches for one does not compile.
 */
export const RESERVED_PAYOUT_ACTIONS: readonly string[] = [
  'payout.requested',
  'payout.approved',
  'payout.released',
]

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}
