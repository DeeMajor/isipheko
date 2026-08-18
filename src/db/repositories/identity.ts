import type { PrismaClient } from '../generated/client.ts'
import {
  ATTEMPT_WINDOW_MS,
  applyOutcome,
  type CheckStatus,
  type OrganiserVerificationStatus,
  type VerificationChecks,
  type VerificationFailure,
  type VerificationOutcome,
} from '../../domain/identity/index.ts'

/**
 * Consent, attempts, and the one write that makes somebody verified.
 *
 * **The ID number never reaches this file.** What arrives is already
 * `SHA256(number + pepper)`, computed in `src/lib/identity.ts`, and the only
 * column it lands in is `organisers.id_number_hash` on success. Nothing here
 * takes a photograph, because nothing in `VerificationOutcome` can carry one.
 *
 * Relative imports with extensions, like the other repositories — see
 * docs/decisions.md M2-01 §8.
 */

const UNIQUE_VIOLATION = 'P2002'

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION
}

export interface ConsentRecord {
  readonly id: string
  readonly consentedAt: Date
}

/**
 * Written before the provider is called, and never written again.
 *
 * The table holds no UPDATE grant, so this row is what it says it is for as long
 * as it exists.
 */
export async function recordConsent(
  db: PrismaClient,
  {
    organiserId,
    copyKey,
    copyVersion,
    copyHash,
    ipHash,
    userAgentHash,
  }: {
    organiserId: string
    copyKey: string
    copyVersion: string
    copyHash: string
    ipHash: string | null
    userAgentHash: string | null
  },
): Promise<ConsentRecord> {
  const consent = await db.identityConsent.create({
    data: { organiserId, copyKey, copyVersion, copyHash, ipHash, userAgentHash },
    select: { id: true, consentedAt: true },
  })

  return consent
}

export interface OrganiserIdentityState {
  readonly organiserId: string
  readonly displayName: string | null
  readonly status: OrganiserVerificationStatus
  readonly verifiedAt: Date | null
  readonly attemptsInWindow: number
}

export async function organiserIdentityState(
  db: PrismaClient,
  { organiserId, now = new Date() }: { organiserId: string; now?: Date },
): Promise<OrganiserIdentityState | null> {
  const organiser = await db.organiser.findUnique({
    where: { id: organiserId },
    select: { displayName: true, idVerificationStatus: true, idVerifiedAt: true },
  })

  if (organiser === null) return null

  // Counted from the attempts themselves rather than from a counter column: a
  // count that has to be maintained is a count that can disagree with the rows
  // (M1-06 §4, same reasoning one layer up).
  const attemptsInWindow = await db.identityVerification.count({
    where: {
      organiserId,
      startedAt: { gte: new Date(now.getTime() - ATTEMPT_WINDOW_MS) },
    },
  })

  return {
    organiserId,
    displayName: organiser.displayName,
    status: organiser.idVerificationStatus,
    verifiedAt: organiser.idVerifiedAt,
    attemptsInWindow,
  }
}

/**
 * Whether this identity is already verified on another account.
 *
 * Checked **before** the provider is called, because a duplicate is an answer we
 * already hold and a provider call is about R30 (§7.1).
 *
 * What the organiser is told is deliberately not "somebody else has this
 * number": that would turn the form into an identity-enumeration oracle,
 * answering "is this person registered?" for anybody with a list of ID numbers.
 * The attempt fails with `duplicate-identity` and the copy points at the report
 * channel.
 */
export async function identityTaken(
  db: PrismaClient,
  { idNumberHash, organiserId }: { idNumberHash: string; organiserId: string },
): Promise<boolean> {
  const existing = await db.organiser.findUnique({
    where: { idNumberHash },
    select: { id: true },
  })

  return existing !== null && existing.id !== organiserId
}

