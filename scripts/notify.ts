/**
 * The notification flush: build the digests that are due, send what is due.
 *
 * **Run this hourly.** The digest cap is one message an hour per organiser per
 * umcimbi, so an hourly run is what makes the cap the binding constraint rather
 * than the schedule. Running it more often is harmless — the cap is enforced in
 * the database, not by the cron entry — and running it less often means an
 * organiser waits longer, not that anything is lost.
 *
 * **Counts only** — no names, no numbers, no event titles. It runs unattended
 * and its output goes to logs (CLAUDE.md rule 8).
 *
 * In an unconfigured production this stops on the first flush, loudly: no BSP
 * has been chosen (Part J item 3) and `whatsAppSender()` refuses rather than
 * handing messages to an in-memory array. The outbox keeps them, so nothing is
 * lost by the refusal — which is the whole reason the outbox exists.
 *
 * Run: `pnpm notify`
 */

import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../src/db/generated/client.ts'
import { queueReport } from '../src/db/repositories/report.ts'
import { flushNotifications } from '../src/lib/notify.ts'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://isipheko_app:isipheko_local_dev@localhost:5433/isipheko'

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  })

  try {
    const report = await flushNotifications(prisma)

    process.stdout.write(
      `${String(report.digests)} digest(s) built from ` +
        `${String(report.summarised)} update(s) — ` +
        `${String(report.summarised - report.digests)} message(s) not sent by batching.\n` +
        `${String(report.sent)} sent, ${String(report.retrying)} retrying, ` +
        `${String(report.failed)} failed.\n`,
    )

    // The report queue, **printed every run including when it is empty**.
    //
    // A number that only appears when something is wrong is a number nobody
    // notices is missing: a quiet run has to positively confirm the queue was
    // looked at, not merely fail to complain. 57% of people who report a scam
    // hear nothing back, and that is what it looks like from the inside — a job
    // that says nothing and a queue nobody reads.
    //
    // Counts only. What is *in* a report is among the most sensitive things
    // this product holds (rule 8).
    const queue = await queueReport(prisma)

    process.stdout.write(
      `reports: ${String(queue.waiting)} waiting, ` +
        `${String(queue.overdue)} past the one-working-day window` +
        `${queue.oldestWaitingHours === null ? '' : `, oldest ${String(queue.oldestWaitingHours)}h`}.\n`,
    )

    if (queue.overdue > 0) {
      process.stdout.write(
        `${String(queue.overdue)} report(s) have waited longer than we said they would. ` +
          'That is the promise on the page, so it is the one to keep.\n',
      )
    }
  } finally {
    await prisma.$disconnect()
  }
}

await main()
