import type { PrismaClient } from '../generated/client.ts'
import {
  attemptsExhausted,
  channelFor,
  countDigest,
  digestDueAt,
  nextAttemptAt,
  type DigestEntryKind,
  type NotificationChannel,
  type NotificationKind,
  type Recipient,
  type TemplateId,
  type TemplateParams,
} from '../../domain/messaging/index.ts'

/**
 * The outbox, and the digest that collapses fifty facts into one message.
 *
 * **Nothing here sends anything.** A repository writes rows; `scripts/notify.ts`
 * reads them and hands them to an adapter. That split is what lets the flush be
 * replaced by BullMQ later without touching a table, and what lets the digest
 * rule be tested against a real database rather than against a mock of one.
 *
 * Relative imports, like the other repositories a script has to load — see
 * docs/decisions.md M2-01 §8.
 */

export interface EnqueueInput {
  readonly kind: NotificationKind
  readonly templateId: TemplateId
  readonly params: TemplateParams
  readonly recipient: Recipient
  readonly organiserId?: string | null
  readonly eventId?: string | null
  readonly now?: Date
}

/**
 * A message to one person, now.
 *
 * Returns `null` when there is nobody to send to — a contributor who left no
 * phone number gets nothing, and that is the intended outcome rather than a
 * failure: they have no account and are never asked for an email (rule 4). See
 * docs/decisions.md M2-08.
 */
export async function enqueueNotification(
  db: PrismaClient,
  input: EnqueueInput,
): Promise<{ id: string; channel: NotificationChannel } | null> {
  const channel = channelFor(input.recipient)
  if (channel === null) return null

  const now = input.now ?? new Date()

  const created = await db.notification.create({
    data: {
      kind: input.kind,
      channel,
      templateId: input.templateId,
      params: input.params,
      toPhoneE164: channel === 'email' ? null : (input.recipient.phoneE164 ?? null),
      toEmail: channel === 'email' ? (input.recipient.email ?? null) : null,
      organiserId: input.organiserId ?? null,
      eventId: input.eventId ?? null,
      // Immediate: a contributor who has just been told their contribution is
      // confirmed is waiting for it. The quiet window applies to digests only.
      scheduledFor: now,
      /*
       * **Supplied, not defaulted** — the column keeps its `now()` default for
       * anything bypassing this repository, exactly as the ledger's does
       * (M2-01 §3).
       *
       * `buildDigest` computes the one-message-an-hour cap from this column
       * against a `now` its caller supplies. While this was a database default,
       * that comparison ran a simulated clock against a wall-clock column: fine
       * inside one real run, and quietly wrong for any test that simulates time
       * across an hour. A rule that reads a wall-clock column cannot be tested
       * against a simulated one (M2-08b).
       */
      createdAt: now,
    },
    select: { id: true },
  })

  return { id: created.id, channel }
}

/**
 * A thing that happened, waiting to be summarised.
 *
 * Cheap on purpose: this runs inside the transaction that recorded the fact, on
 * the path a contributor is waiting on. One insert, no reads, no decisions —
 * every decision about when a digest goes out is made by the flush.
 */
export async function recordDigestEntry(
  db: PrismaClient,
  {
    eventId,
    organiserId,
    kind,
    now = new Date(),
  }: {
    eventId: string
    organiserId: string
    kind: DigestEntryKind
    now?: Date
  },
): Promise<void> {
  // Supplied for the same reason as the notification's above: a fact recorded
  // at a simulated time and stamped with the wall clock is a fact two clocks
  // disagree about (M2-08b).
  await db.digestEntry.create({ data: { eventId, organiserId, kind, createdAt: now } })
}

export interface PendingDigest {
  readonly organiserId: string
  readonly eventId: string
}

/** Which organiser-and-umcimbi pairs have facts nobody has summarised yet. */
export async function pendingDigests(
  db: PrismaClient,
): Promise<readonly PendingDigest[]> {
  const rows = await db.digestEntry.findMany({
    where: { notificationId: null },
    distinct: ['organiserId', 'eventId'],
    select: { organiserId: true, eventId: true },
  })

  return rows
}

export interface DigestOutcome {
  readonly created: boolean
  readonly entries: number
  /** When it may go, if it is not going now. */
  readonly dueAt: Date
}

