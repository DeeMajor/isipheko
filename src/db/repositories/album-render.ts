import type { PrismaClient } from '../generated/client.ts'

/**
 * The print-ready album's job rows.
 *
 * **Queued, never synchronous.** Rendering four hundred entries and their
 * photographs is seconds of CPU — every photo is AVIF, and a PDF holds neither
 * AVIF nor WebP, so each one is decoded and re-encoded on the way in. No
 * organiser should watch a spinner for that, and no web worker should be held
 * open for it.
 *
 * There is no Redis and no BullMQ. M1-06 §4 and M2-08 §1 both declined to add
 * one and this task did not change the answer: `pnpm render` picks these rows
 * up exactly as `pnpm notify` and `pnpm expire` pick up theirs.
 *
 * Relative imports, like the other repositories a script has to load — see
 * docs/decisions.md M2-01 §8.
 */

/**
 * How many times a render is picked up before it is left alone.
 *
 * A job retried forever is a job that fails forever in silence and burns a
 * scheduled run each time. Three attempts, then the row says so and the
 * organiser's screen says so too.
 */
export const MAX_RENDER_ATTEMPTS = 3

export type AlbumRenderStatus = 'pending' | 'rendering' | 'ready' | 'failed'

export interface AlbumRenderRow {
  readonly id: string
  readonly eventId: string
  readonly version: string
  readonly status: AlbumRenderStatus
  readonly objectKey: string | null
  readonly attempts: number
  readonly lastError: string | null
  readonly requestedAt: Date
  readonly completedAt: Date | null
}

const SELECT = {
  id: true,
  eventId: true,
  version: true,
  status: true,
  objectKey: true,
  attempts: true,
  lastError: true,
  requestedAt: true,
  completedAt: true,
} as const

/**
 * Ask for the album at this version, or find the request that already exists.
 *
 * Idempotent by `(event, version)`, which is what makes the button safe to
 * press twice on a connection that has already eaten one tap — and what makes a
 * second request for an unchanged record cost nothing at all: it returns the
 * finished file rather than queueing a rebuild of it.
 *
 * A **failed** render at the same version is reset to pending. Somebody
 * pressing the button again after being told it did not work is asking for
 * exactly that, and refusing them because a row exists would be the system
 * remembering its own failure better than it serves them.
 */
export async function requestRender(
  db: PrismaClient,
  {
    eventId,
    version,
    now,
  }: { eventId: string; version: string; now: Date },
): Promise<AlbumRenderRow> {
  const existing = await db.albumRender.findUnique({
    where: { eventId_version: { eventId, version } },
    select: SELECT,
  })

  if (existing !== null) {
    if (existing.status !== 'failed') return existing

    const retried = await db.albumRender.update({
      where: { id: existing.id },
      data: { status: 'pending', attempts: 0, lastError: null, requestedAt: now },
      select: SELECT,
    })

    return retried
  }

  return db.albumRender.create({
    data: { eventId, version, requestedAt: now },
    select: SELECT,
  })
}

/**
 * The newest render for an event, whatever state it is in.
 *
 * What the dashboard reads. It does not filter to `ready`: a screen that shows
 * nothing while a job is queued is a screen that looks broken, and one that
 * shows nothing after a failure is one that loses the failure.
 */
export async function latestRender(
  db: PrismaClient,
  eventId: string,
): Promise<AlbumRenderRow | null> {
  return db.albumRender.findFirst({
    where: { eventId },
    orderBy: { requestedAt: 'desc' },
    select: SELECT,
  })
}

export async function renderAt(
  db: PrismaClient,
  { eventId, version }: { eventId: string; version: string },
): Promise<AlbumRenderRow | null> {
  return db.albumRender.findUnique({
    where: { eventId_version: { eventId, version } },
    select: SELECT,
  })
}

/**
 * Take the next pending job, if there is one.
 *
 * The claim is a **conditional update** rather than a read followed by a write:
 * two runs of `pnpm render` overlapping — a slow one and the next hour's — must
 * not both render the same album, and `status: 'pending'` in the `where` is
 * what makes exactly one of them win. The same shape as claiming the last chair
 * (M2-04), for the same reason.
 */
export async function claimNextRender(
  db: PrismaClient,
  { now }: { now: Date },
): Promise<AlbumRenderRow | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = await db.albumRender.findFirst({
      where: { status: 'pending', attempts: { lt: MAX_RENDER_ATTEMPTS } },
      orderBy: { requestedAt: 'asc' },
      select: SELECT,
    })

    if (candidate === null) return null

    const { count } = await db.albumRender.updateMany({
      where: { id: candidate.id, status: 'pending' },
      data: { status: 'rendering', startedAt: now, attempts: { increment: 1 } },
    })

    if (count === 1) {
      return { ...candidate, status: 'rendering', attempts: candidate.attempts + 1 }
    }

    // Somebody else took it between the read and the update. Look again.
  }

  return null
}

export async function markRendered(
  db: PrismaClient,
  { id, objectKey, now }: { id: string; objectKey: string; now: Date },
): Promise<void> {
  await db.albumRender.updateMany({
    where: { id, status: 'rendering' },
    data: { status: 'ready', objectKey, completedAt: now, lastError: null },
  })
}

/**
 * A render that did not work.
 *
 * `reason` is a short phrase written by the caller, never an exception message
 * and never a stack trace: this string reaches a screen and a log, and neither
 * is a place for a file path or anybody's name (rule 8).
 *
 * Back to `pending` while attempts remain, so the next scheduled run picks it
 * up without anybody asking again. `failed` once they are spent — a job retried
 * forever is a job that fails forever in silence.
 */
export async function markRenderFailed(
  db: PrismaClient,
  { id, reason, now }: { id: string; reason: string; now: Date },
): Promise<void> {
  const row = await db.albumRender.findUnique({
    where: { id },
    select: { attempts: true },
  })

  const spent = (row?.attempts ?? MAX_RENDER_ATTEMPTS) >= MAX_RENDER_ATTEMPTS

  await db.albumRender.updateMany({
    where: { id, status: 'rendering' },
    data: {
      status: spent ? 'failed' : 'pending',
      lastError: reason,
      ...(spent ? { completedAt: now } : {}),
    },
  })
}

export interface RenderQueueSummary {
  readonly pending: number
  readonly rendering: number
  readonly failed: number
}

/** Counts only — this prints on every run of an unattended job (rule 8). */
export async function renderQueue(db: PrismaClient): Promise<RenderQueueSummary> {
  const [pending, rendering, failed] = await Promise.all([
    db.albumRender.count({ where: { status: 'pending' } }),
    db.albumRender.count({ where: { status: 'rendering' } }),
    db.albumRender.count({ where: { status: 'failed' } }),
  ])

  return { pending, rendering, failed }
}
