import { defineConfig, devices } from '@playwright/test'

/**
 * Mobile-viewport E2E for the hakka-browser overlay.
 *
 * The demo (`demo/index.html`) loads the built IIFE bundle, so the suite serves the
 * package root statically (python3 http.server) and drives `/demo/index.html` on a
 * phone profile. Build first: the `test:e2e` script runs `bun run build` before this.
 */
const PORT = 4173

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }],
  webServer: {
    // Serve the package root so /demo/index.html can load /dist/* (the demo references ../dist).
    command: `python3 -m http.server ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
