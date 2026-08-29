/**
 * demo.mjs: proves the ADR 0002 safety properties `hakka-node/prod` ships
 * as defaults, against a real (if tiny) HTTP app. Nothing below is
 * aspirational: every check runs against a live response from app.mjs's
 * server, not a mocked one.
 *
 *   1. A request WITHOUT the cohort header is not captured.
 *   2. A COHORT request whose URL isn't on `captureUrls` is STILL not
 *      captured, the other half of the AND-gate ADR 0002 calls out
 *      explicitly ("a cohort request whose URL isn't on captureUrls still
 *      isn't captured").
 *   3. Bodies come back redacted by default, both the app's outbound
 *      REQUEST body and the upstream's RESPONSE body, since a real bug
 *      report can carry secrets on either side of the hop.
 *   4. A missing or wrong bearer token on the pull route is rejected; the
 *      correct one is accepted.
 *   5. (bonus) the pull route's `?user=` correlationId-prefix filter.
 *
 * `fetch()` captures emit TWICE per logical request (headers-received, then
 * body-complete, see hakka-core's capture/fetch.ts) under the SAME `req.id`,
 * so `captured` below is keyed by id like framework-servers/shared/capture.mjs
 * does, not a plain array: `startProdCapture`'s own ring buffer folds the
 * two emissions into one slot the same way (prod.ts's `ring.update`), so
 * this mirrors what a real deployment's ring buffer already does.
 */
import { startProdApp } from './app.mjs'
import { check, section, summary } from './shared/print.mjs'
import { startUpstream } from './shared/upstream.mjs'

const upstream = await startUpstream()
const captured = new Map() // id -> latest NetworkRequest
const app = await startProdApp(upstream.url, { sink: (req) => captured.set(req.id, req) })

section(`prod-cohort demo  (app on ${app.url}, upstream on ${upstream.url})`)
console.log(`  pull token (demo-only, a real deployment reads this from a secret): ${app.pullToken}`)

// ---- 1. No cohort header -> not captured -------------------------------
await fetch(`${app.url}/notes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-user': 'anonymous' },
  body: JSON.stringify({ note: 'not in the cohort, should never be captured' }),
})
check(
  'non-cohort request (no x-debug-cohort header) is NOT captured',
  captured.size === 0,
  `${captured.size} record(s) captured so far`,
)

// ---- 2. Cohort request to an allowlisted URL -> captured ---------------
await fetch(`${app.url}/notes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-debug-cohort': '1', 'x-user': 'alice' },
  body: JSON.stringify({ note: 'forgot my password', password: 'hunter2' }),
})
check(
  'cohort request to the ALLOWLISTED URL (/notes) IS captured',
  captured.size === 1,
  `${captured.size} record(s) captured so far`,
)

// ---- 3. Cohort request to a NON-allowlisted URL -> still not captured --
await fetch(`${app.url}/admin/secret`, { headers: { 'x-debug-cohort': '1', 'x-user': 'alice' } })
check(
  'cohort request to a URL NOT on captureUrls (/admin/secret) is still NOT captured: the AND-gate',
  captured.size === 1,
  `${captured.size} record(s) captured so far`,
)

// ---- 4. Redaction on both sides of the hop ------------------------------
const record = [...captured.values()][0]
const reqBody = record?.requestBody ? JSON.parse(record.requestBody) : null
const resBody = record?.responseBody ? JSON.parse(record.responseBody) : null
check('captured OUTBOUND REQUEST body redacts `password`', reqBody?.password === '[REDACTED]', JSON.stringify(reqBody))
check(
  'captured OUTBOUND REQUEST body leaves `note` intact (not blanket redaction)',
  reqBody?.note === 'forgot my password',
  JSON.stringify(reqBody),
)
check('captured upstream RESPONSE body redacts `token`', resBody?.token === '[REDACTED]', JSON.stringify(resBody))
check(
  'captured upstream RESPONSE body redacts the echoed `password` too',
  resBody?.password === '[REDACTED]',
  JSON.stringify(resBody),
)

// ---- 5. Pull route: bearer token gate ------------------------------------
const pull = (headers, query = '') => fetch(`${app.url}/__hakka/pull${query}`, { headers })

const noToken = await pull({})
check('pull route 401s with NO Authorization header', noToken.status === 401)

const missingLengthToken = await pull({ authorization: 'Bearer short' })
check('pull route 401s with a wrong bearer token (different length)', missingLengthToken.status === 401)

const sameLengthWrongToken = await pull({ authorization: `Bearer ${'x'.repeat(app.pullToken.length)}` })
check(
  'pull route 401s with a wrong bearer token (same length, exercises the timingSafeEqual path)',
  sameLengthWrongToken.status === 401,
)

const rightToken = await pull({ authorization: `Bearer ${app.pullToken}` })
check('pull route 200s with the correct bearer token', rightToken.status === 200)
const pulled = await rightToken.json()
check('pulled records match the ring buffer: only the allowlisted + cohort call', pulled.records.length === 1)

// ---- 6. Pull route: ?user= correlationId-prefix filter -------------------
const aliceOnly = await pull({ authorization: `Bearer ${app.pullToken}` }, '?user=alice').then((r) => r.json())
check('?user=alice returns the alice record', aliceOnly.records.length === 1)

const bobOnly = await pull({ authorization: `Bearer ${app.pullToken}` }, '?user=bob').then((r) => r.json())
check('?user=bob returns nothing: no bob records were ever captured', bobOnly.records.length === 0)

await app.stop()
await new Promise((resolve) => upstream.server.close(resolve))
app.capture.stop()

process.exit(summary() ? 0 : 1)
