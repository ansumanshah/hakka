/**
 * Streams a set of realistic captures into a running Hakka for macOS, by
 * connecting to its built-in bridge hub the same way an SDK would. Nothing
 * here talks to a real service: it is fixture traffic, so the traffic list,
 * search, diff, body viewers and the SSE tab all have something to show
 * while you are working on the app.
 *
 *   just feed-desktop        (or: bun scripts/feed-desktop-demo.mjs [port])
 *
 * Run it with bun, which has a global WebSocket, so this needs no deps.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.argv[2] || 8989)
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const now = Date.now()

const jsonBody = (status, url) => {
  if (status >= 500) return JSON.stringify({ error: 'internal_error', requestId: 'r_9f2b1c', retryable: true }, null, 2)
  if (status === 422) return JSON.stringify({ error: 'validation_failed', fields: { phone: 'invalid format' } }, null, 2)
  if (status === 401) return JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }, null, 2)
  return JSON.stringify(
    { ok: true, path: new URL(url).pathname, count: 2, items: [{ id: 'a1', name: 'Item A', tags: ['x', 'y'] }, { id: 'b2', name: 'Item B', tags: [] }] },
    null,
    2,
  )
}

const routes = [
  ['GET', 'https://api.stripe.com/v1/customers?limit=20', 200, 142, 'application/json'],
  ['POST', 'https://api.stripe.com/v1/payment_intents', 201, 380, 'application/json'],
  ['GET', 'https://api.github.com/repos/ansumanshah/hakka', 200, 88, 'application/json'],
  ['GET', 'https://api.github.com/user/repos?per_page=100', 200, 610, 'application/json'],
  ['POST', 'https://api.example.com/v2/cart/items', 500, 1240, 'application/json'],
  ['GET', 'https://cdn.example.com/assets/hero@2x.png', 200, 34, 'image/png'],
  ['GET', 'https://cdn.example.com/assets/logo.svg', 304, 9, 'image/svg+xml'],
  ['POST', 'https://api.example.com/v2/session', 401, 96, 'application/json'],
  ['PATCH', 'https://api.example.com/v2/profile', 422, 155, 'application/json'],
  ['GET', 'https://api.example.com/v2/search?q=milk', 200, 130, 'application/json'],
  ['POST', 'https://api.segment.io/v1/track', 204, 41, 'application/json'],
]

function record(i, [method, url, status, duration, ctype]) {
  const start = now - (routes.length - i) * 900
  return {
    id: `req_${i + 1}_${now}`,
    url,
    method,
    status,
    startTime: start,
    endTime: start + duration,
    duration,
    requestHeaders: { accept: ['application/json'], authorization: ['[REDACTED]'], 'user-agent': ['Hakka/0.1.0 (macOS)'] },
    responseHeaders: { 'content-type': [ctype], 'x-request-id': [`rq_${i}${now % 997}`], server: ['cloudflare'] },
    requestBody: method === 'POST' || method === 'PATCH' ? JSON.stringify({ amount: 4200, currency: 'inr' }, null, 2) : null,
    responseBody: ctype.includes('json') ? jsonBody(status, url) : null,
    requestBodySize: method === 'POST' || method === 'PATCH' ? 48 : 0,
    responseBodySize: ctype.includes('json') ? 512 : 18_400,
    dnsMs: 12,
    tlsMs: 41,
    connectMs: 28,
    ttfbMs: Math.round(duration * 0.7),
    downloadMs: Math.round(duration * 0.2),
    source: 'fetch',
  }
}

/** Same endpoint captured twice with a changed response, so Compare has a real diff. */
function diffPair() {
  const base = {
    url: 'https://api.example.com/v2/orders?status=active',
    method: 'GET',
    status: 200,
    requestHeaders: { accept: ['application/json'] },
    requestBodySize: 0,
    source: 'fetch',
  }
  return [
    { ...base, id: `req_diff_a_${now}`, startTime: now - 400, endTime: now - 190, duration: 210, responseHeaders: { 'content-type': ['application/json'], 'x-cache': ['HIT'] }, responseBody: JSON.stringify({ orders: [{ id: 'o1', total: 420 }], page: 1 }, null, 2), responseBodySize: 96 },
    { ...base, id: `req_diff_b_${now}`, startTime: now, endTime: now + 260, duration: 260, responseHeaders: { 'content-type': ['application/json'], etag: ['"7f3a"'] }, responseBody: JSON.stringify({ orders: [{ id: 'o1', total: 480 }, { id: 'o2', total: 190 }], page: 1 }, null, 2), responseBodySize: 148 },
  ]
}

/** A real pinned OpenAI stream transcript, so the SSE tab and the token usage section have content. */
function llmStream() {
  const sse = readFileSync(join(REPO, 'fixtures/sse/openai-chat-chunks.sse'), 'utf-8')
  return {
    id: `req_sse_${now}`,
    url: 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
    status: 200,
    startTime: now - 2400,
    endTime: now,
    duration: 2400,
    requestHeaders: { accept: ['text/event-stream'], authorization: ['[REDACTED]'] },
    responseHeaders: { 'content-type': ['text/event-stream'] },
    requestBody: JSON.stringify({ model: 'gpt-4o-mini', stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: 'say hi' }] }, null, 2),
    responseBody: sse,
    requestBodySize: 148,
    responseBodySize: sse.length,
    ttfbMs: 310,
    source: 'fetch',
  }
}

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)

ws.addEventListener('open', () => {
  const payloads = [...routes.map((r, i) => record(i, r)), ...diffPair(), llmStream()]
  for (const payload of payloads) ws.send(JSON.stringify({ type: 'request', payload }))
  console.log(`fed ${payloads.length} captures to ws://127.0.0.1:${PORT}`)
  setTimeout(() => {
    ws.close()
    process.exit(0)
  }, 600)
})

ws.addEventListener('error', () => {
  console.error(`could not reach the hub on ws://127.0.0.1:${PORT} — is Hakka.app running?`)
  process.exit(1)
})
