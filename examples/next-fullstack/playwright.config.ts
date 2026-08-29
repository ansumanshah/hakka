import { defineConfig, devices } from '@playwright/test'

/**
 * E2E for the Next.js full-stack example — the one thing the ~4,200 unit tests elsewhere in this
 * repo cannot cover: does the real overlay mount in a real browser, and does a real click produce
 * the client + server tagged rows the README claims? `webServer` builds nothing itself — the
 * example's `hakka-browser`/`hakka-node` deps are `file:` links to `packages/*`, so
 * `just build-core build-bridge build-node build-browser` must run first (see e2e/README or the
 * repo root README) or `next dev` boots against stale/missing dist output.
 */
const PORT = 3000

export default defineConfig({
  testDir: './e2e',
  // Serial, not fullyParallel: every test shares the one `next dev` instance `webServer`
  // starts below. Concurrent first-hits to different routes raced Turbopack's on-demand
  // compilation badly enough to produce a transient "Module not found: hakka-node/next/client"
  // and, downstream of that, a client-side double-fetch — see e2e/README.md.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
