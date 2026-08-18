import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
// localhost, not 127.0.0.1: `next dev` serves its own chunks and HMR endpoint
// from localhost and blocks them as cross-origin when the page is loaded over
// the IP. The page still renders — it is a server component — so the suite goes
// green while no client JavaScript has loaded at all. That would quietly hollow
// out the visual and axe projects arriving in M1-05.
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // One browser at M1-01. The visual and axe projects across all six
    // archetypes arrive with the UI primitives (M1-05).
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Who may open the review queue (M3-07). The allowlist is read from the
      // environment at boot — deliberately, because the application role holds
      // UPDATE on `organisers` and a column would be a privilege the app could
      // grant itself. A pool rather than one number so that `review.spec.ts`
      // has headroom against the three-codes-per-number-per-hour limit across
      // a run and its retries.
      ADMIN_PHONE_NUMBERS:
        '+27820000901,+27820000902,+27820000903,+27820000904,+27820000905,+27820000906',
    },
  },
})
