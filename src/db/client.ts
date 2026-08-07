import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import { env } from '@/lib/env'

/**
 * The Prisma client, connected as **isipheko_app** — the role that holds INSERT
 * and SELECT on `ledger_entries` and deliberately not UPDATE or DELETE
 * (CLAUDE.md rule 3).
 *
 * That is not a detail of local setup. It is the last line of the append-only
 * guarantee: application code that tries to rewrite a ledger row gets a
 * privilege error from Postgres rather than a silent success, whatever the ORM
 * was asked to do, and whatever a future refactor believes it is doing.
 *
 * Migrations connect as a different role entirely, over
 * `MIGRATION_DATABASE_URL`, configured in prisma.config.ts. The separation is
 * two variables and two code paths, so collapsing them takes a deliberate edit.
 *
 * The singleton exists because Next's dev server re-evaluates modules on every
 * change, and a fresh pool per reload exhausts Postgres connections within a few
 * minutes of editing.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    // Queries carry contributor names and amounts (CLAUDE.md rule 8). Errors
    // and warnings only — never `query`, in any environment.
    log: ['warn', 'error'],
  })
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient()

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
