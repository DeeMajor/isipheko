import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import {
  MAX_RENDER_ATTEMPTS,
  claimNextRender,
  latestRender,
  markRenderFailed,
  renderQueue,
} from '@/db/repositories/album-render'
import {
  confirmContribution,
  selfReport,
  startContribution,
} from '@/db/repositories/contribution'
import { createDraft } from '@/db/repositories/event'
import { fromCents } from '@/domain/money'

import { clientFor } from '../setup/prisma'

/**
 * The printable album's job, against a real Postgres.
 *
 * **Queued, not synchronous** — the criterion this file exists for. What is
 * asserted is the shape that makes a queue a queue without a queue server: a
 * request writes a row, a claim is a conditional update so two runs cannot take
 * the same job, and a failure comes back rather than disappearing.
 */

let app: PrismaClient
let organiserId: string
let counter = 0
let storeRoot: string

type PdfModule = typeof import('@/lib/album-pdf')
let albums: PdfModule

beforeAll(async () => {
  // Set before the dynamic import: the object store reads its root once, at
  // module load.
  storeRoot = await mkdtemp(join(tmpdir(), 'isipheko-albums-'))
  process.env.OBJECT_STORE_DIR = storeRoot

  albums = await import('@/lib/album-pdf')

  app = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(
    app,
    `+2787${String(++counter).padStart(7, '0')}`,
  )
  organiserId = organiser.id
})

afterAll(async () => {
  await app.$disconnect()
})

interface Fixture {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly archetype: 'umngcwabo'
  readonly organiserName: string | null
  readonly place: string | null
  readonly eventDate: Date | null
}

async function newEvent(): Promise<Fixture> {
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: 'KwaMashu',
    eventDate: null,
  })

  const row = await app.event.findUniqueOrThrow({
    where: { id: draft.id },
    select: { slug: true },
  })

  return {
    id: draft.id,
    slug: row.slug,
    title: 'Nokuthula Mthembu',
    archetype: 'umngcwabo',
    organiserName: 'Nomsa Mthembu',
    place: 'KwaMashu',
    eventDate: null,
  }
}

/** The whole Mode A path, because only a confirmed contribution is a record. */
async function contribute(event: Fixture, name: string, message?: string): Promise<void> {
  const started = await startContribution(app, {
    eventId: event.id,
    eventTitle: event.title,
    type: 'cash',
    amountCents: fromCents(50_000n),
    contributorName: name,
    message: message ?? null,
    visibility: 'public',
  })

  await selfReport(app, { contributionId: started.id })

  const outcome = await confirmContribution(app, {
    contributionId: started.id,
    organiserId,
  })

  if (!outcome.ok) throw new Error(`confirm failed: ${outcome.reason}`)
}

const NOW = new Date('2026-08-18T09:00:00.000Z')

/**
 * Resolves any event, the way `scripts/render.ts` does.
 *
 * The sweep drains a **global** queue, so a resolver that knew only one event
 * would fail every job another test in this file had left pending — and the
 * failure would look like this task's rather than the fixture's.
 */
const subjectFor = async (eventId: string): Promise<Fixture | null> => {
  const row = await app.event.findUnique({
    where: { id: eventId },
    select: { id: true, slug: true, title: true, place: true, eventDate: true },
  })

  if (row === null) return null

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    archetype: 'umngcwabo',
    organiserName: 'Nomsa Mthembu',
    place: row.place,
    eventDate: row.eventDate,
  }
}

/**
 * Empties the queue of everything this file left in it.
 *
 * `claimNextRender` takes the oldest pending job on the **whole table**, which
 * is what production wants and what makes a test about "the next job" depend on
 * every test before it. Draining first makes each of those tests about its own
 * row again.
 */
async function drainQueue(): Promise<void> {
  for (let taken = 0; taken < 100; taken += 1) {
    const job = await claimNextRender(app, { now: NOW })
    if (job === null) return

    await markRenderFailed(app, { id: job.id, reason: 'drained by a test', now: NOW })
  }
}

describe('asking for one', () => {
  it('writes a pending job, and asking twice writes one', async () => {
    const event = await newEvent()
    await contribute(event, 'Thandi Ngcobo')

    const first = await albums.requestAlbumPdf(app, event, { now: NOW })
    const second = await albums.requestAlbumPdf(app, event, { now: NOW })

    expect(first?.status).toBe('pending')
    // The button is safe to press twice on a connection that has already eaten
    // one tap.
    expect(second?.id).toBe(first?.id)

    const rows = await app.albumRender.count({ where: { eventId: event.id } })
    expect(rows).toBe(1)
  })

  it('refuses to queue a book with nothing in it', async () => {
    const event = await newEvent()

    // Not an error and not an empty PDF: the screen says there is nothing to
    // print, and no job is created to produce it.
    expect(await albums.requestAlbumPdf(app, event, { now: NOW })).toBeNull()
    expect(await app.albumRender.count({ where: { eventId: event.id } })).toBe(0)
  })

  /**
   * The property that matters on paper. A family who printed in August and
   * again in October hold two different books at two different addresses,
   * rather than one URL that changed underneath them.
   */
  it('mints a new version when the record grows', async () => {
    const event = await newEvent()
    await contribute(event, 'Thandi Ngcobo')

    const before = await albums.requestAlbumPdf(app, event, { now: NOW })

    await contribute(event, 'Sipho Dlamini')
    const after = await albums.requestAlbumPdf(app, event, { now: NOW })

    expect(after?.version).not.toBe(before?.version)
    expect(await app.albumRender.count({ where: { eventId: event.id } })).toBe(2)
  })
})

