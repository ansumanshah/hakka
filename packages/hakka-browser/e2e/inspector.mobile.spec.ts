import { readFile } from 'node:fs/promises'

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
  await page.goto('/examples/browser-demo/index.html')
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

test('filtered exports download full bodies and a saved session can be loaded again', async ({ page }) => {
  await page.locator('.hakka-search').fill('/auth/login')
  await expect(page.locator('.hakka-row')).toHaveCount(1)
  await page.getByLabel('More actions', { exact: true }).click()

  async function downloadJson(action: string) {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: action, exact: true }).click()
    const download = await pending
    expect(await download.failure()).toBeNull()
    const path = await download.path()
    expect(path).toBeTruthy()
    return { payload: JSON.parse(await readFile(path!, 'utf8')), path: path! }
  }

  const har = await downloadJson('Export HAR')
  const otel = await downloadJson('Export OTel')
  const postman = await downloadJson('Export Postman')
  const session = await downloadJson('Save session')
  const entries = har.payload.log.entries
  expect(entries).toHaveLength(1)
  expect(entries[0].request.url).toBe('https://api.example.com/auth/login')
  expect(JSON.parse(entries[0].request.postData.text).password).toBe('[REDACTED]')
  expect(JSON.parse(entries[0].response.content.text).expiresIn).toBe(3600)
  expect(otel.payload.spans).toHaveLength(1)
  expect(otel.payload.spans[0].name).toContain('/auth/login')
  const items = postman.payload.item
  expect(items).toHaveLength(1)
  expect(JSON.parse(items[0].request.body.raw).password).toBe('[REDACTED]')
  expect(session.payload.requests).toHaveLength(1)

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.locator('.hakka-row')).toHaveCount(0)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load session', exact: true }).click()
  await (await chooser).setFiles(session.path)
  await expect(page.locator('.hakka-row')).toHaveCount(1)
  await page.getByLabel('More actions', { exact: true }).click()
  await page.getByText('/auth/login').first().click()
  await page.getByRole('button', { name: 'Response', exact: true }).click()
  await expect(page.locator('.hakka-detail')).toContainText('3600')
})

test('command palette and tour accept pointer clicks above the host page', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await palette.getByRole('textbox').fill('Show quick tour')
  await palette.getByRole('option', { name: /Show quick tour/ }).click()
  await expect(palette).toBeHidden()
  const tour = page.getByRole('dialog', { name: 'Inspector tour', exact: true })
  await expect(tour).toContainText('Search your traffic')
  await tour.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(tour).toContainText('Explore other panels')
  await tour.getByRole('button', { name: 'Skip tour' }).click()
  await expect(tour).toBeHidden()
})

test('detail actions stay on one row at phone width', async ({ page }) => {
  await page.getByText('/graphql').first().click()
  await expect(page.locator('.hakka-detail')).toBeVisible()

  const actionRows = await page
    .locator('.hakka-detail-status > *')
    .evaluateAll((actions) => new Set(actions.map((action) => Math.round(action.getBoundingClientRect().top))).size)

  expect(actionRows).toBe(1)
  await expect(page.getByRole('button', { name: 'Agent' })).toBeVisible()
})

test('severity marker stays within every row boundary without shifting columns', async ({ page }) => {
  const result = await page.locator('.hakka-row.is-error').evaluate((row) => {
    const box = row.getBoundingClientRect()
    const marker = getComputedStyle(row, '::before')
    const markerBottoms = Array.from(document.querySelectorAll('.hakka-row'), (item) =>
      Number.parseFloat(getComputedStyle(item, '::before').bottom),
    )
    return {
      markerBottom: Number.parseFloat(marker.bottom),
      markerBottoms,
      markerColor: marker.backgroundColor,
      markerLeft: Number.parseFloat(marker.left),
      rowLeft: box.left,
    }
  })

  expect(result.markerColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(result.markerBottom).toBe(0)
  expect(result.markerBottoms.every((bottom) => bottom === 0)).toBe(true)
  expect(result.markerLeft).toBe(result.rowLeft)
})
