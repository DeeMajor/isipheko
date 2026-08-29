import type { PrismaClient } from '../generated/client.ts'
import { appendEntryWithin } from './ledger.ts'
import { enqueueNotification, recordDigestEntry } from './notifications.ts'
import { fromCents, type Money } from '../../domain/money/index.ts'
import type { Visibility } from '../../domain/contribution/index.ts'
import { derivePrefix, generateCode } from '../../domain/reference/index.ts'

/**
 * Mode A contributions: self-reported by the contributor, confirmed by the
 * organiser against their own bank notification.
 *
 * **No money moves through us.** The contributor pays the organiser directly
 * from their own banking app against a reference code; this records what they
 * say happened, and the organiser says whether it did. That is the whole of
 * Mode A (architecture §5.2), and it is why nothing here touches a payment
 * provider.
 *
 * Relative imports, like the other repositories a script has to load — see
 * docs/decisions.md M2-01 §8.
 */

/** Architecture §5.2: unconfirmed contributions expire after fourteen days. */
export const CONTRIBUTION_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000

/** Per phone, per hour. A family sharing one number is ordinary. */
export const MAX_REPORTS_PER_PHONE_PER_HOUR = 5

/** Per address, per hour. A church hall on shared wifi is ordinary too. */
export const MAX_REPORTS_PER_ADDRESS_PER_HOUR = 20

const RATE_WINDOW_MS = 60 * 60 * 1000

export interface StartInput {
  readonly eventId: string
  readonly eventTitle: string
  readonly type: 'cash' | 'cash_toward_item'
  readonly amountCents: Money
  readonly needItemId?: string | null
  readonly contributorName: string
  readonly contributorPhoneE164?: string | null
  readonly message?: string | null
  /**
   * The object key of the full AVIF derivative, or null.
   *
   * A key rather than a digest, because a key is what an object store is asked
   * for. The bytes it names have already had their metadata removed — no
   * original is kept, so there is nothing else it could name (M4-01).
   */
  readonly photoKey?: string | null
  /**
   * The full derivative's dimensions, written beside the key so the album can
   * reserve the space before a lazy image lands (M4-02).
   */
  readonly photoWidth?: number | null
  readonly photoHeight?: number | null
  readonly visibility: Visibility
  readonly reportedIpHash?: string | null
}

export interface StartedContribution {
  readonly id: string
  readonly refPrefix: string
  readonly refCode: string
}

/**
 * Creates the row at the moment the pay step is reached, because that is when a
 * reference code must exist and a code needs a row to be unique against.
 *
 * `self_reported_at` stays null until the contributor comes back and says they
 * paid. Most rows created here are people who looked at a number and went to
 * their banking app — or did not.
 */
export async function startContribution(
  db: PrismaClient,
  input: StartInput,
): Promise<StartedContribution> {
  const refPrefix = derivePrefix(input.eventTitle)

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const refCode = generateCode()

    try {
      const created = await db.contribution.create({
        data: {
          eventId: input.eventId,
          type: input.type,
          amountCents: input.amountCents,
          needItemId: input.needItemId ?? null,
          contributorName: input.contributorName,
          contributorPhoneE164: input.contributorPhoneE164 ?? null,
          message: input.message ?? null,
          photoKey: input.photoKey ?? null,
          photoWidth: input.photoWidth ?? null,
          photoHeight: input.photoHeight ?? null,
          visibility: input.visibility,
          verificationSource: 'organiser_confirmed',
          status: 'pending',
          reportedIpHash: input.reportedIpHash ?? null,
          refPrefix,
          refCode,
        },
        select: { id: true, refPrefix: true, refCode: true },
      })

      return {
        id: created.id,
        refPrefix: created.refPrefix ?? refPrefix,
        refCode: created.refCode ?? refCode,
      }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code !== 'P2002') throw error
      // That code is taken. Draw another.
    }
  }

  throw new Error('Could not allocate a reference code for this contribution')
}

/**
 * The contributor coming back to say they paid.
 *
 * Conditional on the row still being pending and not already reported, so a
 * double-tap on a slow connection reports once.
 */
