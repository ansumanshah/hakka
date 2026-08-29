import { expect, test } from '@playwright/test'

import { expectCleanConsole, openInspector, rowByPath, setRuntimeFilter, trackConsoleIssues } from './helpers'

/**
 * Hakka's headline claim, and the one thing this repo has no e2e coverage of anywhere: a single
 * click in the browser produces a request the browser made AND the server-side request that
 * route handler made in turn, both landing in one inspector, tagged apart. `app/api/products/
 * route.ts` is the reference shape — the browser calls `/api/products`, and that Node-runtime
 * route handler calls `jsonplaceholder.typicode.com` on its own. This test clicks the real
 * "Fetch products" button a user would click, then asserts on the two resulting rows exactly as
 * a developer reading the panel would: one row for the browser's own call (no runtime badge —
 * `client` is the unmarked default, `RequestRow.tsx`), one row for the server's downstream call
 * (a `server` badge). Capture happens whether or not the panel is open, so the click happens
 * first, on the plain page, with nothing covering it.
 */
test('clicking "Fetch products" tags one row client and the other server — the full-stack claim', async ({ page }) => {
  const tracked = trackConsoleIssues(page)

  await page.goto('/')
  await page.getByTestId('fetch-products').click()
  // Real names from the demo's own upstream (jsonplaceholder.typicode.com/users) — confirms the
  // button's own client-side effect landed before we go looking for it in the inspector.
  await expect(page.locator('.demo-list li').first()).toBeVisible()

  await openInspector(page)

  const clientRow = rowByPath(page, '/api/products')
  await expect(clientRow).toBeVisible()
  // No `.hakka-rt-tag` at all on the client row — `RequestRow.tsx` only renders that badge when
  // `runtime !== 'client'`, so its absence here IS the client tag, not a missing assertion.
  await expect(clientRow.locator('.hakka-rt-tag')).toHaveCount(0)

  const serverRow = page.locator('.hakka-row', {
    has: page.locator('.hakka-row-host', { hasText: 'jsonplaceholder.typicode.com' }),
  })
  await expect(serverRow.first()).toBeVisible()
  await expect(serverRow.first().locator('.hakka-rt-tag')).toHaveText('server')

  expectCleanConsole(tracked)
})

/**
 * The runtime filter (`FilterBar.tsx`'s Runtime chip cluster) is how a developer actually
 * separates the two hops the test above just produced. Filtering by "Server" should isolate the
 * downstream jsonplaceholder call and drop the browser's own `/api/products` row; filtering by
 * "Client" should do the exact opposite. Asserting only one direction would leave a
 * filter-always-shows-everything regression undetected.
 */
test('the runtime filter isolates server traffic from client traffic', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('fetch-products').click()
  await expect(page.locator('.demo-list li').first()).toBeVisible()
  await openInspector(page)

  const clientRow = rowByPath(page, '/api/products')
  const serverRow = page.locator('.hakka-row', {
    has: page.locator('.hakka-row-host', { hasText: 'jsonplaceholder.typicode.com' }),
  })
  // Sanity: both rows are there, unfiltered, before touching the runtime filter.
  await expect(clientRow).toBeVisible()
  await expect(serverRow.first()).toBeVisible()

  await setRuntimeFilter(page, 'Server')
  await expect(serverRow.first()).toBeVisible()
  await expect(clientRow).toHaveCount(0)

  await setRuntimeFilter(page, 'Client')
  await expect(clientRow).toBeVisible()
  await expect(serverRow).toHaveCount(0)
})
