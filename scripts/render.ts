/**
 * The album render sweep: build the printable albums somebody has asked for.
 *
 * **Run this hourly.** The organiser's screen says "usually ready within the
 * hour", and that sentence is only true because of the cron entry — if the
 * schedule changes, `albumCopy.print.queued` changes with it (docs/decisions.md
 * M4-03 §10).
 *
 * Its own job rather than folded into `pnpm expire`. Expire is fast and
 * idempotent and always takes about two seconds; this decodes and re-encodes
 * every photograph in an album and can take minutes. A cron entry that
 * sometimes runs long is a different operational animal from one that never
 * does, and giving them one entry would make both harder to reason about.
 *
 * Safe to run twice at once. Each job is claimed with a conditional update, so
 * a slow run and the next hour's cannot render the same album between them.
 *
 * **Counts only** — no names, no titles, no event ids. It runs unattended and
 * its output goes to logs (CLAUDE.md rule 8).
 *
 * Run: `pnpm render`
 */

import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../src/db/generated/client.ts'
import { renderQueue } from '../src/db/repositories/album-render.ts'
import { renderPendingAlbums } from '../src/lib/album-pdf.ts'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://isipheko_app:isipheko_local_dev@localhost:5433/isipheko'

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  })

  const now = new Date()

  try {
    const report = await renderPendingAlbums(prisma, {
      now,
      subjectFor: async (eventId) => {
        const event = await prisma.event.findUnique({
          where: { id: eventId },
          select: {
            id: true,
            slug: true,
            title: true,
            archetype: true,
            place: true,
            eventDate: true,
            organiser: { select: { displayName: true } },
          },
        })

        if (event === null) return null

        return {
          id: event.id,
          slug: event.slug,
          title: event.title,
          archetype: event.archetype,
          organiserName: event.organiser?.displayName ?? null,
          place: event.place,
          eventDate: event.eventDate,
        }
      },
    })

    /*
     * Printed every run **including when there is nothing to do**.
     *
     * A number that only appears when something is wrong is a number nobody
     * notices is missing — the same reasoning the report queue's line carries
     * (M3-06). A quiet run has to positively confirm the queue was looked at.
     */
    const queue = await renderQueue(prisma)

    process.stdout.write(
      `albums: ${String(report.rendered)} rendered, ` +
        `${String(report.failed)} failed this run.\n` +
        `queue: ${String(queue.pending)} waiting, ` +
        `${String(queue.rendering)} in progress, ` +
        `${String(queue.failed)} given up on.\n`,
    )

    // A job stuck in `rendering` is one whose process died mid-render. It is
    // worth naming, because nothing else will ever pick it up.
    if (queue.rendering > 0) {
      process.stdout.write(
        'Some albums are marked in progress. If that number does not fall, a ' +
          'previous run was killed part-way and those rows need resetting.\n',
      )
    }
  } finally {
    await prisma.$disconnect()
  }
}

await main()
