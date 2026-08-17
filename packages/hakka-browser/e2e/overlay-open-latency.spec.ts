import { expect, test } from '@playwright/test'

// Latency budgets are calibrated on consistent local hardware (see
// docs reference/benchmarks); GitHub's shared runners vary several-fold
// run to run, so CI skips this file by default. Opt in: HAKKA_E2E_PERF=1.
test.skip(!!process.env.CI && !process.env.HAKKA_E2E_PERF, 'perf budgets run on consistent local hardware')

/**
 * P2 overlay open-latency gate. 5 reps of "closed-FAB-click -> request list
 * interactive" (first row painted + search focusable) under CDP 4x CPU
 * throttling — a rough mid-tier-phone emulation. Fixture uses the default
 * `'launcher'` overlay mode (src/index.ts): a tiny button mounts eagerly and
 * the Solid UI + panel load on click, the real cold-open path every user hits.
 *
 * CI_BUDGET_MS is a fixed hardcoded baseline (not recomputed per-run — a
 * self-relative budget can't catch a regression, since a slowdown would
 * inflate the gate along with the measurement), with 2.5x slack for CI's
 * concurrent-load noise. It's a tripwire for a 5x/10x regression, not a
 * "feels instant" lab bar.
 *
 * Re-baseline: run solo (`bunx playwright test overlay-open-latency
 * --project=mobile-chrome`), read the logged median, set
 * CI_BUDGET_MS = ceil(median * 2.5) rounded to a clean 50ms step, and update
 * the constant + the measured values below.
 */

const REPS = 5

// Baseline measured 2026-07-11 (Mac Mini M4, 4x CPU throttling, mobile-chrome,
// 3 solo runs, no concurrent load):
//   run 1: samples=[263,68,63,71,66]ms  median=68ms
//   run 2: samples=[138,70,65,66,69]ms  median=69ms
//   run 3: samples=[143,72,71,66,67]ms  median=71ms
// (rep 1 of each run is higher — cold fetch/eval of the lazy Solid UI chunk
// before the browser caches it; reps 2-5 are warm-cache steady state.)
// CI_BUDGET_MS = ceil(max(medians) * 2.5) = ceil(71 * 2.5) = 178, rounded to 200.
const CI_BUDGET_MS = 200

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

test('overlay open latency stays within the regression budget under 4x CPU throttling', async ({ page }) => {
  // 5 throttled reps of a lazy-chunk fetch/eval/mount can run long on a loaded CI box.
  test.slow()

  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  const samples: number[] = []

  for (let rep = 0; rep < REPS; rep++) {
    await page.goto('/e2e/fixtures/perf-open.html')
    const launcher = page.getByRole('button', { name: 'Open Hakka inspector' })
    await expect(launcher).toBeVisible()

    const start = Date.now()
    await launcher.click()

    // "Request list interactive" = first row painted + search input focusable.
    await expect(page.locator('.hakka-row').first()).toBeVisible()
    const search = page.locator('.hakka-search')
    await expect(search).toBeVisible()
    await search.focus()
    await expect(search).toBeFocused()

    samples.push(Date.now() - start)
  }

  const med = median(samples)
  // eslint-disable-next-line no-console
  console.log(`[overlay-open-latency] samples=${JSON.stringify(samples)}ms median=${med}ms budget=${CI_BUDGET_MS}ms`)

  expect(med, `median open latency ${med}ms exceeded the ${CI_BUDGET_MS}ms regression budget`).toBeLessThanOrEqual(
    CI_BUDGET_MS,
  )
})