export async function selfReport(
  db: PrismaClient,
  { contributionId, now = new Date() }: { contributionId: string; now?: Date },
): Promise<boolean> {
  const { count } = await db.contribution.updateMany({
    where: { id: contributionId, status: 'pending', selfReportedAt: null },
    data: { selfReportedAt: now },
  })

  if (count !== 1) return false

  /*
   * The organiser is told in a digest, never per contribution (§8.1 and
   * M2-08). This writes the fact; `scripts/notify.ts` decides when a message
   * goes, and the one-an-hour cap means fifty of these in ten minutes produce
   * exactly one message.
   *
   * Conditional on the update above having won, so a double-tap on a slow
   * connection cannot put the same payment in the digest twice.
   */
  const contribution = await db.contribution.findUnique({
    where: { id: contributionId },
    select: { eventId: true, event: { select: { organiserId: true } } },
  })

  if (contribution?.eventId != null && contribution.event?.organiserId != null) {
    await recordDigestEntry(db, {
      eventId: contribution.eventId,
      organiserId: contribution.event.organiserId,
      kind: 'contribution_self_reported',
      now,
    })
  }

  return true
}

export interface PendingReport {
  id: string
  contributorName: string
  amountCents: bigint | null
  type: string
  message: string | null
  photoKey: string | null
  reference: string
  selfReportedAt: Date
}

/**
 * What the organiser is asked to confirm: **only** contributions somebody has
 * actually said they paid.
 *
 * Rows created and abandoned at the pay step never appear here. Putting them in
 * front of an organiser would make the queue mostly noise, on the one screen
 * where money is acknowledged.
 */
export async function pendingReports(
  db: PrismaClient,
  { eventId, organiserId }: { eventId: string; organiserId: string },
): Promise<readonly PendingReport[]> {
  const rows = await db.contribution.findMany({
    where: {
      eventId,
      status: 'pending',
      selfReportedAt: { not: null },
      event: { organiserId },
    },
    orderBy: { selfReportedAt: 'asc' },
    select: {
      id: true,
      contributorName: true,
      amountCents: true,
      type: true,
      message: true,
      photoKey: true,
      refPrefix: true,
      refCode: true,
      selfReportedAt: true,
    },
  })

  // The `selfReportedAt: { not: null }` above is the mechanism, so this maps
  // rather than filtering again. A second filter here would make the query's
  // one redundant — and a redundant guard is a guard whose removal no test
  // notices, which was true of this function until it was checked.
  return rows.map((row) => ({
    id: row.id,
    contributorName: row.contributorName,
    amountCents: row.amountCents,
    type: row.type,
    message: row.message,
    photoKey: row.photoKey,
    reference: `${row.refPrefix ?? ''}-${row.refCode ?? ''}`,
    selfReportedAt: row.selfReportedAt ?? new Date(0),
  }))
}

export type ConfirmOutcome =
  | { readonly ok: true; readonly ledgerEntryId: string }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-yours' | 'not-pending' }

/**
 * The organiser saying the money arrived.
 *
 * **This is the only thing that writes to the ledger from this flow**, and it
 * happens in one transaction with the status change: a confirmed contribution
 * with no ledger entry, or an entry with no confirmation, would each be a
 * different kind of lie about the record. That sentence was written at M2-05
 * and was not true until M5-03 — see the note on the transaction below.
 *
 * The ledger append is itself append-only and hash-chained (M2-01). If the
 * organiser is wrong, the correction is a reversal entry, never an edit.
 */