describe('the sweep', () => {
  it('renders a queued album, stores it, and marks it ready', async () => {
    const event = await newEvent()
    await contribute(event, 'Thandi Ngcobo', 'Sisemuva kwenu.')
    await contribute(event, 'Sipho Dlamini')

    const requested = await albums.requestAlbumPdf(app, event, { now: NOW })
    expect(requested?.status).toBe('pending')

    const report = await albums.renderPendingAlbums(app, { now: NOW, subjectFor })

    expect(report.rendered).toBeGreaterThanOrEqual(1)
    expect(report.failed).toBe(0)

    const done = await latestRender(app, event.id)
    expect(done?.status).toBe('ready')
    expect(done?.objectKey).toBe(`album/${event.id}/${done?.version ?? ''}.pdf`)
    expect(done?.completedAt).not.toBeNull()

    // And there is a real PDF where it says there is.
    const { objectStore } = await import('@/adapters/storage')
    const stored = await objectStore().get(done?.objectKey ?? '')

    expect(stored?.contentType).toBe('application/pdf')
    expect(Buffer.from(stored?.bytes ?? new Uint8Array()).toString('latin1')).toMatch(
      /^%PDF-/,
    )

    const written = await readdir(join(storeRoot, 'album', event.id))
    expect(written.filter((name) => name.endsWith('.pdf'))).toHaveLength(1)
  }, 60_000)

  it('does nothing, quietly, when nothing is waiting', async () => {
    await drainQueue()

    const report = await albums.renderPendingAlbums(app, { now: NOW, subjectFor })

    expect(report).toEqual({ rendered: 0, failed: 0 })
  })
})

describe('claiming', () => {
  /**
   * The conditional update that makes this a queue without a queue server.
   *
   * A slow run and the next hour's must not render the same album between them
   * — the same shape as claiming the last chair (M2-04), and for the same
   * reason: two winners is two of something there is one of.
   */
  it('gives a job to exactly one caller', async () => {
    await drainQueue()
    const event = await newEvent()
    await contribute(event, 'Thandi Ngcobo')
    await albums.requestAlbumPdf(app, event, { now: NOW })

    const [first, second] = await Promise.all([
      claimNextRender(app, { now: NOW }),
      claimNextRender(app, { now: NOW }),
    ])

    const claimed = [first, second].filter((row) => row !== null)

    expect(claimed).toHaveLength(1)
    expect(claimed[0]?.status).toBe('rendering')
    expect(claimed[0]?.attempts).toBe(1)
  })
})

describe('failure', () => {
  it('comes back to pending while attempts remain, and is not lost', async () => {
    await drainQueue()
    const event = await newEvent()
    await contribute(event, 'Thandi Ngcobo')
    await albums.requestAlbumPdf(app, event, { now: NOW })

    const job = await claimNextRender(app, { now: NOW })
    await markRenderFailed(app, {
      id: job?.id ?? '',
      reason: 'no such event',
      now: NOW,
    })

    const row = await latestRender(app, event.id)

    expect(row?.status).toBe('pending')
    expect(row?.lastError).toBe('no such event')
    expect(row?.attempts).toBe(1)
  })

  /**
   * A job retried forever is a job that fails forever in silence and burns a
   * scheduled run every hour doing it.
   */
  it('gives up after the third attempt, and says so', async () => {
    await drainQueue()
    const event = await newEvent()
    await contribute(event, 'Thandi Ngcobo')
    await albums.requestAlbumPdf(app, event, { now: NOW })

    for (let attempt = 0; attempt < MAX_RENDER_ATTEMPTS; attempt += 1) {
      const job = await claimNextRender(app, { now: NOW })
      expect(job).not.toBeNull()

      await markRenderFailed(app, { id: job?.id ?? '', reason: 'broken', now: NOW })
    }

    const row = await latestRender(app, event.id)
    expect(row?.status).toBe('failed')
    expect(row?.attempts).toBe(MAX_RENDER_ATTEMPTS)

    // And it is not picked up again.
    expect(await claimNextRender(app, { now: NOW })).toBeNull()
  })

  /**
   * Somebody pressing the button again after being told it did not work is
   * asking for exactly that. Refusing because a row exists would be the system
   * remembering its own failure better than it serves them.
   */
  it('is retried when the organiser asks again', async () => {
    await drainQueue()
    const event = await newEvent()
    await contribute(event, 'Thandi Ngcobo')
    await albums.requestAlbumPdf(app, event, { now: NOW })

    for (let attempt = 0; attempt < MAX_RENDER_ATTEMPTS; attempt += 1) {
      const job = await claimNextRender(app, { now: NOW })
      await markRenderFailed(app, { id: job?.id ?? '', reason: 'broken', now: NOW })
    }

    expect((await latestRender(app, event.id))?.status).toBe('failed')

    const again = await albums.requestAlbumPdf(app, event, { now: NOW })

    expect(again?.status).toBe('pending')
    expect(again?.attempts).toBe(0)
    expect(again?.lastError).toBeNull()
  })

  it('reports the queue as counts and nothing else', async () => {
    const summary = await renderQueue(app)

    expect(Object.keys(summary).sort()).toEqual(['failed', 'pending', 'rendering'])
    for (const value of Object.values(summary)) {
      expect(typeof value).toBe('number')
    }
  })
})

describe('the app role', () => {
  /**
   * A row saying a render failed three times is exactly the row somebody would
   * want gone and exactly the one worth keeping. The grant is the enforcement,
   * not a convention (M1-02).
   */
  it('cannot delete a render', async () => {
    const event = await newEvent()
    await contribute(event, 'Thandi Ngcobo')
    const requested = await albums.requestAlbumPdf(app, event, { now: NOW })

    await expect(
      app.$executeRawUnsafe(
        `DELETE FROM album_renders WHERE id = '${requested?.id ?? ''}'`,
      ),
    ).rejects.toThrow()
  })
})
