import { expect, test } from '@playwright/test'

import {
  clearRequests,
  closeInspector,
  expectCleanConsole,
  openInspector,
  reopenInspector,
  rowByPath,
  trackConsoleIssues,
} from './helpers'

/**
 * The mock loop, driven the way a developer actually drives it: open Rules > Mock (the default
 * section, `RulesTab.tsx`), add a rule through the real form, then click the same button again
 * and see the APP's own rendered output change — not an inspector-internal flag. If this only
 * asserted that a `MockRule` object existed in `mockEngine`, a broken interceptor (the thing that
 * actually has to intercept `fetch('/api/products')` and never hit the network) could still pass.
 * Asserting on `FetchProductsCard`'s rendered `<li>` text is the strongest form of this: it is
 * the real app UI, driven only by what the browser's own `fetch()` call returned.
 */
test('a mock rule added in the UI changes what "Fetch products" returns on the next click', async ({ page }) => {
  const tracked = trackConsoleIssues(page)
  const mockedProductName = 'Hakka Mocked Widget Co'

  await page.goto('/')
  await openInspector(page)
  // Start from an empty list so the `.last()` row asserted at the end is unambiguously the one
  // this test's own click produced — see `clearRequests` for why a fresh context isn't enough.
  await clearRequests(page)
  await page.getByRole('tab', { name: 'Rules' }).click()

  await page.getByLabel('URL pattern').fill('/api/products')
  await page
    .getByLabel('Response body')
    .fill(JSON.stringify({ products: [{ id: 999, name: mockedProductName, email: 'mock@hakka.dev' }] }))
  await page.getByRole('button', { name: 'Add mock rule' }).click()

  // The rule now shows in "Active rules" (MockTab.tsx) — confirms the Add actually took before
  // we go rely on it changing network behavior.
  await expect(page.getByText('Active rules')).toBeVisible()
  await expect(page.locator('.hakka-card', { hasText: '/api/products' }).first()).toBeVisible()

  await closeInspector(page)

  // The real assertion: click the same button a second time, and the page's own rendered list —
  // not anything inside the inspector — shows the mocked name instead of the real upstream data
  // (jsonplaceholder.typicode.com's actual users, e.g. "Leanne Graham").
  await page.getByTestId('fetch-products').click()
  await expect(page.locator('.demo-list li').first()).toHaveText(mockedProductName)
  await expect(page.locator('.demo-list li')).toHaveCount(1)

  // Secondary, inspector-side confirmation: the new request row is tagged as served by the mock.
  // `reopenInspector`, NOT `openInspector`: `closeInspector` above removed the one-shot bootstrap
  // launcher for good (`hakka-browser` calls `launcherEl?.remove()`), so the button
  // `openInspector` clicks no longer exists by this point and waiting for it can only time out.
  await reopenInspector(page)
  // Back to Network first: the panel reopens on whatever tab it was left on, and this test left it
  // on Rules to add the rule. Without this the request list is not rendered at all, so the row
  // assertion below fails with "element not found" and reads as "the mock tag is missing" when in
  // fact the whole list is simply on another tab.
  await page.getByRole('tab', { name: 'Network' }).click()
  const mockedRow = rowByPath(page, '/api/products').last()
  await expect(mockedRow.locator('.hakka-mocked-tag')).toHaveText('mock')

  expectCleanConsole(tracked)
})
