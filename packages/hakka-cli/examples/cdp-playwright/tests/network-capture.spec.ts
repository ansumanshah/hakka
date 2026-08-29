/**
 * Drives a real page with Playwright, captures its network traffic through
 * `hakka-cli/cdp`, and asserts on the captured records — the "assert on your
 * app's real network traffic in an E2E test" use case the CDP docs describe
 * (docs/src/content/docs/cdp/overview.md).
 *
 * No adapter layer: `createCdpCapture` takes Playwright's own `CDPSession`
 * directly. It satisfies `CdpTransport` (hakka-cli/src/cdp/types.ts) —
 * `send(method, params)` / `on(event, cb)` / `off(event, cb)` — because
 * that's the same shape CDP itself defines, not something Hakka invented.
 */
import { test, expect } from '@playwright/test'
import { createCdpCapture } from 'hakka-cli/cdp'
import type { CdpTransport, NetworkRequest } from 'hakka-cli/cdp'

import { startDemoServer } from '../fixtures/demo-server'

test('captures the page network traffic and asserts on it', async ({ page }) => {
  const server = await startDemoServer()

  try {
    const session = await page.context().newCDPSession(page)

    // Each request emits through `onRequest` up to three times as it moves
    // through pending → status-known → final (see the docs' "Emission
    // model") — always the same `id`, so a consumer dedupes by id rather
    // than treating every call as a new record. A `Map` does that for free.
    const records = new Map<string, NetworkRequest>()
    const capture = createCdpCapture({
      // Playwright's CDPSession vs. the structural CdpTransport interface —
      // see this example's README for why the cast is here.
      transport: session as unknown as CdpTransport,
      onRequest: (req) => records.set(req.id, req),
    })

    const byPath = (path: string): NetworkRequest | undefined =>
      [...records.values()].find((r) => new URL(r.url).pathname === path)

    await capture.start()
    await page.goto(server.url)
    await page.waitForFunction(() => document.getElementById('status')?.textContent === 'done')

    // The page's own `fetch()` promises settle once response headers
    // arrive; `Network.loadingFinished` — the event that carries `duration`
    // and the response body — is a separate, slightly later message on the
    // CDP wire. Poll until the three API calls have all reached that final
    // state before reading `records`, rather than stopping the instant the
    // page says it's done.
    const apiPaths = ['/api/users', '/api/orders', '/api/missing']
    await expect
      .poll(() => apiPaths.filter((path) => typeof byPath(path)?.duration === 'number').length)
      .toBe(apiPaths.length)

    await capture.stop()

    const users = byPath('/api/users')
    expect(users?.status).toBe(200)
    expect(users?.method).toBe('GET')
    // Response bodies are captured by default (captureBody: true).
    expect(users?.responseBody).toContain('Ada Lovelace')

    const orders = byPath('/api/orders')
    expect(orders?.status).toBe(200)

    // The 404 is captured too — hakka-cli/cdp doesn't filter by status, so a
    // test can assert an app's error paths the same way it asserts the
    // happy path.
    const missing = byPath('/api/missing')
    expect(missing?.status).toBe(404)

    // CDP's Network domain covers the whole page, not just fetch/XHR — the
    // 4th record is the HTML document itself (`GET /`), captured the same
    // way the three API calls were.
    expect(records.size).toBe(4)
  } finally {
    await server.close()
  }
})
