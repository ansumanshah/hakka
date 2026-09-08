import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/browser-demo/index.html')
  await expect(page.locator('.hakka-panel.open')).toBeVisible({ timeout: 15_000 })
})

test('Page finds a page element and Run awaits an explicit command on a phone viewport', async ({ page }) => {
  await page.getByRole('tab', { name: 'Page' }).click()
  const selector = page.getByLabel('Find by CSS')
  await selector.fill('#btn-fetch')
  await selector.press('Enter')
  await expect(page.getByText('#btn-fetch').first()).toBeVisible()

  await page.getByRole('tab', { name: 'Logs' }).click()
  await page.getByRole('tab', { name: 'Run' }).click()
  const command = page.getByLabel('Run JavaScript in this page')
  await command.fill('await Promise.resolve("phone result")')
  await page.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByText('phone result', { exact: true })).toBeVisible()
  await command.fill('document.title')
  await command.press('ArrowUp')
  await expect(command).toHaveValue('await Promise.resolve("phone result")')
  await command.press('ArrowDown')
  await expect(command).toHaveValue('document.title')
})

test('Page diagnostics retain a two-column detail view at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('tab', { name: 'Page' }).click()
  await expect(page.locator('.hakka-page-content')).toBeVisible()
  const columns = await page
    .locator('.hakka-page-content')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns)
  expect(columns.split(' ').length).toBe(2)
})
