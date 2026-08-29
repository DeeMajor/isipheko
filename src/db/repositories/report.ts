import type { PrismaClient } from '../generated/client.ts'
import { generateCode } from '../../domain/reference/index.ts'
import {
  MAX_REPORTS_PER_ADDRESS_PER_HOUR,
  canTriage,
  respondBy,
  type ReportReason,
  type ReportStatus,
} from '../../domain/report/index.ts'

/**
 * Filing a report, and the queue it lands in.
 *
 * **Nothing here touches the event a report is about.** There is no update to
 * an event in this file and there must not be one — see the standing rule in
 * `src/domain/report/report.ts` and docs/decisions.md M3-06 §1.
 *
 * Relative imports with extensions, like the other repositories (M2-01 §8).
 */

/** Its own namespace. Deliberately not resolvable through `/check`. */
const REPORT_PREFIX = 'REP'

const UNIQUE_VIOLATION = 'P2002'
const MAX_ATTEMPTS = 8

export interface FiledReport {
  readonly id: string
  /** `REP-4K7B2X`, shown on screen — the acknowledgement that arrives today. */
  readonly reference: string
  readonly respondBy: Date
  /** Whether there is any way to come back to them. */
  readonly reachable: boolean
}

export interface FileInput {
  readonly reason: ReportReason
  readonly detail: string | null
  readonly eventId: string | null
  readonly collectionId: string | null
  readonly aboutTyped: string | null
  readonly reporterPhoneE164: string | null
  readonly ipHash: string | null
  readonly userAgentHash: string | null
  readonly now?: Date
  /** Injectable so the collision retry can be exercised (M2-02 §2). */
  readonly generate?: () => string
}

export async function fileReport(
  db: PrismaClient,
  input: FileInput,
): Promise<FiledReport> {
  const now = input.now ?? new Date()
  const deadline = respondBy(now)
  const generate = input.generate ?? generateCode

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = generate()

    try {
      const created = await db.report.create({
        data: {
          refPrefix: REPORT_PREFIX,
          refCode: code,
          reason: input.reason.replaceAll('-', '_') as never,
          detail: input.detail,
          eventId: input.eventId,
          collectionId: input.collectionId,
          aboutTyped: input.aboutTyped,
          reporterPhoneE164: input.reporterPhoneE164,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          respondBy: deadline,
          createdAt: now,
        },
        select: { id: true },
      })

      return {
        id: created.id,
        reference: `${REPORT_PREFIX}-${code}`,
        respondBy: deadline,
        reachable: input.reporterPhoneE164 !== null,
      }
    } catch (error) {
      if ((error as { code?: unknown }).code !== UNIQUE_VIOLATION) throw error
      // That code is taken. Draw another.
    }
  }

  throw new Error(
    'Could not allocate a report reference. At this alphabet size that is not ' +
      'bad luck — check whether codes are being generated from a fixed seed.',
  )
}

const WINDOW_MS = 60 * 60 * 1000

/**
 * How many this address has filed in the last hour.
 *
 * Counted from the rows the action itself writes, like every limit that can be
 * (M1-06 §4, M2-04 §6) — unlike `/check`, which writes nothing and had to settle
 * for a counter in memory.
 */
export async function reportsFromAddress(
  db: PrismaClient,
  { ipHash, now = new Date() }: { ipHash: string | null; now?: Date },
): Promise<number> {
  if (ipHash === null) return 0

  return await db.report.count({
    where: { ipHash, createdAt: { gt: new Date(now.getTime() - WINDOW_MS) } },
  })
}

export function withinReportLimit(count: number): boolean {
  return count < MAX_REPORTS_PER_ADDRESS_PER_HOUR
}

export interface QueueReport {
  readonly waiting: number
  readonly overdue: number
  readonly oldestWaitingHours: number | null
}

/**
 * The queue, as three numbers.
 *
 * **Counts only** — no names, no titles, no detail. This is printed by an
 * unattended job into logs (rule 8), and the contents of a report are among the
 * most sensitive things this product holds: somebody accusing a family of
 * fraud, possibly wrongly, possibly a member of that family.
 */