export async function confirmContribution(
  db: PrismaClient,
  {
    contributionId,
    organiserId,
    now = new Date(),
  }: { contributionId: string; organiserId: string; now?: Date },
): Promise<ConfirmOutcome> {
  const contribution = await db.contribution.findUnique({
    where: { id: contributionId },
    select: {
      status: true,
      eventId: true,
      amountCents: true,
      type: true,
      contributorPhoneE164: true,
      needItem: { select: { label: true } },
      event: {
        select: { organiserId: true, title: true, slug: true, archetype: true },
      },
    },
  })

  if (contribution === null) return { ok: false, reason: 'not-found' }
  if (contribution.event?.organiserId !== organiserId)
    return { ok: false, reason: 'not-yours' }
  if (contribution.status !== 'pending') return { ok: false, reason: 'not-pending' }
  if (contribution.eventId === null) return { ok: false, reason: 'not-found' }

  const eventId = contribution.eventId

  /*
   * **One transaction, and it did not used to be.**
   *
   * The comment above this function has always claimed the append happens in
   * one transaction with the status change. Until M5-03 it did not: the
   * `updateMany` committed on its own and `appendEntry` opened a second
   * transaction after it, so a crash in between left exactly the lie the
   * comment forbids — a confirmed contribution with nothing on the record.
   *
   * `appendEntryWithin` exists for this and M2-06's in-kind path already used
   * it. The advisory lock is taken inside, so it is held for this whole
   * transaction and the serialisation guarantee is the same either way.
   */
  const entry = await db.$transaction(async (tx) => {
    const { count } = await tx.contribution.updateMany({
      where: { id: contributionId, status: 'pending' },
      data: { status: 'confirmed', confirmedAt: now },
    })

    // Somebody confirmed it a moment ago. One confirmation, one ledger entry.
    if (count === 0) return null

    return appendEntryWithin(tx as PrismaClient, {
      chain: { eventId },
      entryType: 'contribution',
      direction: 'credit',
      amountCents:
        contribution.amountCents === null ? null : fromCents(contribution.amountCents),
      inKindDescription:
        contribution.type === 'in_kind' ? (contribution.needItem?.label ?? null) : null,
      referenceId: contributionId,
      contributionId,
      createdAt: now,
    })
  })

  if (entry === null) return { ok: false, reason: 'not-pending' }

  /*
   * **Outside the transaction, deliberately.** A message that could not be
   * queued must not roll back a contribution that is on the record: the record
   * is the thing that has to be atomic, and an unsent notification is a smaller
   * harm than a payment that happened and is not written down.
   *
   * The contributor is told immediately — they are waiting for it — and the
   * organiser only in the next digest (§8.2).
   *
   * A contributor who left no phone number gets nothing. They have no account
   * and are never asked for an email (rule 4), so there is no fallback to
   * reach for; `enqueueNotification` returns null and the flow carries on.
   */
  await enqueueNotification(db, {
    kind: 'contribution_confirmed',
    templateId: 'contributor_contribution_confirmed',
    params: {
      eventTitle: contribution.event?.title ?? '',
      slug: contribution.event?.slug ?? '',
      archetype: contribution.event?.archetype ?? '',
    },
    recipient: { phoneE164: contribution.contributorPhoneE164 },
    eventId: contribution.eventId,
    now,
  })

  if (contribution.event?.organiserId != null) {
    await recordDigestEntry(db, {
      eventId: contribution.eventId,
      organiserId: contribution.event.organiserId,
      kind: 'contribution_confirmed',
      now,
    })
  }

  return { ok: true, ledgerEntryId: entry.id }
}

export interface RateLimitInput {
  readonly phoneE164: string | null
  readonly ipHash: string | null
  readonly now?: Date
}

export type RateLimitVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'phone' | 'address' }

/**
 * How often one phone, or one address, may report a payment.
 *
 * The flow has no account by design (rule 4), so these are the only two things
 * there are to count. Both limits are generous: a family sharing one number and
 * a church hall on shared wifi are ordinary, and locking them out to slow an
 * attacker down would cost the product the people it is for.
 */
export async function checkReportRateLimit(
  db: PrismaClient,
  { phoneE164, ipHash, now = new Date() }: RateLimitInput,
): Promise<RateLimitVerdict> {
  const since = new Date(now.getTime() - RATE_WINDOW_MS)

  if (phoneE164 !== null && phoneE164 !== '') {
    const byPhone = await db.contribution.count({
      where: { contributorPhoneE164: phoneE164, createdAt: { gt: since } },
    })

    if (byPhone >= MAX_REPORTS_PER_PHONE_PER_HOUR) {
      return { allowed: false, reason: 'phone' }
    }
  }

  if (ipHash !== null) {
    const byAddress = await db.contribution.count({
      where: { reportedIpHash: ipHash, createdAt: { gt: since } },
    })

    if (byAddress >= MAX_REPORTS_PER_ADDRESS_PER_HOUR) {
      return { allowed: false, reason: 'address' }
    }
  }

  return { allowed: true }
}

/**
 * Fourteen days, per §5.2.
 *
 * Voided rather than deleted. A contribution somebody reported and nobody
 * confirmed is a thing that happened, and the record of this product is the
 * product — the same reason a disputed contribution stays visible with that
 * status rather than disappearing.
 */
export async function expireStaleContributions(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - CONTRIBUTION_EXPIRY_MS)

  const { count } = await db.contribution.updateMany({
    where: { status: 'pending', createdAt: { lt: cutoff } },
    data: { status: 'void' },
  })

  return count
}