/**
 * Builds at most one digest for one organiser on one umcimbi.
 *
 * The whole of "fifty contributions in ten minutes produce exactly one message"
 * is here, and it is three facts rather than a counter:
 *
 * 1. Every fact is a row with `notification_id` null.
 * 2. A digest claims **all** of them in one `updateMany`.
 * 3. The next digest cannot be built until an hour after the last one was, and
 *    not outside 07:00–21:00 SAST.
 *
 * The advisory lock is the same mechanism the ledger uses (M2-01 §5): two
 * overlapping cron runs serialise on the pair rather than racing to create two
 * digests that each claim half the entries.
 */
export async function buildDigest(
  db: PrismaClient,
  {
    organiserId,
    eventId,
    now = new Date(),
  }: { organiserId: string; eventId: string; now?: Date },
): Promise<DigestOutcome> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${organiserId}:${eventId}`}, 0))
    `

    const entries = await tx.digestEntry.findMany({
      where: { organiserId, eventId, notificationId: null },
      select: { id: true, kind: true },
    })

    if (entries.length === 0) {
      return { created: false, entries: 0, dueAt: now }
    }

    const last = await tx.notification.findFirst({
      where: { organiserId, eventId, kind: 'organiser_digest' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, scheduledFor: true },
    })

    // Measured from when the digest was *created*, not from when it was
    // delivered: a BSP outage must not turn into fifty messages the moment it
    // clears.
    const dueAt = digestDueAt(last?.createdAt ?? null, now)

    if (dueAt.getTime() > now.getTime()) {
      return { created: false, entries: entries.length, dueAt }
    }

    const organiser = await tx.organiser.findUniqueOrThrow({
      where: { id: organiserId },
      select: { phoneE164: true, email: true },
    })

    const event = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { title: true, slug: true, archetype: true },
    })

    const channel = channelFor(organiser)
    if (channel === null) {
      // An organiser always has a phone — they signed in with it — so this is
      // unreachable rather than tolerated. Leaving the entries unclaimed means
      // the digest is built when it becomes possible.
      return { created: false, entries: entries.length, dueAt }
    }

    const counts = countDigest(entries.map((entry) => entry.kind))

    const notification = await tx.notification.create({
      data: {
        kind: 'organiser_digest',
        channel,
        templateId: 'organiser_digest',
        // The summary sentence is composed by the caller of this repository —
        // copy does not belong in `db/` (rule 11) — so what is stored is the
        // counts it was built from, and the words are rendered at send time.
        params: {
          eventTitle: event.title,
          slug: event.slug,
          archetype: event.archetype,
          selfReported: String(counts.selfReported),
          confirmed: String(counts.confirmed),
          claimed: String(counts.claimed),
        },
        toPhoneE164: channel === 'email' ? null : organiser.phoneE164,
        toEmail: channel === 'email' ? organiser.email : null,
        organiserId,
        eventId,
        // The window was already applied by `digestDueAt` above: nothing is
        // built outside it, so anything built is due. Holding the *build*
        // rather than the *send* is what makes a night's worth of updates one
        // message in the morning rather than a 03:00 snapshot that misses
        // whatever happened at dawn.
        scheduledFor: now,
        // Written rather than defaulted, because the hour-cap is measured from
        // it: a default of `now()` would make the cap depend on the database's
        // clock rather than on the one the flush was given.
        createdAt: now,
      },
      select: { id: true },
    })

    // One statement claims every entry. A second digest built a moment later
    // finds nothing to summarise, which is the property the criterion names.
    await tx.digestEntry.updateMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
      data: { notificationId: notification.id },
    })

    return { created: true, entries: entries.length, dueAt }
  })
}

export interface DueNotification {
  readonly id: string
  readonly kind: NotificationKind
  readonly channel: NotificationChannel
  readonly templateId: string
  readonly params: Record<string, string>
  readonly toPhoneE164: string | null
  readonly toEmail: string | null
  readonly attempts: number
}

