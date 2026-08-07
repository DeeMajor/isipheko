import { defineConfig } from 'prisma/config'

// Relative path, not '@/lib/env': the Prisma CLI loads this file outside the
// Next.js runtime, where the tsconfig path alias does not resolve. Same reason
// next.config.ts imports it this way.
//
// Importing it rather than reading process.env directly means the migration
// tooling and the application agree on what a valid environment is, and on the
// development defaults — so a clean clone can `pnpm install` and generate a
// client with no .env file, while production still refuses to start on a
// missing variable.
import { env } from './src/lib/env'

/**
 * Prisma 7 reads migration configuration from here rather than from
 * schema.prisma.
 *
 * **This file uses the owner role, and only the owner role.** Migrations create
 * tables, alter default privileges and revoke rights from the application role;
 * none of that is available to the role the application connects as, and that is
 * exactly the point (CLAUDE.md rule 3).
 *
 * The runtime connection is built separately, in src/db/client.ts, from
 * `DATABASE_URL` — the application role. Two variables, two code paths. Making
 * the application run as the owner takes a deliberate edit rather than an
 * accident of configuration.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env.MIGRATION_DATABASE_URL,
  },
})
