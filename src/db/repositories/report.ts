import type { PrismaClient } from '../generated/client.ts'
import { generateCode } from '../../domain/reference/index.ts'
import {
  MAX_REPORTS_PER_ADDRESS_PER_HOUR,
  respondBy,
  type ReportReason,
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
