import { expect, type Page } from '@playwright/test'

/**
 * Shared helpers for driving the real `<hakka-inspector>` overlay this example mounts via
 * `hakka-node/next/client` (see `app/hakka-overlay.tsx` / `instrumentation-client.ts`). Every
 * helper here drives the ACTUAL rendered UI — clicks, keyboard events, locators piercing the
 * overlay's open shadow root (Playwright does this natively for CSS/text/role locators) — never
 * an internal store or view-model directly. If a helper only inspected an artifact instead of
 * driving the real control, a broken control would still pass.
 */

/**
 * Opens the inspector for the FIRST time on a fresh page load. `hakka-browser`'s boot sequence
 * (`src/index.ts`'s `mountLauncher()`) renders a tiny framework-free bootstrap `<button>` — no
 * shadow root yet — before the Solid UI chunk has even loaded. Clicking it lazy-loads that chunk
 * and mounts `<hakka-inspector>` with the panel already open (`show()` persists `open: true`
 * before mounting). This button only exists once per page load; after the panel is closed once,
 * `hakka-browser` tears it down for good (`launcherEl?.remove()`) and the floating toggle
 * (`.hakka-toggle`, rendered by the now-mounted Solid UI) takes over — use `reopenInspector` then.
 */
export async function openInspector(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open Hakka inspector' }).click()
  await expect(page.locator('.hakka-panel.open')).toBeVisible({ timeout: 15_000 })
}

/** Closes the panel via the toolbar's close control (`InspectorToolbar.tsx`). */
export async function closeInspector(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close inspector' }).click()
  await expect(page.locator('.hakka-panel.open')).toHaveCount(0)
}

/**
 * Re-opens the inspector after it has been closed once (see `openInspector`'s doc comment —
 * the bootstrap launcher is gone by then). `InspectorToggleButton.tsx`'s floating `.hakka-toggle`
 * button only opens the compact HUD on a plain tap; the full panel needs a long-press,
 * right-click, or Shift+Enter (`onToggleKeyDown`). Shift+Enter is the most deterministic of the
 * three under Playwright (no pointer-timing race with the 450ms long-press timer).
 */
export async function reopenInspector(page: Page): Promise<void> {
  const toggle = page.locator('.hakka-toggle')
  await toggle.focus()
  await toggle.press('Shift+Enter')
  await expect(page.locator('.hakka-panel.open')).toBeVisible({ timeout: 15_000 })
}

/**
 * Clears the captured request list via the toolbar's real "Clear" control (`InspectorToolbar.tsx`).
 *
 * Every test in this suite needs this, and the reason is specific to how this example works: the
 * overlay does not hold the only copy of the traffic. `hakka-node`'s embedded bridge hub buffers
 * captures server-side and replays them to each overlay that connects, so a fresh Playwright
 * browser context does NOT give a fresh request list — rows from earlier tests in the same run
 * arrive over the bridge the moment this test's overlay mounts. Without clearing, locators that
 * matched one row when written match several later in the run, and Playwright fails them on strict
 * mode rather than on anything the product did wrong.
 *
 * "Clear" is rendered twice (inline in the wide header, and again inside the `⋮` kebab menu for
 * narrow widths) and exactly one of the two is visible at any width, so this filters on visibility
 * instead of picking `.first()`, which would pick the hidden one at narrow viewports.
 */
export async function clearRequests(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Clear', exact: true }).filter({ visible: true }).click()
  await expect(requestList(page).locator('.hakka-row')).toHaveCount(0)
}

/**
 * The request list itself (`.hakka-list`). Every row locator below is scoped through this, and
 * that scoping is load-bearing, not tidiness: `.hakka-row` is also rendered by the DETAIL pane
 * (under `.hakka-detail-rowback`, as the correlated back-reference to the request being viewed).
 * An unscoped `.hakka-row` therefore matches list rows AND detail-pane rows, which produces two
 * failures that both look like product bugs and are not:
 *   - a path present in both places resolves to 2 elements and fails Playwright's strict mode;
 *   - a runtime filter appears "leaky", because the detail pane still shows the correlated server
 *     hop while the list beside it is correctly filtered down to client rows only.
 * Both were observed here before this scoping existed.
 */
export function requestList(page: Page) {
  return page.locator('.hakka-list')
}

/** One row in the request list, keyed by the path text `.hakka-row-path` shows. */
export function rowByPath(page: Page, path: string) {
  return requestList(page).locator('.hakka-row', { has: page.locator('.hakka-row-path', { hasText: path }) })
}

/** One row in the request list, keyed by the host text `.hakka-row-host` shows. */
export function rowByHost(page: Page, host: string) {
  return requestList(page).locator('.hakka-row', { has: page.locator('.hakka-row-host', { hasText: host }) })
}

/**
 * Opens the "Filters" disclosure in the Network tab's filter bar (`FilterBar.tsx`) and clicks one
 * of the Runtime chips ("Client" / "Server" / "Edge") — the same control a developer uses to
 * isolate traffic by runtime. A no-op if the disclosure is already open.
 */
export async function setRuntimeFilter(page: Page, runtime: 'Client' | 'Server' | 'Edge'): Promise<void> {
  const filtersBtn = page.getByRole('button', { name: 'Filters', exact: true })
  const expanded = await filtersBtn.getAttribute('aria-expanded')
  if (expanded !== 'true') await filtersBtn.click()
  await page.getByRole('button', { name: runtime, exact: true }).click()
}

/**
 * Registers console/page-error listeners and returns the accumulators. Call
 * `expectCleanConsole()` at the end of a test to assert nothing was captured — a broken overlay
 * (or a broken interaction with it) should show up here even when every other assertion in the
 * test happens to pass.
 */
export function trackConsoleIssues(page: Page): { consoleIssues: string[]; pageErrors: string[] } {
  const consoleIssues: string[] = []
  const pageErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleIssues.push(`[${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => pageErrors.push(err.message))
  return { consoleIssues, pageErrors }
}

export function expectCleanConsole(tracked: { consoleIssues: string[]; pageErrors: string[] }): void {
  expect(tracked.consoleIssues, `console error/warning: ${JSON.stringify(tracked.consoleIssues)}`).toEqual([])
  expect(tracked.pageErrors, `uncaught page error: ${JSON.stringify(tracked.pageErrors)}`).toEqual([])
}