export interface VerificationRecord {
  readonly id: string
  readonly organiserId: string
  readonly status: CheckStatus
  readonly provider: string
  readonly providerReference: string | null
  /**
   * Carried on the attempt because the answer arrives on a later poll, when the
   * plaintext is gone. Promoted to the organiser only when the check passes.
   */
  readonly idNumberHash: string | null
  readonly failureReason: VerificationFailure | null
  readonly startedAt: Date
  readonly completedAt: Date | null
  readonly lastPolledAt: Date | null
}

const RECORD_FIELDS = {
  id: true,
  organiserId: true,
  status: true,
  provider: true,
  providerReference: true,
  idNumberHash: true,
  failureReason: true,
  startedAt: true,
  completedAt: true,
  lastPolledAt: true,
} as const

interface RawRecord {
  id: string
  organiserId: string
  status: CheckStatus
  provider: string
  providerReference: string | null
  idNumberHash: string | null
  failureReason: string | null
  startedAt: Date
  completedAt: Date | null
  lastPolledAt: Date | null
}

function toRecord(row: RawRecord): VerificationRecord {
  return { ...row, failureReason: row.failureReason as VerificationFailure | null }
}

/**
 * Opens an attempt and marks the organiser pending in one transaction.
 *
 * Both halves or neither. An organiser left `pending` with no attempt behind it
 * would be locked out of starting one — `canStartVerification` refuses a second
 * check while one is in flight — and an attempt with the organiser still
 * `unverified` would let a second check start beside it and bill twice.
 */
export async function startVerification(
  db: PrismaClient,
  {
    organiserId,
    consentId,
    provider,
    providerReference,
    idNumberHash,
  }: {
    organiserId: string
    consentId: string
    provider: string
    providerReference: string | null
    idNumberHash: string
  },
): Promise<VerificationRecord> {
  return await db.$transaction(async (tx) => {
    const created = await tx.identityVerification.create({
      data: { organiserId, consentId, provider, providerReference, idNumberHash },
      select: RECORD_FIELDS,
    })

    // Never over a `verified`. Somebody already verified starting another check
    // — which `canStartVerification` refuses, and which a direct caller could
    // still do — must not lose the badge they earned while it runs.
    await tx.organiser.updateMany({
      where: { id: organiserId, idVerificationStatus: { not: 'verified' } },
      data: { idVerificationStatus: 'pending' },
    })

    return toRecord(created)
  })
}

export async function latestVerification(
  db: PrismaClient,
  { organiserId }: { organiserId: string },
): Promise<VerificationRecord | null> {
  const row = await db.identityVerification.findFirst({
    where: { organiserId },
    orderBy: { startedAt: 'desc' },
    select: RECORD_FIELDS,
  })

  return row === null ? null : toRecord(row)
}

export async function setProviderReference(
  db: PrismaClient,
  { id, providerReference }: { id: string; providerReference: string },
): Promise<void> {
  await db.identityVerification.updateMany({
    where: { id, status: 'pending' },
    data: { providerReference },
  })
}

/**
 * Claims the right to call the provider.
 *
 * A conditional update rather than a read followed by a write: the pending page
 * reloads itself, and two tabs — or a phone and a laptop — would otherwise both
 * read a stale `last_polled_at` and both call. Exactly one caller gets `true`.
 */
export async function claimPollSlot(
  db: PrismaClient,
  { id, now, minIntervalMs }: { id: string; now: Date; minIntervalMs: number },
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - minIntervalMs)

  const claimed = await db.identityVerification.updateMany({
    where: {
      id,
      status: 'pending',
      OR: [{ lastPolledAt: null }, { lastPolledAt: { lte: cutoff } }],
    },
    data: { lastPolledAt: now },
  })

  return claimed.count === 1
}

/**
 * Carries the reason it wrote, not only that it wrote one.
 *
 * The caller cannot infer it from the outcome it passed in: a check that passed
 * at the provider and then hit the unique index on `organisers.id_number_hash`
 * is stored as `duplicate-identity`, and a caller reading its own outcome would
 * report something that never happened.
 */
export type ApplyResult =
  | { readonly status: 'verified' }
  | { readonly status: 'unchanged' }
  | { readonly status: 'failed'; readonly reason: VerificationFailure }

