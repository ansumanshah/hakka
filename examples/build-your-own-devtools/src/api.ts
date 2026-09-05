/**
 * Traffic generators for the demo API in `server/demoApi.ts`. Nothing here
 * mentions Hakka — that's deliberate. `Hakka.start()` (called once in
 * `panel.ts` / `react-main.tsx`) patches `fetch`/`XMLHttpRequest` globally
 * before any of these run, so every call below is captured into the shared
 * store the six elements read from, with zero per-call wiring.
 *
 * Each function resolves to a short, human-readable summary of what
 * happened — used for the on-page "last action" log, not by Hakka.
 */

async function describe(label: string, res: Response): Promise<string> {
  const body = await res.text()
  const size = new TextEncoder().encode(body).length
  return `${label} → ${res.status} (${size}B)`
}

export async function fetchUsers(): Promise<string> {
  const res = await fetch('/api/users')
  return describe('GET /api/users', res)
}

export async function fetchOneUser(): Promise<string> {
  // Bounce between a real user and a deliberate miss so /api/users/:id shows
  // both a 200 and a 404 in the captured log.
  const id = Math.random() < 0.7 ? 1 + Math.floor(Math.random() * 4) : 99
  const res = await fetch(`/api/users/${id}`)
  return describe(`GET /api/users/${id}`, res)
}

export async function createOrder(): Promise<string> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'HAKKA-STICKER', qty: 1 + Math.floor(Math.random() * 3) }),
  })
  return describe('POST /api/orders', res)
}

export async function fetchSummary(): Promise<string> {
  const res = await fetch('/api/reports/summary')
  return describe('GET /api/reports/summary', res)
}

export async function chargePayment(): Promise<string> {
  // Always fails (see demoApi.ts) — a reliable error row for the status
  // filter and the stats panel's error rate, not a flaky one.
  const res = await fetch('/api/payments/charge')
  return describe('GET /api/payments/charge', res)
}

/** XMLHttpRequest, not fetch — lands with `source: 'xhr'` instead of `'fetch'`. */
export function pingLegacy(): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', '/api/legacy/ping')
    xhr.addEventListener('loadend', () => resolve(`GET /api/legacy/ping (XHR) → ${xhr.status}`))
    xhr.addEventListener('error', () => reject(new Error('XHR network error')))
    xhr.send()
  })
}

/**
 * Fires several of the calls above concurrently — the interesting case for
 * `<hakka-waterfall>`, which lays overlapping requests out on one shared
 * timeline. A single button click here produces a burst worth looking at
 * instead of one bar at a time.
 */
export async function loadDashboardBurst(): Promise<string> {
  const results = await Promise.allSettled([fetchUsers(), fetchOneUser(), createOrder(), fetchSummary()])
  const ok = results.filter((r) => r.status === 'fulfilled').length
  return `Dashboard burst: ${ok}/${results.length} calls settled`
}
