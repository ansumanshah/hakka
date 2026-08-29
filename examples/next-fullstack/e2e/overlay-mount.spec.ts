import { expect, test } from '@playwright/test'

import { expectCleanConsole, openInspector, trackConsoleIssues } from './helpers'

/**
 * The example's two-line integration (`instrumentation.ts` + `instrumentation-client.ts`, see
 * README) has exactly one job: make a real `<hakka-inspector>` show up, upgraded, with content
 * inside it — not just an unresolved custom-element tag or a script reference that never ran.
 * This is the same class of check that caught this session's Vite-plugin bug (injected script
 * present in the served HTML, overlay never actually started): drive a real browser, confirm the
 * element has an open shadow root with rendered content in it, and confirm mounting it produced
 * no console errors/warnings and no uncaught page errors.
 */
test('the overlay mounts a real, upgraded <hakka-inspector> with a clean console', async ({ page }) => {
  const tracked = trackConsoleIssues(page)

  await page.goto('/')
  await openInspector(page)

  const mounted = await page.evaluate(() => {
    const el = document.querySelector('hakka-inspector')
    return {
      present: !!el,
      hasShadowRoot: !!el?.shadowRoot,
      hasRenderedPanel: !!el?.shadowRoot?.querySelector('.hakka-panel.open'),
      tabs: [...(el?.shadowRoot?.querySelectorAll('[role="tab"]') ?? [])].map((t) => t.textContent?.trim()),
    }
  })
  expect(mounted.present, '<hakka-inspector> is not in the DOM').toBe(true)
  expect(mounted.hasShadowRoot, '<hakka-inspector> is in the DOM but never upgraded (no shadow root)').toBe(true)
  expect(mounted.hasRenderedPanel, '<hakka-inspector> has a shadow root but no rendered panel inside it').toBe(true)
  // The 5 fixed tabs this repo's cross-platform parity ledger requires (Rules replaces the
  // iOS-only "Mocks section" naming on web, but the tab itself is the same panel).
  expect(mounted.tabs).toEqual(['Network', 'Stats', 'Rules', 'Logs', 'Storage', 'Settings'])

  expectCleanConsole(tracked)
})

/**
 * The README's first claim: open the page, and something is already happening. `app/page.tsx`'s
 * Server Component fetches `api.github.com` during render, before a user has clicked anything —
 * it should already be sitting in the request list, tagged `server`, the moment the inspector
 * opens. A regression here (the server capture never reaching the embedded bridge hub, or the
 * `runtime` tag never reaching the row) would make this example's headline claim false on the
 * very first page load, with every button-driven test still passing.
 */
test("the page's own server-side fetch is already captured, tagged server, before any click", async ({ page }) => {
  await page.goto('/')
  await openInspector(page)

  const githubRow = page.locator('.hakka-row', {
    has: page.locator('.hakka-row-host', { hasText: 'api.github.com' }),
  })
  await expect(githubRow.first()).toBeVisible()
  await expect(githubRow.first().locator('.hakka-rt-tag')).toHaveText('server')
})
