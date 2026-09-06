import { expect, test } from '@playwright/test'

/**
 * Traffic cards must communicate both sides of an action: a pending request
 * cannot be clicked again, then a completed request leaves a readable result.
 * The slow route gives the pending state enough time to assert without mocks.
 */
test('secondary traffic can be expanded while the core workflow stays accessible', async ({ page }) => {
  await page.goto('/')

  const coreButton = page.getByTestId('fetch-products')
  const secondaryTraffic = page.getByTestId('secondary-traffic')
  const secondarySummary = secondaryTraffic.locator('summary')
  await expect(coreButton).toBeVisible()
  await expect(secondaryTraffic).not.toHaveAttribute('open', '')

  await secondarySummary.click()
  await expect(secondaryTraffic).toHaveAttribute('open', '')

  const button = page.getByTestId('slow-request')
  await button.click()
  await expect(button).toBeDisabled()
  await expect(button).toHaveText('Waiting…')

  const status = page.getByRole('status')
  await expect(status).toHaveText(/Finished\s+·\s+200\s+·\s+\d+ms/)
  await expect(button).toBeEnabled()
  await expect(button).toHaveText('Run slow request')

  await secondarySummary.click()
  await expect(secondaryTraffic).not.toHaveAttribute('open', '')
  await expect(coreButton).toBeVisible()
})
