/**
 * Demo traffic for the empty-state "Load sample traffic" action (Inspector.tsx
 * / RequestList.tsx). Seeded via the normal `ingest()` path, so demo rows
 * sort/filter/export/clear exactly like real captures — no special-casing.
 * Each row carries `library: 'demo'` and an id prefixed `demo-`.
 */
import type { NetworkRequest } from 'hakka-core'

const DEMO_LIBRARY = 'demo'

function demoId(suffix: string): string {
  return `demo-${suffix}`
}

/** Build ~11 realistic demo NetworkRequests: mixed methods/status, one slow request, one JSON body, plus a trace-linked client→server→upstream hop chain. */
export function buildSampleRequests(): NetworkRequest[] {
  const now = Date.now()
  // Spread start times over the last couple minutes — reads as a session, not a burst.
  let t = now - 90_000

  const next = (stepMs: number): number => {
    t += stepMs
    return t
  }

  const requests: NetworkRequest[] = [
    {
      id: demoId('1'),
      url: 'https://api.example.com/v1/users/me',
      method: 'GET',
      status: 200,
      startTime: next(1200),
      endTime: t + 84,
      duration: 84,
      requestHeaders: { accept: 'application/json', authorization: 'Bearer demo-token' },
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ id: 'u_1', name: 'Ada Lovelace', plan: 'pro' }, null, 2),
      responseBodySize: 58,
      contentType: 'application/json',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: t,
    },
    {
      id: demoId('2'),
      url: 'https://api.example.com/v1/projects?page=1&limit=20',
      method: 'GET',
      status: 200,
      startTime: next(2400),
      endTime: t + 132,
      duration: 132,
      requestHeaders: { accept: 'application/json' },
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify(
        {
          items: [
            { id: 'p_1', name: 'Hakka' },
            { id: 'p_2', name: 'Ramen' },
          ],
          total: 2,
        },
        null,
        2,
      ),
      responseBodySize: 96,
      contentType: 'application/json',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: t,
    },
    {
      id: demoId('3'),
      url: 'https://api.example.com/v1/sessions',
      method: 'POST',
      status: 201,
      startTime: next(1800),
      endTime: t + 210,
      duration: 210,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: JSON.stringify({ deviceId: 'demo-device-1' }, null, 2),
      requestBodySize: 34,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ sessionId: 'sess_demo_1', expiresIn: 3600 }, null, 2),
      responseBodySize: 48,
      contentType: 'application/json',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: t,
    },
    {
      id: demoId('4'),
      url: 'https://api.example.com/v1/checkout',
      method: 'POST',
      status: 500,
      startTime: next(3000),
      endTime: t + 340,
      duration: 340,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: JSON.stringify({ cartId: 'cart_demo_1', total: 42.5 }, null, 2),
      requestBodySize: 40,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ error: 'payment_provider_timeout' }, null, 2),
      responseBodySize: 36,
      contentType: 'application/json',
      error: 'Internal Server Error',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: t,
    },
    {
      id: demoId('5'),
      url: 'https://api.example.com/v1/reports/missing',
      method: 'GET',
      status: 404,
      startTime: next(900),
      endTime: t + 61,
      duration: 61,
      requestHeaders: { accept: 'application/json' },
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ error: 'not_found' }, null, 2),
      responseBodySize: 22,
      contentType: 'application/json',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: t,
    },
    {
      id: demoId('6'),
      // Deliberately slow — sorts to the top when sorted by duration.
      url: 'https://api.example.com/v1/analytics/export',
      method: 'GET',
      status: 200,
      startTime: next(4200),
      endTime: t + 2840,
      duration: 2840,
      requestHeaders: { accept: 'text/csv' },
      responseHeaders: { 'content-type': 'text/csv' },
      responseBody: 'id,event,ts\n1,login,1717000000\n2,purchase,1717000042\n',
      responseBodySize: 54,
      contentType: 'text/csv',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: t,
    },
    {
      id: demoId('7'),
      url: 'https://cdn.example.com/assets/logo.png',
      method: 'GET',
      status: 200,
      startTime: next(1600),
      endTime: t + 46,
      duration: 46,
      responseHeaders: { 'content-type': 'image/png' },
      responseBodySize: 8192,
      contentType: 'image/png',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: t,
    },
    {
      id: demoId('8'),
      url: 'https://api.example.com/v1/preferences',
      method: 'PUT',
      status: 200,
      startTime: next(1100),
      endTime: t + 97,
      duration: 97,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: JSON.stringify({ theme: 'dark', notifications: true }, null, 2),
      requestBodySize: 42,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ ok: true }, null, 2),
      responseBodySize: 12,
      contentType: 'application/json',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: t,
    },
  ]

  // A trace-linked hop chain: one checkout fanned across runtimes, sharing
  // `correlationId`. Start times nest (server begins inside client, upstream
  // inside server) so Trace grouping renders a causal waterfall.
  const traceId = 'trace_demo_checkout'
  const traceStart = next(3600)
  requests.push(
    {
      id: demoId('trace-client'),
      url: 'https://app.example.com/api/checkout',
      method: 'POST',
      status: 200,
      runtime: 'client',
      correlationId: traceId,
      startTime: traceStart,
      endTime: traceStart + 420,
      duration: 420,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: JSON.stringify({ cartId: 'cart_demo_9', total: 42.5 }, null, 2),
      requestBodySize: 40,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ orderId: 'ord_demo_9', status: 'confirmed' }, null, 2),
      responseBodySize: 48,
      contentType: 'application/json',
      source: 'fetch',
      library: DEMO_LIBRARY,
      timestamp: traceStart,
    },
    {
      id: demoId('trace-server'),
      url: 'https://payments.internal/v2/charge',
      method: 'POST',
      status: 200,
      runtime: 'server',
      correlationId: traceId,
      startTime: traceStart + 55,
      endTime: traceStart + 360,
      duration: 305,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: JSON.stringify({ amount: 4250, currency: 'usd' }, null, 2),
      requestBodySize: 36,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ chargeId: 'ch_demo_9', captured: true }, null, 2),
      responseBodySize: 40,
      contentType: 'application/json',
      source: 'http',
      library: DEMO_LIBRARY,
      timestamp: traceStart + 55,
    },
    {
      id: demoId('trace-upstream'),
      url: 'https://ledger.internal/v1/balance',
      method: 'GET',
      status: 200,
      runtime: 'server',
      correlationId: traceId,
      startTime: traceStart + 90,
      endTime: traceStart + 210,
      duration: 120,
      requestHeaders: { accept: 'application/json' },
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ available: 128000 }, null, 2),
      responseBodySize: 24,
      contentType: 'application/json',
      source: 'http',
      library: DEMO_LIBRARY,
      timestamp: traceStart + 90,
    },
  )

  return requests
}
