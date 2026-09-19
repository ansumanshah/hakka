import { expect, test } from '@playwright/test'

test('the standalone docs preview does not inherit or erase inspector filters', async ({ page }) => {
  await page.goto('/docs/public/embed/index.html')
  await page.locator('.hakka-search').fill('login')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hakka:ui'))).toContain('login')
  const savedPreferences = await page.evaluate(() => localStorage.getItem('hakka:ui'))

  await page.goto('/docs/public/embed-components/index.html')
  const rows = page.locator('hakka-request-list .hakka-row')
  await expect(rows).toHaveCount(14)
  await rows.first().click()
  await expect(rows.first()).toHaveClass(/selected/)
  expect(await page.evaluate(() => localStorage.getItem('hakka:ui'))).toBe(savedPreferences)
})

for (const [route, section] of [
  ['mock', 'Mock'],
  ['breaks', 'Breakpoints'],
] as const) {
  test(`the ${section} docs embed opens its Rules section`, async ({ page }) => {
    await page.goto(`/docs/public/embed/index.html?tab=${route}`)
    await expect(page.getByRole('tab', { name: 'Rules', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: section, exact: true })).toHaveAttribute('aria-selected', 'true')
  })
}
