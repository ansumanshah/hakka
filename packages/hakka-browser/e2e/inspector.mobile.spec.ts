import { expect, test } from '@playwright/test'

/**
 * Mobile-viewport E2E. The demo calls `Hakka.start({ overlay: true })`, ingests 4 sample
 * requests (including a 500 and a GraphQL op), and fires live fetch/XHR/worker traffic. We
 * verify on a Pixel 5 profile that the overlay renders, captures show, search narrows the
 * list, the new duration/size range filter works, and the panel fills the small screen.
 *
 * The UI mounts inside the <hakka-inspector> custom element's (open) shadow root; Playwright
 * pierces open shadow roots for CSS/text locators automatically.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/demo/index.html')
  // The Solid UI lazy-loads after start(); wait for the open panel before each assertion.
  await expect(page.locator('.hakka-panel.open')).toBeVisible({ timeout: 15_000 })
})

test('overlay opens and shows captured requests', async ({ page }) => {
  await expect(page.locator('.hakka-header-count')).not.toHaveText('0')
  await expect(page.getByText('/users/42').first()).toBeVisible()
})

test('search narrows the request list', async ({ page }) => {
  await page.locator('.hakka-search').fill('graphql')
  await expect(page.getByText('/graphql').first()).toBeVisible()
  await expect(page.getByText('/users/42')).toHaveCount(0)
})

test('duration range filter narrows the list', async ({ page }) => {
  // Advanced filters live behind the "Filters" disclosure (mobile-first primary row).
  await page.getByRole('button', { name: /^Filters/ }).click()
  // Open the range row and require duration >= 300ms — only the slow sample requests qualify.
  await page.getByRole('button', { name: 'Toggle range filters' }).click()
  await page.getByLabel('Minimum duration in milliseconds').fill('300')
  // The 145ms /users/42 request drops out; the 320ms login and 512ms search stay.
  await expect(page.getByText('/users/42')).toHaveCount(0)
  await expect(page.getByText('/auth/login').first()).toBeVisible()
})

test('panel fills the mobile viewport width', async ({ page }) => {
  const panel = page.locator('.hakka-panel.open')
  const box = await panel.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  // Phone layout: the panel spans (near) the full viewport width (bottom-sheet / full-screen).
  expect(box!.width).toBeGreaterThan(viewport!.width * 0.9)
})
