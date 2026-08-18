/**
 * The scheduled sweep: claims whose hold ran out, self-reported contributions
 * nobody confirmed, the two-day warning on claims about to lapse, and the
 * pruning of notifications that have been dealt with.
 *
 * One job rather than one per thing that expires. A single cron entry is one
 * thing to get wrong instead of four, and both sweeps are the same shape:
 * conditional, idempotent, and safe to run twice.
 *
 * **Counts only** — no names, no amounts, no events. It runs unattended and its
 * output goes to logs (CLAUDE.md rule 8), where a bereavement event's amounts
 * have no business appearing.
 *
 * Run: `pnpm expire`
 */

import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../src/db/generated/client.ts'
import { expireLapsedClaims, warnExpiringClaims } from '../src/db/repositories/needs.ts'
import { expireStaleContributions } from '../src/db/repositories/contribution.ts'
import { pruneNotifications } from '../src/db/repositories/notifications.ts'

/**
 * How long a sent or failed notification is kept.
 *
 * These rows hold a name and a phone number in their parameters and have no
 * evidential value once the message has gone — unlike the ledger, which is
 * never deleted at all. Thirty days is long enough to answer "did they get
 * told?" during the umcimbi itself and short enough to honour architecture
 * §11's retention rule.
 */
const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://isipheko_app:isipheko_local_dev@localhost:5433/isipheko'

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  })

  try {
    const claims = await expireLapsedClaims(prisma)
    const contributions = await expireStaleContributions(prisma)
    // Before the sweep would have expired them: the point of the warning is
    // that somebody can still release the thing in time for the family to ask
    // elsewhere (§8.2).
    const warned = await warnExpiringClaims(prisma)
    const pruned = await pruneNotifications(prisma, {
      olderThanMs: NOTIFICATION_RETENTION_MS,
    })

    process.stdout.write(
      `${String(claims.claims)} claim(s) expired, ` +
        `${String(claims.quantity)} returned to the board.\n` +
        `${String(contributions)} unconfirmed contribution(s) voided after fourteen days.\n` +
        `${String(warned)} claim(s) warned two days out.\n` +
        `${String(pruned.notifications)} notification(s) and ` +
        `${String(pruned.entries)} digest entr(ies) pruned after thirty days.\n`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

await main()