export async function queueReport(
  db: PrismaClient,
  { now = new Date() }: { now?: Date } = {},
): Promise<QueueReport> {
  const waiting = await db.report.count({ where: { status: 'received' } })
  const overdue = await db.report.count({
    where: { status: 'received', respondBy: { lt: now } },
  })

  const oldest = await db.report.findFirst({
    where: { status: 'received' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })

  return {
    waiting,
    overdue,
    oldestWaitingHours:
      oldest === null
        ? null
        : Math.floor((now.getTime() - oldest.createdAt.getTime()) / (60 * 60 * 1000)),
  }
}

/** Set once the acknowledgement has been handed to the outbox. */
export async function markAcknowledged(
  db: PrismaClient,
  { id, now = new Date() }: { id: string; now?: Date },
): Promise<void> {
  await db.report.updateMany({
    where: { id, acknowledgedAt: null },
    data: { acknowledgedAt: now },
  })
}

// ---------------------------------------------------------------------------
// The review queue (M3-07)
// ---------------------------------------------------------------------------

export interface QueuedReport {
  readonly id: string
  readonly reference: string
  readonly reason: ReportReason
  readonly status: ReportStatus
  readonly respondBy: Date
  readonly createdAt: Date
  /** What it is about, if we hold it. Null on both is the scam case. */
  readonly eventTitle: string | null
  readonly collectionTitle: string | null
  /** What they were sent, when it resolves to nothing. */
  readonly aboutTyped: string | null
  /** Whether there is any way to come back to them — not the number itself. */
  readonly reachable: boolean
}

const fromDbReason = (reason: string): ReportReason =>
  reason.replaceAll('_', '-') as ReportReason

/**
 * The queue a person works from, deadline first.
 *
 * **Ordered by `respondBy` and not by arrival.** The promise made on the filed
 * screen is a window, so the report closest to breaching it is the one to pick
 * up next — sorting by newest would systematically serve whoever reported most
 * recently and leave the oldest promise the one most likely to be broken.
 *
 * Closed reports are excluded rather than greyed out. A queue that keeps
 * everything in it stops being a queue.
 *
 * **The reporter's number does not leave this function.** It is read to answer
 * *is there any way back to them*, and what the caller receives is that
 * boolean. The number itself is on the detail screen only, because that is
 * where somebody is about to use it; a list is read at a glance, over a
 * shoulder, and screenshotted (docs/decisions.md M3-07 §5).
 */
/** One page of the queue, and how much of it there is (M3-07b). */
export interface ReviewPage {
  readonly rows: readonly QueuedReport[]
  /** Every open report, not only the ones on this page. */
  readonly total: number
  /** Zero-based, as asked for and after clamping. */
  readonly offset: number
  readonly limit: number
}

/** How many reports fit on one screen before it becomes a wall. */
export const REVIEW_PAGE_SIZE = 50

/**
 * One page of open reports, oldest deadline first.
 *
 * **This took 100 and said nothing about it** (M3-07b). A reviewer who scrolled
 * to the bottom of a silently capped list believed they had seen everything — so
 * the one-working-day SLA failed invisibly, on the screen built to guarantee it,
 * and the reports that fell off were the **newest**, whose deadlines had not yet
 * arrived and which therefore had the most time left to save.
 *
 * Found by two E2E tests failing against a local database that had accumulated
 * 108 open reports. In production the cap is real and the failure mode is a
 * person rather than a test.
 *
 * **The sort is a total order and has to be.** `respondBy` alone ties — every
 * report filed in the same hour shares a deadline, and the SLA is measured in
 * working days, so ties are the common case rather than the edge. Two rows that
 * compare equal can be returned in either order by two queries, which under
 * `skip`/`take` means a report appearing on both pages or on neither. `id` last
 * makes the order total, so the page boundary is stable.
 */
export async function reviewQueue(
  db: PrismaClient,
  { limit = REVIEW_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ReviewPage> {
  const open = { status: { in: ['received', 'reviewing'] satisfies ReportStatus[] } }

  const total = await db.report.count({ where: open })
  // A deleted or closed report between the count and the read would otherwise
  // leave somebody on an empty page with no way back.
  const start = Math.max(0, Math.min(offset, Math.max(0, total - 1)))

  const rows = await db.report.findMany({
    where: open,
    orderBy: [{ respondBy: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    skip: start,
    take: limit,
    select: {
      id: true,
      refPrefix: true,
      refCode: true,
      reason: true,
      status: true,
      respondBy: true,
      createdAt: true,
      aboutTyped: true,
      reporterPhoneE164: true,
      event: { select: { title: true } },
      collection: { select: { title: true } },
    },
  })

  return {
    rows: rows.map((row) => ({
      id: row.id,
      reference: `${row.refPrefix}-${row.refCode}`,
      reason: fromDbReason(row.reason),
      status: row.status,
      respondBy: row.respondBy,
      createdAt: row.createdAt,
      eventTitle: row.event?.title ?? null,
      collectionTitle: row.collection?.title ?? null,
      aboutTyped: row.aboutTyped,
      reachable: row.reporterPhoneE164 !== null,
    })),
    total,
    offset: start,
    limit,
  }
}

export interface ReportDetail extends QueuedReport {
  /** In their own words. Never required, often empty. */
  readonly detail: string | null
  /**
   * **The one place this leaves the database.**
   *
   * It is here because the SLA promises a person comes back to them and that is
   * impossible without it. Not in `reviewQueue`, not in `queueReport`, not in
   * any log — see docs/decisions.md M3-07 §5.
   */
  readonly reporterPhoneE164: string | null
  /** For the audit trail beside it, when there is something to look at. */
  readonly eventId: string | null
  readonly collectionId: string | null
  readonly closedAt: Date | null
}

export async function reportById(
  db: PrismaClient,
  { id }: { id: string },
): Promise<ReportDetail | null> {
  const row = await db.report.findUnique({
    where: { id },
    select: {
      id: true,
      refPrefix: true,
      refCode: true,
      reason: true,
      detail: true,
      status: true,
      respondBy: true,
      createdAt: true,
      closedAt: true,
      aboutTyped: true,
      reporterPhoneE164: true,
      eventId: true,
      collectionId: true,
      event: { select: { title: true } },
      collection: { select: { title: true } },
    },
  })

  if (row === null) return null

  return {
    id: row.id,
    reference: `${row.refPrefix}-${row.refCode}`,
    reason: fromDbReason(row.reason),
    detail: row.detail,
    status: row.status,
    respondBy: row.respondBy,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    eventTitle: row.event?.title ?? null,
    collectionTitle: row.collection?.title ?? null,
    aboutTyped: row.aboutTyped,
    reachable: row.reporterPhoneE164 !== null,
    reporterPhoneE164: row.reporterPhoneE164,
    eventId: row.eventId,
    collectionId: row.collectionId,
  }
}

export type TriageOutcome =
  | { readonly ok: true; readonly from: ReportStatus; readonly to: ReportStatus }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-a-transition' }

/**
 * A person moving a report along.
 *
 * **This writes to `reports` and to nothing else.** Not to the event, not to
 * the collection, not to any column anywhere that could change what a visitor
 * sees. The standing rule (docs/decisions.md M3-06 §1) is that a report does
 * nothing by itself; the obvious next hole is triage doing it instead, and an
 * integration test asserts the event row is byte-identical across a full
 * received → reviewing → closed pass.
 *
 * The transition is checked in the domain and then **again as a condition on
 * the UPDATE**, the same shape as publishing (M3-02 §1): the row was read a
 * moment ago and another reviewer may have moved it since. `updateMany` with
 * the expected status in the WHERE clause means two people closing the same
 * report produce one close and one honest refusal.
 *
 * There is no DELETE grant on this table. The one thing that must not be
 * possible is a report quietly disappearing.
 */
export async function triageReport(
  db: PrismaClient,
  {
    id,
    from,
    to,
    now = new Date(),
  }: { id: string; from: ReportStatus; to: ReportStatus; now?: Date },
): Promise<TriageOutcome> {
  if (!canTriage(from, to)) return { ok: false, reason: 'not-a-transition' }

  const { count } = await db.report.updateMany({
    where: { id, status: from },
    data: {
      status: to,
      ...(to === 'closed' ? { closedAt: now } : {}),
    },
  })

  if (count !== 1) return { ok: false, reason: 'not-found' }

  return { ok: true, from, to }
}
