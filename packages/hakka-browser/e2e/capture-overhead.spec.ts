import { expect, test, type Page } from '@playwright/test'

// Per-request main-thread cost is calibrated on consistent local hardware; shared CI
// runners vary several-fold, so CI skips this file by default. Opt in: HAKKA_E2E_PERF=1.
test.beforeEach(() => {
  test.skip(!!process.env.CI && !process.env.HAKKA_E2E_PERF, 'capture overhead runs on consistent local hardware')
})

/**
 * Real-browser capture overhead. packages/hakka-bench prices the interceptor against a
 * Bun/happy-dom stub, which cannot see the cost of `Response` stream plumbing; this
 * measures the same interception inside Chromium, awaiting each `fetch()` against an
 * instantly resolving stub. Budgets are loose regression ceilings (measured ~4x
 * headroom) so a return to a clone-and-read-the-tee capture path (~1 ms/request) fails.
 */

const N = 5000
const WARMUP = 500

async function perRequestMicros(page: Page, capture: boolean): Promise<number> {
  await page.goto(`/e2e/fixtures/capture-overhead.html${capture ? '' : '?capture=0'}`)
  return page.evaluate(
    async ({ n, warmup }) => {
      for (let i = 0; i < warmup; i++) await fetch('https://api.example.com/users')
      const t0 = performance.now()
      for (let i = 0; i < n; i++) await fetch(`https://api.example.com/users?i=${i}`)
      return ((performance.now() - t0) * 1000) / n
    },
    { n: N, warmup: WARMUP },
  )
}

test.describe('capture overhead (real Chromium)', () => {
  test.describe.configure({ mode: 'serial' })

  test('small JSON response stays under the per-request budget', async ({ page }) => {
    test.setTimeout(120_000)
    const baseline = await perRequestMicros(page, false)
    const captured = await perRequestMicros(page, true)
    // eslint-disable-next-line no-console
    console.log(`[capture-overhead] small body: baseline=${baseline.toFixed(1)}us captured=${captured.toFixed(1)}us`)
    expect(captured, `captured fetch cost ${captured.toFixed(1)}us/request`).toBeLessThan(600)
  })
})
