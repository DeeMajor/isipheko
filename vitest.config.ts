import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./src/*" mapping in tsconfig.json. Kept manual so
    // the scaffold carries no extra dependency for path resolution.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // E2E is Playwright's, run separately via `pnpm test:e2e`. Browser
    // downloads in the main gate are how you get people to stop running it.
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**'],
  },
})
