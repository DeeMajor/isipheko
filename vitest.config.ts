import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const alias = {
  // Mirrors the "@/*" -> "./src/*" mapping in tsconfig.json. Kept manual so
  // the scaffold carries no extra dependency for path resolution.
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

/**
 * Two projects, and only the first one runs on `pnpm test`.
 *
 * `unit` is pure and fast, so it stays runnable on every save. `integration`
 * starts a real Postgres in a container, which takes tens of seconds and needs a
 * working container runtime — putting that in the main gate is how people stop
 * running the main gate.
 *
 * **A green `pnpm test` is not a green build.** The constraints proved by the
 * integration project — the bereavement CHECK, the append-only ledger, the
 * absence of a money path on collections — are the ones guarding a funeral page
 * and the trust artefact, and they are exactly the ones a hurried run skips.
 * `pnpm test:all` runs both, and CI runs both.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          // `.tsx` because the Ledger Strand's render test renders it (M2-06).
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          // One container for the whole project rather than one per file.
          globalSetup: ['tests/setup/postgres.ts'],
          // Pulling the image and running migrations on a cold cache is slow,
          // and slower again on a poor connection.
          testTimeout: 60_000,
          hookTimeout: 180_000,
          // The tests share one database. Running them concurrently would make
          // failures depend on each other's rows.
          fileParallelism: false,
        },
      },
    ],
  },
})
