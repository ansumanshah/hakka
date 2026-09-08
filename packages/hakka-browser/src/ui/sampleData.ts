/** Demo traffic for the empty-state "Load sample traffic" action. */
import type { NetworkRequest } from 'hakka-core'

/** Build realistic demo requests, including a trace-linked client to server to upstream chain. */
export function buildSampleRequests(): NetworkRequest[] {
  let time = Date.now() - 90_000
  const make = (
    suffix: string,
    url: string,
    method: string,
    status: number,
    step: number,
    duration: number,
    extra: Partial<NetworkRequest> = {},
  ): NetworkRequest => {
    time += step
    return {
      id: `demo-${suffix}`,
      url,
      method,
      status,
      startTime: time,
      endTime: time + duration,
      duration,
      source: 'fetch',
      library: 'demo',
      timestamp: time,
      responseHeaders: headers(),
      contentType: 'application/json',
      ...extra,
    }
  }
  const json = (value: unknown) => JSON.stringify(value, null, 2)
  const headers = () => ({ 'content-type': 'application/json' })
  const requests = [
    make('1', 'https://api.example.com/v1/users/me', 'GET', 200, 1200, 84, {
      requestHeaders: { accept: 'application/json', authorization: 'Bearer demo-token' },
      responseBody: json({ id: 'u_1', name: 'Ada Lovelace', plan: 'pro' }),
      responseBodySize: 58,
    }),
    make('2', 'https://api.example.com/v1/projects?page=1&limit=20', 'GET', 200, 2400, 132, {
      requestHeaders: { accept: 'application/json' },
      responseBody: json({
        items: [
          { id: 'p_1', name: 'Hakka' },
          { id: 'p_2', name: 'Ramen' },
        ],
        total: 2,
      }),
      responseBodySize: 96,
    }),
    make('3', 'https://api.example.com/v1/sessions', 'POST', 201, 1800, 210, {
      requestHeaders: headers(),
      requestBody: json({ deviceId: 'demo-device-1' }),
      requestBodySize: 34,
      responseBody: json({ sessionId: 'sess_demo_1', expiresIn: 3600 }),
      responseBodySize: 48,
    }),
    make('4', 'https://api.example.com/v1/checkout', 'POST', 500, 3000, 340, {
      requestHeaders: headers(),
      requestBody: json({ cartId: 'cart_demo_1', total: 42.5 }),
      requestBodySize: 40,
      responseBody: json({ error: 'payment_provider_timeout' }),
      responseBodySize: 36,
      error: 'Internal Server Error',
    }),
    make('5', 'https://api.example.com/v1/reports/missing', 'GET', 404, 900, 61, {
      requestHeaders: { accept: 'application/json' },
      responseBody: json({ error: 'not_found' }),
      responseBodySize: 22,
    }),
    make('6', 'https://api.example.com/v1/analytics/export', 'GET', 200, 4200, 2840, {
      requestHeaders: { accept: 'text/csv' },
      responseHeaders: { 'content-type': 'text/csv' },
      responseBody: 'id,event,ts\n1,login,1717000000\n2,purchase,1717000042\n',
      responseBodySize: 54,
      contentType: 'text/csv',
    }),
    make('7', 'https://cdn.example.com/assets/logo.png', 'GET', 200, 1600, 46, {
      responseHeaders: { 'content-type': 'image/png' },
      responseBodySize: 8192,
      contentType: 'image/png',
    }),
    make('8', 'https://api.example.com/v1/preferences', 'PUT', 200, 1100, 97, {
      requestHeaders: headers(),
      requestBody: json({ theme: 'dark', notifications: true }),
      requestBodySize: 42,
      responseBody: json({ ok: true }),
      responseBodySize: 12,
    }),
  ]

  const traceId = 'trace_demo_checkout'
  requests.push(
    make('trace-client', 'https://app.example.com/api/checkout', 'POST', 200, 3600, 420, {
      runtime: 'client',
      correlationId: traceId,
      requestHeaders: headers(),
      requestBody: json({ cartId: 'cart_demo_9', total: 42.5 }),
      requestBodySize: 40,
      responseBody: json({ orderId: 'ord_demo_9', status: 'confirmed' }),
      responseBodySize: 48,
    }),
    make('trace-server', 'https://payments.internal/v2/charge', 'POST', 200, 55, 305, {
      runtime: 'server',
      correlationId: traceId,
      requestHeaders: headers(),
      requestBody: json({ amount: 4250, currency: 'usd' }),
      requestBodySize: 36,
      responseBody: json({ chargeId: 'ch_demo_9', captured: true }),
      responseBodySize: 40,
      source: 'http',
    }),
    make('trace-upstream', 'https://ledger.internal/v1/balance', 'GET', 200, 35, 120, {
      runtime: 'server',
      correlationId: traceId,
      requestHeaders: { accept: 'application/json' },
      responseBody: json({ available: 128000 }),
      responseBodySize: 24,
      source: 'http',
    }),
  )
  return requests
}
