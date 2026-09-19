import { defineConfig, devices } from '@playwright/test'

/**
 * Mobile/narrow-viewport E2E for the hakka-browser overlay across three engines.
 *
 * The demo (`examples/browser-demo/index.html`) loads the built IIFE bundle, so the suite serves the
 * repository root statically (python3 http.server) and drives `/examples/browser-demo/index.html` on a
 * phone profile (a narrow desktop viewport in Firefox). CDP-only tests stay on Chromium.
 * Build first: the `test:e2e` script runs `bun run build` before this.
 */
const PORT = 4173
const commonUiTests = [
  'components-standalone.spec.ts',
  'docs-embeds.spec.ts',
  'inspector.mobile.spec.ts',
  'overlay-mount.spec.ts',
]

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', testMatch: commonUiTests, use: { ...devices['iPhone 13'] } },
    {
      name: 'narrow-firefox',
      testMatch: commonUiTests,
      use: { browserName: 'firefox', viewport: { width: 393, height: 851 } },
    },
  ],
  webServer: {
    // Serve root demos while preserving package-relative fixture and benchmark URLs.
    command: `python3 ../../scripts/serve-browser-demo.py ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
