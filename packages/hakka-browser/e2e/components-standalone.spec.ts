import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

/**
 * P5 B4 standalone-components pass. Proves `hakka-browser/elements`' six
 * custom elements work with no `<hakka-inspector>` overlay or panel shell —
 * the "drop in one piece" story `/guides/build-your-own-devtools/` documents.
 * `hakka-browser/elements` ships no fetch/XHR interceptors of its own, so
 * unlike the other P2 specs' `window.Hakka.ingest()`, this one injects a
 * custom `store` property (the package's documented escape hatch) and
 * streams into that — see fixtures/components-standalone.html for the
 * adapter. Full methodology and the standalone-elements interop notes are in
 * docs/src/content/docs/web/overview.mdx.
 *
 * `dist/elements` isn't guaranteed built by every `just test-e2e` invocation
 * path, so `beforeAll` rebuilds it explicitly and copies the output into
 * `fixtures/components-dist/` so the suite is self-sufficient on a fresh
 * checkout regardless of invocation path.
 */

const here = dirname(fileURLToPath(import.meta.url))
const webPkgDir = join(here, '..')
const distDir = join(webPkgDir, 'dist', 'elements')
const fixtureDistDir = join(here, 'fixtures', 'components-dist')

test.beforeAll(() => {
  test.setTimeout(120_000)
  execFileSync('bun', ['run', 'build'], { cwd: webPkgDir, stdio: 'inherit' })

  rmSync(fixtureDistDir, { recursive: true, force: true })
  mkdirSync(fixtureDistDir, { recursive: true })
  for (const name of readdirSync(distDir)) {
    if (!name.endsWith('.js') || name.endsWith('.map')) continue
    const raw = readFileSync(join(distDir, name), 'utf8')
    // Strip the sourceMappingURL comment — .map files aren't copied, so an
    // uncommented reference is just a harmless 404 in devtools; matches the
    // `just sync-embed` convention for docs/public/embed/hakka-browser.global.js.
    const stripped = raw.replace(/\/\/# sourceMappingURL=\S*$/m, '')
    writeFileSync(join(fixtureDistDir, name), stripped)
  }
  if (!existsSync(join(fixtureDistDir, 'index.js'))) {
    throw new Error(`components-dist copy failed — no index.js in ${fixtureDistDir}`)
  }
})

const TOTAL = 100
const ERROR_EVERY = 10 // ids synth-0, synth-10, ... synth-90 => 10 rows with status 500

test.describe('standalone components (no overlay)', () => {
  // Serial: fullyParallel would run this file's two tests in separate worker
  // processes, and `beforeAll` above races on the shared filesystem state
  // (rmSync + rebuild of fixtures/components-dist/) between them — each worker
  // stomping the other's in-flight rebuild, intermittent ENOTEMPTY/404s.
  test.describe.configure({ mode: 'serial' })

  test('<hakka-request-list> renders, filters via <hakka-filter-bar>, and fires hakka:select', async ({ page }) => {
    await page.goto('/e2e/fixtures/components-standalone.html')
    await page.waitForFunction(() => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true)

    const errorIds = await page.evaluate(
      ({ total, errorEvery }) => {
        const w = window as unknown as { __store: { ingest: (r: Record<string, unknown>) => void } }
        const now = Date.now()
        const ids: string[] = []
        for (let i = 0; i < total; i++) {
          const isError = i % errorEvery === 0
          if (isError) ids.push(`synth-${i}`)
          w.__store.ingest({
            id: `synth-${i}`,
            // Distinct path segment for the error subset, filtered on below via
            // `url:` — one of the tokenizer's only four real scope prefixes
            // (parser.ts SCOPE_PREFIXES). `status:`/`method:`/`host:` are only
            // autocomplete hints; typed literally they'd fall through to an
            // unscoped substring token and never match here.
            url: isError ? `https://api.example.com/zzerr/${i}` : `https://api.example.com/resource/${i}`,
            method: i % 4 === 0 ? 'POST' : 'GET',
            status: isError ? 500 : 200,
            startTime: now - (total - i) * 10,
            duration: 20 + (i % 200),
            source: 'fetch',
            responseHeaders: { 'content-type': 'application/json' },
            contentType: 'application/json',
          })
        }
        return ids
      },
      { total: TOTAL, errorEvery: ERROR_EVERY },
    )
    expect(errorIds, 'fixture bug: expected 10 status-500 rows out of 100').toHaveLength(10)

    const rows = page.locator('#list .hakka-row')
    await expect(rows.first()).toBeVisible({ timeout: 10_000 })
    const totalRowsRendered = await rows.count()
    expect(totalRowsRendered, 'no rows rendered for 100 ingested requests').toBeGreaterThan(0)

    // Wired through the shared FilterViewModel singleton (no store prop needed on
    // the filter bar itself); `url:` is a real scope prefix so this never touches
    // the matchIds() path the fixture's store adapter stubs out.
    const search = page.locator('#bar .hakka-search')
    await search.fill('url:zzerr')

    // 100 ingested requests > RequestListViewModel's FILTER_DEBOUNCE_ABOVE
    // (60) - filter text changes debounce ~120ms before the list recomputes;
    // toHaveCount polls until that settles rather than a manual sleep.
    await expect(rows).toHaveCount(10, { timeout: 5_000 })
    await expect(rows.first()).toContainText('500')

    await rows.first().click()
    const lastSelect = await page.evaluate(
      () => (window as unknown as { __lastSelect: { id: string } | null }).__lastSelect,
    )
    expect(lastSelect, 'hakka:select never fired on a real (non-programmatic) click').not.toBeNull()
    expect(errorIds).toContain(lastSelect!.id)
  })

  test('"strip" layout: sticky <hakka-filter-bar> over <hakka-request-list> stays opaque and the list stays clipped', async ({
    page,
  }) => {
    // P5 B2 audit Finding 1 (CRITICAL): a consumer docking <hakka-filter-bar>
    // `position: sticky` above a scrolling <hakka-request-list> (the
    // `#strip-wrap` fixture markup) showed the sticky bar with no opaque
    // background, so scrolled-past rows bled through it illegibly. Root cause
    // (see elements/shared.ts's `sharedStylesSheet()` doc comment):
    // `@solidjs/element`'s `withSolid()` used to discard `STANDALONE_HOST_STYLES`
    // when it was appended as a separate `<style>` tag, so neither the list's
    // max-height cap nor the filter bar's background rule ever reached the DOM.
    await page.goto('/e2e/fixtures/components-standalone.html')
    await page.waitForFunction(() => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true)

    await page.evaluate(() => {
      const w = window as unknown as { __store: { ingest: (r: Record<string, unknown>) => void } }
      const now = Date.now()
      for (let i = 0; i < 60; i++) {
        w.__store.ingest({
          id: `strip-${i}`,
          url: `https://api.example.com/resource/${i}`,
          method: 'GET',
          status: 200,
          startTime: now - (60 - i) * 10,
          duration: 90 + (i % 20),
          source: 'fetch',
          responseHeaders: { 'content-type': 'application/json' },
          contentType: 'application/json',
        })
      }
    })

    const stripList = page.locator('#strip-list')
    await expect(stripList.locator('.hakka-row').first()).toBeVisible({ timeout: 10_000 })

    // ── The max-height cap actually clips the list (was silently inert) ──────
    const listBox = await stripList.evaluate((el) => {
      const inner = (el as unknown as { shadowRoot: ShadowRoot }).shadowRoot.querySelector('.hakka-list')!
      return { maxHeight: getComputedStyle(inner).maxHeight, height: el.getBoundingClientRect().height }
    })
    expect(listBox.maxHeight, 'standalone <hakka-request-list> max-height cap never took effect').not.toBe('none')
    expect(listBox.height, 'standalone <hakka-request-list> overflowed its capped height').toBeLessThanOrEqual(481)

    // ── The sticky filter bar's own host paints an opaque background ────────
    const stripBar = page.locator('#strip-bar')
    const barBg = await stripBar.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(barBg, 'standalone <hakka-filter-bar> host has no opaque background').not.toBe('rgba(0, 0, 0, 0)')
    expect(barBg, 'standalone <hakka-filter-bar> host has no opaque background').not.toBe('transparent')

    // ── Scrolling the strip never lets list rows paint over the sticky bar ──
    await page.locator('#strip-wrap').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    const barBgAfterScroll = await stripBar.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(barBgAfterScroll).toBe(barBg)
  })
})