/**
 * Writes a provider's answer, or declines to.
 *
 * `applyOutcome` decides — terminal once, so a stale tab polling a verified
 * check cannot turn it into a failure and a duplicate callback cannot reopen
 * one. This function only performs what it was told.
 *
 * On success the organiser's row moves in the **same transaction** as the
 * attempt: a verified attempt beside an unverified organiser would put a badge
 * nowhere and a gate everywhere, and the two disagreeing is the failure that
 * would be found by an organiser who could not publish after passing a check.
 */
export async function applyVerificationOutcome(
  db: PrismaClient,
  {
    record,
    outcome,
    now = new Date(),
  }: {
    record: VerificationRecord
    outcome: VerificationOutcome
    now?: Date
  },
): Promise<ApplyResult> {
  const decision = applyOutcome(record.status, outcome)
  if (!decision.apply) return { status: 'unchanged' }

  const checks: VerificationChecks | null =
    outcome.status === 'pending' ? null : outcome.checks

  if (decision.status === 'failed') {
    const failed = await failVerification(db, {
      record,
      reason: decision.reason,
      checks,
      now,
    })

    return failed
      ? { status: 'failed', reason: decision.reason }
      : { status: 'unchanged' }
  }

  let advanced = false

  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.identityVerification.updateMany({
        where: { id: record.id, status: 'pending' },
        data: {
          status: 'verified',
          completedAt: now,
          ...(checks === null ? {} : { checks: { ...checks } }),
        },
      })

      // Somebody else settled this check first, or the caller is holding a
      // record it read before they did. Terminal once, so this is not an error —
      // but it must be reported as "nothing happened" rather than as the outcome
      // the caller was carrying, or a stale tab renders a failure over a badge
      // that was earned.
      if (claimed.count !== 1) return

      advanced = true

      await tx.organiser.update({
        where: { id: record.organiserId },
        data: {
          idVerificationStatus: 'verified',
          idVerifiedAt: now,
          // Promoted here and nowhere earlier. The unique index on this column
          // is what makes one identity mean one account.
          ...(record.idNumberHash === null ? {} : { idNumberHash: record.idNumberHash }),
        },
      })
    })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error

    // The identity was claimed between the pre-check and here. The check itself
    // passed; what failed is that this identity already belongs to an account.
    const failed = await failVerification(db, {
      record,
      reason: 'duplicate-identity',
      checks,
      now,
    })

    return failed
      ? { status: 'failed', reason: 'duplicate-identity' }
      : { status: 'unchanged' }
  }

  return advanced ? { status: 'verified' } : { status: 'unchanged' }
}

/**
 * Also the path for a failure we decide ourselves — a duplicate identity, or a
 * check still pending long after any provider should have answered.
 *
 * Returns whether it applied. A caller holding a record that was settled while
 * it was working needs to know that nothing happened, rather than reporting a
 * failure that the database correctly refused to write.
 */
export async function failVerification(
  db: PrismaClient,
  {
    record,
    reason,
    checks = null,
    now = new Date(),
  }: {
    record: VerificationRecord
    reason: VerificationFailure
    checks?: VerificationChecks | null
    now?: Date
  },
): Promise<boolean> {
  return await db.$transaction(async (tx) => {
    const claimed = await tx.identityVerification.updateMany({
      where: { id: record.id, status: 'pending' },
      data: {
        status: 'failed',
        failureReason: reason,
        completedAt: now,
        ...(checks === null ? {} : { checks: { ...checks } }),
      },
    })

    if (claimed.count !== 1) return false

    // Never demotes a verified organiser. A failed attempt after a successful
    // one is a new attempt on an account that is already verified, and the badge
    // it earned is not something a later typo takes away.
    await tx.organiser.updateMany({
      where: { id: record.organiserId, idVerificationStatus: 'pending' },
      data: { idVerificationStatus: 'failed' },
    })

    return true
  })
}
