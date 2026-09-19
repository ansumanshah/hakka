import { expect, test } from '@playwright/test'

/**
 * Functional overlay-mount check for the plain `<script>`-tag path (no bundler, no
 * framework plugin) — the same shape of check that caught this session's Vite plugin
 * bug: the injected `<script>` tag showed up in the served HTML while the overlay
 * never actually started for any consumer. A test that only greps the returned HTML
 * for the tag would pass that bug right through. This one drives a real browser,
 * confirms `<hakka-inspector>` is a live, upgraded custom element (an actual open
 * shadow root with rendered content, not just unresolved markup), and confirms
 * mounting it produced zero console errors/warnings and no uncaught page errors.
 */
test('the built overlay mounts <hakka-inspector> with a clean console on the plain-web demo', async ({ page }) => {
  const consoleIssues: string[] = []
  const pageErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleIssues.push(`[${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto('/examples/browser-demo/index.html')
  // The demo calls Hakka.start({ overlay: true }), so the panel opens with no click needed.
  await expect(page.locator('.hakka-panel.open')).toBeVisible({ timeout: 15_000 })

  const mounted = await page.evaluate(() => {
    const el = document.querySelector('hakka-inspector')
    return {
      present: !!el,
      hasShadowRoot: !!el?.shadowRoot,
      hasRenderedPanel: !!el?.shadowRoot?.querySelector('.hakka-panel'),
    }
  })
  expect(mounted.present, '<hakka-inspector> is not in the DOM').toBe(true)
  expect(mounted.hasShadowRoot, '<hakka-inspector> is in the DOM but never upgraded (no shadow root)').toBe(true)
  expect(mounted.hasRenderedPanel, '<hakka-inspector> has a shadow root but no rendered panel inside it').toBe(true)

  expect(consoleIssues, `console error/warning while mounting the overlay: ${JSON.stringify(consoleIssues)}`).toEqual(
    [],
  )
  expect(pageErrors, `uncaught page error while mounting the overlay: ${JSON.stringify(pageErrors)}`).toEqual([])
})

test('show() reopens an already-mounted inspector', async ({ page }) => {
  await page.goto('/examples/browser-demo/index.html')
  const panel = page.locator('.hakka-panel')
  await expect(panel).toHaveClass(/open/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Close inspector' }).click()
  await expect(panel).not.toHaveClass(/open/)

  await page.evaluate(() => (window as Window & { Hakka: { show(): Promise<void> } }).Hakka.show())
  await expect(panel).toHaveClass(/open/)
})

test('a paused request reopens directly to Resume and Abort controls', async ({ page }) => {
  await page.goto('/examples/browser-demo/index.html')
  await expect(page.locator('.hakka-panel.open')).toBeVisible()
  for (const action of ['Resume', 'Abort']) {
    await page.getByRole('button', { name: 'Close inspector' }).click()
    await page.getByRole('button', { name: "fetch('/breakpoint-demo') (pauses)", exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Rules', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Breakpoints', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: `${action} paused request`, exact: true }).click()
    await expect(page.getByRole('button', { name: 'Resume paused request', exact: true })).toHaveCount(0)
  }
})
