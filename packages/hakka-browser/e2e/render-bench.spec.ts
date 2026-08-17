import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

// Render-latency budgets are calibrated on consistent local hardware; shared
// CI runners vary several-fold, so CI skips this file by default.
// Opt in: HAKKA_E2E_PERF=1.
test.skip(!!process.env.CI && !process.env.HAKKA_E2E_PERF, 'render bench runs on consistent local hardware')

/**
 * Render-latency benchmark — the Solid 2.0 `createProjection` adoption
 * baseline (see .claude/strategy/solid-2-playbook.md, "2.0-native UX pass",
 * item 1). Measures RENDERING end-to-end through the real Solid UI in real
 * Chromium (ingest -> store round-trip -> reactive recompute -> DOM paint),
 * not capture (bench/capture-overhead.mjs prices that in isolation). Four
 * scenarios: cold-open-10k, ingest-paint-latency, update-propagation,
 * filter-latency. Full methodology (seeding determinism, timing technique,
 * shadow-DOM query rules, ceiling philosophy) is in
 * docs/src/content/docs/concepts/performance.md — this header states only
 * what the code below can't: assertions are loose regression ceilings, not a
 * lab-conditions bar, so a loaded CI box never flakes.
 */

interface HakkaBenchWindow {
  Hakka: {
    ingest: (req: Record<string, unknown>) => void
    getLogs: () => Promise<{ id: string; startTime: number }[]>
  }
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))
  return sorted[idx]!
}

/** Seed `count` deterministic records via the public `Hakka.ingest()` API, then block until
 * `Hakka.getLogs()` reports all of them landed in the store (the Worker round-trip is async).
 * When `markerMod` is set, every id with `i % markerMod === 733` gets a distinguishable URL
 * segment — mirrors scale-10k.spec.ts's marker-distribution technique for filter-latency. */
async function seedRecords(
  page: Page,
  opts: { count: number; idPrefix: string; markerMod?: number; markerText?: string },
): Promise<void> {
  const { count, idPrefix, markerMod, markerText = 'rbmarker' } = opts
  await page.evaluate(
    ({ count, idPrefix, markerMod, markerText }) => {
      const w = window as unknown as HakkaBenchWindow
      const now = Date.now() // see the file-header comment on why startTime anchors to real time
      for (let i = 0; i < count; i++) {
        const isMarker = markerMod ? i % markerMod === 733 % markerMod : false
        w.Hakka.ingest({
          id: `${idPrefix}-${i}`,
          url: `https://api.example.com/${isMarker ? `${markerText}/` : 'resource/'}${i}`,
          method: i % 4 === 0 ? 'POST' : 'GET',
          status: i % 97 === 0 ? 500 : 200,
          startTime: now - (count - i),
          duration: 10 + (i % 250),
          source: 'fetch',
          responseHeaders: { 'content-type': 'application/json' },
          contentType: 'application/json',
        })
      }
    },
    { count, idPrefix, markerMod, markerText },
  )
  // getLogs() resolves from the store's own thread — waiting on it (not a UI
  // signal) is what lets seeding happen with the panel closed, for cold-open.
  await page.evaluate(async (total) => {
    const w = window as unknown as HakkaBenchWindow
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const logs = await w.Hakka.getLogs()
      if (logs.length >= total) return
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 25))
    }
  }, count)
}

/** Click the closed-panel launcher and wait (in-page, rAF-polled) for the first windowed row.
 * Not timed itself — call `timedColdOpen` for the measured version. */