/** What the flush should try to send now, oldest first. */
export async function dueNotifications(
  db: PrismaClient,
  { now = new Date(), limit = 100 }: { now?: Date; limit?: number } = {},
): Promise<readonly DueNotification[]> {
  const rows = await db.notification.findMany({
    where: { status: 'pending', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
    select: {
      id: true,
      kind: true,
      channel: true,
      templateId: true,
      params: true,
      toPhoneE164: true,
      toEmail: true,
      attempts: true,
    },
  })

  return rows.map((row) => ({
    ...row,
    params: (row.params ?? {}) as Record<string, string>,
  }))
}

/**
 * Marks a message sent, conditionally on it still being pending.
 *
 * Two flushes overlapping would otherwise both send it. The condition means
 * exactly one wins, and the loser's `count === 0` tells it not to hand the same
 * message to the BSP a second time.
 */
export async function markSent(
  db: PrismaClient,
  { id, now = new Date() }: { id: string; now?: Date },
): Promise<boolean> {
  const { count } = await db.notification.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'sent', sentAt: now, attempts: { increment: 1 } },
  })

  return count === 1
}

export interface FailureOutcome {
  readonly status: 'pending' | 'failed'
  /** Set when the failure produced a fallback message on another channel. */
  readonly fallbackId?: string
}

/**
 * Records a failed attempt, and either schedules a retry or gives up.
 *
 * On giving up, an organiser or witness with an email address gets the same
 * message there — architecture §8.2's fallback. A contributor does not, because
 * there is no address to fall back to and asking for one would cost the
 * property that there is no account (rule 4).
 *
 * `errorCode` is a code. A provider's prose can contain the recipient's number,
 * and this column is read in logs and dashboards (rule 8).
 */
export async function markFailed(
  db: PrismaClient,
  { id, errorCode, now = new Date() }: { id: string; errorCode: string; now?: Date },
): Promise<FailureOutcome> {
  return db.$transaction(async (tx) => {
    const notification = await tx.notification.findUniqueOrThrow({
      where: { id },
      select: {
        attempts: true,
        kind: true,
        channel: true,
        templateId: true,
        params: true,
        organiserId: true,
        eventId: true,
      },
    })

    const attempts = notification.attempts + 1

    if (!attemptsExhausted(attempts)) {
      await tx.notification.updateMany({
        where: { id, status: 'pending' },
        data: {
          attempts,
          lastErrorCode: errorCode,
          scheduledFor: nextAttemptAt(attempts, now),
        },
      })

      return { status: 'pending' as const }
    }

    await tx.notification.updateMany({
      where: { id, status: 'pending' },
      data: { attempts, lastErrorCode: errorCode, status: 'failed' },
    })

    // The fallback is only ever email, and only for somebody we hold one for.
    if (notification.channel === 'email' || notification.organiserId === null) {
      return { status: 'failed' as const }
    }

    const organiser = await tx.organiser.findUnique({
      where: { id: notification.organiserId },
      select: { email: true },
    })

    if (organiser?.email == null || organiser.email === '') {
      return { status: 'failed' as const }
    }

    const fallback = await tx.notification.create({
      data: {
        kind: notification.kind,
        channel: 'email',
        templateId: notification.templateId,
        params: notification.params ?? {},
        toEmail: organiser.email,
        organiserId: notification.organiserId,
        eventId: notification.eventId,
        scheduledFor: now,
      },
      select: { id: true },
    })

    return { status: 'failed' as const, fallbackId: fallback.id }
  })
}

/**
 * Prunes what has been dealt with.
 *
 * These rows hold a name and a phone number and have no evidential value once
 * the message has gone — unlike the ledger, which holds neither casually and is
 * never deleted at all. Architecture §11's retention rule, applied where it
 * actually bites.
 */
export async function pruneNotifications(
  db: PrismaClient,
  { olderThanMs, now = new Date() }: { olderThanMs: number; now?: Date },
): Promise<{ notifications: number; entries: number }> {
  const cutoff = new Date(now.getTime() - olderThanMs)

  const entries = await db.digestEntry.deleteMany({
    where: { notificationId: { not: null }, createdAt: { lt: cutoff } },
  })

  const notifications = await db.notification.deleteMany({
    where: { status: { in: ['sent', 'failed'] }, createdAt: { lt: cutoff } },
  })

  return { notifications: notifications.count, entries: entries.count }
}