async function openPanelAndWaitFirstRow(page: Page): Promise<void> {
  await page.evaluate(async () => {
    function shadow(): ShadowRoot | null {
      return (document.querySelector('hakka-inspector') as HTMLElement | null)?.shadowRoot ?? null
    }
    const btn = document.querySelector('button[aria-label="Open Hakka inspector"]') as HTMLButtonElement | null
    if (!btn) throw new Error('launcher button not found')
    btn.click()
    await new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + 15_000
      function tick(): void {
        const sr = shadow()
        if (sr?.querySelector('.hakka-row')) {
          resolve()
          return
        }
        if (performance.now() > deadline) {
          reject(new Error('timeout waiting for the panel to open'))
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  })
}

interface BenchResult {
  coldOpen10k: { ms: number; samples: number[] }
  ingestPaintLatency: { samples: number[]; medianMs: number; p95Ms: number }
  updatePropagation: { samples: number[]; medianMs: number; p95Ms: number }
  filterLatency: { samples: number[]; medianMs: number; p95Ms: number }
  meta: {
    measuredAt: string
    coldOpenRecords: number
    ingestPaintReps: number
    ingestPaintBaselineRecords: number
    updatePropagationReps: number
    updatePropagationRecords: number
    filterLatencyReps: number
    filterLatencyRecords: number
  }
}

const result: Partial<BenchResult> = {}

test.describe('render-latency benchmark (createProjection baseline)', () => {
  // Serial: fullyParallel would fork separate worker processes and break the shared
  // `result` accumulator (afterAll below), and four 10k-record CPU-heavy scenarios
  // racing for the same cores would skew each other's timings anyway.
  test.describe.configure({ mode: 'serial' })

  test('cold-open-10k: seed 10k records with the panel closed, then time first windowed row', async ({ page }) => {
    test.setTimeout(60_000)

    // 3 reps on fresh navigations — a single sample was noisy run-to-run (worker/GC
    // scheduling on a shared box), so this reports the median of 3 cold opens.
    const REPS = 3
    const TOTAL = 10_000
    const samples: number[] = []
    for (let rep = 0; rep < REPS; rep++) {
      // eslint-disable-next-line no-await-in-loop
      await page.goto('/e2e/fixtures/render-bench.html')
      // eslint-disable-next-line no-await-in-loop
      await seedRecords(page, { count: TOTAL, idPrefix: 'cold' })

      // eslint-disable-next-line no-await-in-loop
      const ms = await page.evaluate(async () => {
        function shadow(): ShadowRoot | null {
          return (document.querySelector('hakka-inspector') as HTMLElement | null)?.shadowRoot ?? null
        }
        const btn = document.querySelector('button[aria-label="Open Hakka inspector"]') as HTMLButtonElement | null
        if (!btn) throw new Error('launcher button not found')
        const t0 = performance.now()
        btn.click()
        await new Promise<void>((resolve, reject) => {
          const deadline = performance.now() + 30_000
          function tick(): void {
            const sr = shadow()
            if (sr?.querySelector('.hakka-row')) {
              resolve()
              return
            }
            if (performance.now() > deadline) {
              reject(new Error('timeout waiting for the panel to open'))
              return
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
        return performance.now() - t0
      })
      samples.push(ms)
    }

    const med = median(samples)
    // eslint-disable-next-line no-console
    console.log(
      `[render-bench] cold-open-10k: median=${med.toFixed(2)}ms (10,000 records, panel was closed, samples=${JSON.stringify(samples.map((n) => Math.round(n * 100) / 100))})`,
    )
    result.coldOpen10k = { ms: med, samples }
    result.meta = { ...(result.meta as BenchResult['meta']), coldOpenRecords: TOTAL } as BenchResult['meta']

    // Generous fixed ceiling — a regression tripwire, not a lab-conditions bar.
    expect(med, `cold-open-10k median ${med}ms`).toBeLessThan(8_000)
  })

  test('ingest-paint-latency: 50 reps of ingest-call -> new row appears, panel open, ~100 records', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto('/e2e/fixtures/render-bench.html')

    const BASELINE = 100
    const REPS = 50
    await seedRecords(page, { count: BASELINE, idPrefix: 'base' })
    await openPanelAndWaitFirstRow(page)
    await expect(page.locator('.hakka-header-count')).toHaveText(String(BASELINE), { timeout: 15_000 })

    const samples = await page.evaluate(
      async ({ reps }) => {
        const w = window as unknown as HakkaBenchWindow
        function shadow(): ShadowRoot {
          const sr = (document.querySelector('hakka-inspector') as HTMLElement | null)?.shadowRoot
          if (!sr) throw new Error('hakka-inspector shadow root not found')
          return sr
        }
        function waitForRowMarker(marker: string, timeoutMs: number): Promise<void> {
          return new Promise((resolve, reject) => {
            const deadline = performance.now() + timeoutMs
            function tick(): void {
              const el = shadow().querySelector('.hakka-row-path')
              if (el?.textContent?.includes(marker)) {
                resolve()
                return
              }
              if (performance.now() > deadline) {
                reject(new Error(`timeout waiting for row marker ${marker}`))
                return
              }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
        }

        const out: number[] = []
        for (let i = 0; i < reps; i++) {
          const marker = `/ipl/${i}`
          const t0 = performance.now()
          w.Hakka.ingest({
            id: `ipl-${i}`,
            url: `https://api.example.com${marker}`,
            method: 'GET',
            status: 200,
            startTime: Date.now(), // always the newest record in the store — sorts to the top row
            duration: 25,
            source: 'fetch',
            responseHeaders: { 'content-type': 'application/json' },
            contentType: 'application/json',
          })
          // eslint-disable-next-line no-await-in-loop
          await waitForRowMarker(marker, 5_000)
          out.push(performance.now() - t0)
        }
        return out
      },
      { reps: REPS },
    )

    const med = median(samples)
    const p95Val = p95(samples)
    // eslint-disable-next-line no-console
    console.log(
      `[render-bench] ingest-paint-latency: median=${med.toFixed(2)}ms p95=${p95Val.toFixed(2)}ms (${REPS} reps, samples=${JSON.stringify(samples.map((n) => Math.round(n * 100) / 100))})`,
    )
    result.ingestPaintLatency = { samples, medianMs: med, p95Ms: p95Val }
    result.meta = {
      ...(result.meta as BenchResult['meta']),
      ingestPaintReps: REPS,
      ingestPaintBaselineRecords: BASELINE,
    } as BenchResult['meta']

    expect(med, `ingest-paint-latency median ${med}ms`).toBeLessThan(500)
    expect(p95Val, `ingest-paint-latency p95 ${p95Val}ms`).toBeLessThan(1_500)
  })

  test('update-propagation: 30 reps of update-call -> status text changes, panel open, 10k records', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto('/e2e/fixtures/render-bench.html')

    const TOTAL = 10_000
    const REPS = 30
    await seedRecords(page, { count: TOTAL, idPrefix: 'upd' })
    await openPanelAndWaitFirstRow(page)
    await expect(page.locator('.hakka-header-count')).toHaveText(String(TOTAL), { timeout: 30_000 })

    // The last-ingested record sorts to the top row and stays there across every
    // status-only update below (RingBuffer.update() patches in place, doesn't reorder)
    // as long as startTime is unchanged — read the real seeded value back instead of
    // recomputing it.
    const targetId = `upd-${TOTAL - 1}`
    const targetUrl = `https://api.example.com/resource/${TOTAL - 1}`
    const targetStartTime = await page.evaluate(async (id) => {
      const w = window as unknown as HakkaBenchWindow
      const logs = await w.Hakka.getLogs()
      const rec = logs.find((r) => r.id === id)
      if (!rec) throw new Error(`seeded target record ${id} not found in store`)
      return rec.startTime
    }, targetId)

    const samples = await page.evaluate(
      async ({ reps, id, url, startTime }) => {
        const w = window as unknown as HakkaBenchWindow
        function shadow(): ShadowRoot {
          const sr = (document.querySelector('hakka-inspector') as HTMLElement | null)?.shadowRoot
          if (!sr) throw new Error('hakka-inspector shadow root not found')
          return sr
        }
        function waitForTopStatus(expected: string, timeoutMs: number): Promise<void> {
          return new Promise((resolve, reject) => {
            const deadline = performance.now() + timeoutMs
            function tick(): void {
              const el = shadow().querySelector('.hakka-row .hakka-status')
              if (el?.textContent === expected) {
                resolve()
                return
              }
              if (performance.now() > deadline) {
                reject(new Error(`timeout waiting for top row status ${expected}`))
                return
              }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
        }

        const out: number[] = []
        for (let i = 0; i < reps; i++) {
          const status = i % 2 === 0 ? 500 : 200
          const t0 = performance.now()
          // Re-ingesting the same id exercises hakka-core's real merge/upsert path via
          // the public ingest() API — window.Hakka doesn't expose the internal update().
          w.Hakka.ingest({
            id,
            url,
            method: 'GET',
            status,
            startTime, // unchanged every rep — keeps this row sorted at the top
            duration: 25,
            source: 'fetch',
            responseHeaders: { 'content-type': 'application/json' },
            contentType: 'application/json',
          })
          // eslint-disable-next-line no-await-in-loop
          await waitForTopStatus(String(status), 5_000)
          out.push(performance.now() - t0)
        }
        return out
      },
      { reps: REPS, id: targetId, url: targetUrl, startTime: targetStartTime },
    )

    const med = median(samples)
    const p95Val = p95(samples)
    // eslint-disable-next-line no-console
    console.log(
      `[render-bench] update-propagation: median=${med.toFixed(2)}ms p95=${p95Val.toFixed(2)}ms (${REPS} reps, samples=${JSON.stringify(samples.map((n) => Math.round(n * 100) / 100))})`,
    )
    result.updatePropagation = { samples, medianMs: med, p95Ms: p95Val }
    result.meta = {
      ...(result.meta as BenchResult['meta']),
      updatePropagationReps: REPS,
      updatePropagationRecords: TOTAL,
    } as BenchResult['meta']

    expect(med, `update-propagation median ${med}ms`).toBeLessThan(500)
    expect(p95Val, `update-propagation p95 ${p95Val}ms`).toBeLessThan(1_500)
  })

  test('filter-latency: 10 reps of input -> list settled to ~10 rows, 10k records', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/e2e/fixtures/render-bench.html')

    const TOTAL = 10_000
    const REPS = 10
    const MARKER_TEXT = 'rbmarker'
    const MARKER_COUNT = 10 // i % 1000 === 733 over 10,000 records — fixed, not runtime-computed
    await seedRecords(page, { count: TOTAL, idPrefix: 'flt', markerMod: 1_000, markerText: MARKER_TEXT })
    await openPanelAndWaitFirstRow(page)
    await expect(page.locator('.hakka-header-count')).toHaveText(String(TOTAL), { timeout: 30_000 })

    const samples = await page.evaluate(
      async ({ reps, marker, markerCount, total }) => {
        function shadow(): ShadowRoot {
          const sr = (document.querySelector('hakka-inspector') as HTMLElement | null)?.shadowRoot
          if (!sr) throw new Error('hakka-inspector shadow root not found')
          return sr
        }
        function setSearch(value: string): void {
          const input = shadow().querySelector('.hakka-search') as HTMLInputElement | null
          if (!input) throw new Error('.hakka-search not found')
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
          setter.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        function bannerText(): string | null {
          return shadow().querySelector('.hakka-filter-sub')?.textContent ?? null
        }
        // Settled = the "Showing N of M" banner reads the expected narrowed count and
        // holds for two consecutive animation frames (guards against a mid-recompute flicker).
        function waitForSettled(expectedPrefix: string, timeoutMs: number): Promise<void> {
          return new Promise((resolve, reject) => {
            const deadline = performance.now() + timeoutMs
            let stableFrames = 0
            function tick(): void {
              const text = bannerText()
              if (text?.startsWith(expectedPrefix)) {
                stableFrames++
                if (stableFrames >= 2) {
                  resolve()
                  return
                }
              } else {
                stableFrames = 0
              }
              if (performance.now() > deadline) {
                reject(new Error(`timeout waiting for banner to settle at "${expectedPrefix}"`))
                return
              }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
        }
        function waitForCleared(timeoutMs: number): Promise<void> {
          return new Promise((resolve, reject) => {
            const deadline = performance.now() + timeoutMs
            let stableFrames = 0
            function tick(): void {
              if (bannerText() === null) {
                stableFrames++
                if (stableFrames >= 2) {
                  resolve()
                  return
                }
              } else {
                stableFrames = 0
              }
              if (performance.now() > deadline) {
                reject(new Error('timeout waiting for filter to clear'))
                return
              }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
        }

        const out: number[] = []
        const expectedPrefix = `Showing ${markerCount} of ${total}`
        for (let i = 0; i < reps; i++) {
          // Untimed: reset to the unfiltered 10k list before each timed rep.
          setSearch('')
          // eslint-disable-next-line no-await-in-loop
          await waitForCleared(5_000)

          const t0 = performance.now()
          setSearch(marker)
          // eslint-disable-next-line no-await-in-loop
          await waitForSettled(expectedPrefix, 5_000)
          out.push(performance.now() - t0)
        }
        return out
      },
      { reps: REPS, marker: MARKER_TEXT, markerCount: MARKER_COUNT, total: TOTAL },
    )

    const med = median(samples)
    const p95Val = p95(samples)
    // eslint-disable-next-line no-console
    console.log(
      `[render-bench] filter-latency: median=${med.toFixed(2)}ms p95=${p95Val.toFixed(2)}ms (${REPS} reps, includes the intentional 120ms UI debounce above 60 records — see RequestListViewModel's FILTER_DEBOUNCE_ABOVE/MS, samples=${JSON.stringify(samples.map((n) => Math.round(n * 100) / 100))})`,
    )
    result.filterLatency = { samples, medianMs: med, p95Ms: p95Val }
    result.meta = {
      ...(result.meta as BenchResult['meta']),
      filterLatencyReps: REPS,
      filterLatencyRecords: TOTAL,
    } as BenchResult['meta']

    // Generous — this scenario legitimately includes the fixed 120ms debounce plus a
    // full 10k-record filter/sort recompute, so its floor is naturally higher than the
    // other three metrics.
    expect(med, `filter-latency median ${med}ms`).toBeLessThan(2_000)
    expect(p95Val, `filter-latency p95 ${p95Val}ms`).toBeLessThan(4_000)
  })

  test.afterAll(() => {
    if (!result.coldOpen10k || !result.ingestPaintLatency || !result.updatePropagation || !result.filterLatency) {
      // A prior test failed/skipped — don't write a partial/misleading results file.
      return
    }
    const full: BenchResult = {
      coldOpen10k: result.coldOpen10k,
      ingestPaintLatency: result.ingestPaintLatency,
      updatePropagation: result.updatePropagation,
      filterLatency: result.filterLatency,
      meta: { ...(result.meta as BenchResult['meta']), measuredAt: new Date().toISOString() },
    }
    // eslint-disable-next-line no-console
    console.log(`RENDER_BENCH_RESULT ${JSON.stringify(full)}`)

    const here = dirname(fileURLToPath(import.meta.url))
    const outPath = join(here, 'render-bench-results.json')
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(full, null, 2)}\n`)
  })
})
