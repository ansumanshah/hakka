/**
 * run.mjs — per-module micro-benchmarks for hakka-core. Every hot path gets a
 * timed op with a documented budget (a regression ceiling, machine-relative).
 *
 *   bun bench/run.mjs            # measure + print table + write RESULTS.md
 *   bun bench/run.mjs --check    # also exit non-zero if any op exceeds its budget
 *   bun bench/run.mjs --calibrate# print suggested budgets (measured × 2) and exit
 *
 * Imports the TS source directly (bun runs TS) so no build step is needed.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { captureBody } from '../src/capture/bodyCapture.ts'
import { decodeWsFrame } from '../src/engine/wsDecoders.ts'
import { networkRequestToRecord } from '../src/model/contract.ts'
import { exportHarString } from '../src/model/har.ts'
import { recordsToOtelJson } from '../src/model/otel.ts'
import { buildPostmanCollection } from '../src/model/postman.ts'
import { compileQuery, groupRequests, parseSearchTokens, sortRequests } from '../src/query/index.ts'
import { RingBuffer } from '../src/storage/RingBuffer.ts'
import { parseRequestCookies, parseSetCookie } from '../src/utils/cookies.ts'
import { redactHeaders } from '../src/utils/headerRedaction.ts'
import { shouldCaptureUrl } from '../src/utils/hostFilter.ts'
import { decodeUrl } from '../src/utils/urlCodec.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPS = 5
const args = new Set(process.argv.slice(2))
const CHECK = args.has('--check')
const CALIBRATE = args.has('--calibrate')

// ── now() in nanoseconds, bun or node ────────────────────────────────────────
const nowNs =
  typeof Bun !== 'undefined' && Bun.nanoseconds ? () => Bun.nanoseconds() : () => Number(process.hrtime.bigint())

// ── Fixture: a realistic, varied request set ─────────────────────────────────
const HOSTS = ['api.example.com', 'cdn.example.com', 'auth.example.com', 'analytics.io']
const METHODS = ['GET', 'POST', 'PUT', 'DELETE']
const N = 2000

function makeRequests(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const host = HOSTS[i % HOSTS.length]
    const method = METHODS[i % METHODS.length]
    const status = [200, 201, 301, 404, 500][i % 5]
    out[i] = {
      id: `r_${i}`,
      url: `https://${host}/v1/resource/${i}?page=${i % 20}&q=hello%20world`,
      method,
      status,
      startTime: 1_700_000_000_000 + i * 7,
      endTime: 1_700_000_000_000 + i * 7 + (i % 500),
      duration: i % 500,
      requestHeaders: { 'content-type': 'application/json', authorization: `Bearer tok_${i}`, accept: '*/*' },
      responseHeaders: { 'content-type': 'application/json', 'set-cookie': `sid=${i}; Path=/; HttpOnly; SameSite=Lax` },
      requestBody: method === 'POST' ? `{"q":"item-${i}","n":${i}}` : null,
      responseBody: `{"ok":true,"id":${i},"items":[${i},${i + 1},${i + 2}]}`,
      requestBodySize: 40,
      responseBodySize: 60,
      error: null,
      source: 'fetch',
    }
  }
  return out
}

const FIXTURE = makeRequests(N)
const RECORDS = FIXTURE.map((r) => networkRequestToRecord(r))
// MQTT PUBLISH frame to topic "a/b", QoS 1, payload "hi" → base64
const MQTT_PUBLISH = (() => {
  const bytes = [0x32, 0x09, 0x00, 0x03, 0x61, 0x2f, 0x62, 0x00, 0x01, 0x68, 0x69] // type3 qos1 topic a/b id1 'hi'
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  // base64 without btoa dependency footgun: use Buffer in the bench runner (node/bun both have it)
  return { data: Buffer.from(bin, 'binary').toString('base64'), binary: true }
})()
const COOKIE_HEADER = 'sid=abc123; theme=dark; _ga=GA1.2.987; lang=en-US'
const SET_COOKIE =
  'sid=abc123; Domain=.example.com; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT; HttpOnly; Secure; SameSite=Strict'
const ENCODED_URL = 'https://api.example.com/search?q=hello%20world%26more&tag=%F0%9F%9A%80'
const SENSITIVE_HEADERS = {
  authorization: 'Bearer x',
  cookie: 'a=b',
  'content-type': 'application/json',
  'x-api-key': 'k',
}

const QUERY = { tokens: parseSearchTokens('url:resource -body:nope'), statusDsl: '2XX', method: 'GET' }

// ── bench definitions: one op = one call of fn(i) ────────────────────────────
// budgetUs = regression ceiling in microseconds per op (see RESULTS.md note).
//
// Retuned 2026-07-11 (P2 sprint): every budget below was a "generous first
// cut" (~2x a single clean baseline). Ratcheted to a real regression ceiling:
// 10 fresh `bun bench/run.mjs` runs on an otherwise-typical dev machine
// (light concurrent load), max observed per op × 1.3, then rounded up to a
// clean number for headroom. Never loosened vs. the previous value. Re-run
// the same sampling before tightening further — these are still comfortably
// above the observed max, not the tightest theoretically defensible number.
const BENCHES = [
  { name: 'RingBuffer.add', iters: 200_000, budgetUs: 0.7, group: 'storage', fn: ringAdd() },
  { name: 'RingBuffer.getAll (2000)', iters: 2_000, budgetUs: 30, group: 'storage', fn: ringGetAll() },
  { name: 'RingBuffer.getByUrl', iters: 200_000, budgetUs: 0.1, group: 'storage', fn: ringGetByUrl() },
  // Default config always sets a maxAge, so removeOlderThan runs on every ingest.
  // With the tail-walk rewrite this should be ~O(1) when nothing is stale — this
  // case guards against a regression back to a full-buffer rebuild per ingest.
  {
    name: 'removeOlderThan (retention)',
    iters: 200_000,
    budgetUs: 0.05,
    group: 'storage',
    fn: ringRemoveOlderThanActive(),
  },
  {
    name: 'parseSearchTokens',
    iters: 200_000,
    budgetUs: 1,
    group: 'query',
    fn: () => parseSearchTokens('url:api -body:secret /err.*/ "two words"'),
  },
  { name: 'compileQuery (build)', iters: 100_000, budgetUs: 0.2, group: 'query', fn: () => compileQuery(QUERY) },
  { name: 'predicate eval (per req)', iters: 1_000_000, budgetUs: 0.25, group: 'query', fn: predicateEval() },
  {
    name: 'sortRequests (2000)',
    iters: 1_000,
    budgetUs: 100,
    group: 'query',
    fn: () => sortRequests(FIXTURE, 'duration', 'desc'),
  },
  // groupRequests parses new URL() per item for host buckets; runs only on group-change while the panel is open.
  {
    name: 'groupRequests (2000)',
    iters: 2_000,
    budgetUs: 120,
    group: 'query',
    fn: () => groupRequests(FIXTURE, 'host'),
  },
  // Exports are user-triggered and run in the Worker (off the UI thread); generous CI headroom.
  { name: 'exportHarString (2000)', iters: 200, budgetUs: 12_000, group: 'export', fn: () => exportHarString(FIXTURE) },
  {
    name: 'recordsToOtelJson (2000)',
    iters: 200,
    budgetUs: 2_000,
    group: 'export',
    fn: () => recordsToOtelJson(RECORDS),
  },
  {
    name: 'buildPostmanCollection (2000)',
    iters: 1_000,
    budgetUs: 2_000,
    group: 'export',
    fn: () => buildPostmanCollection(FIXTURE),
  },
  {
    name: 'captureBody (string)',
    iters: 1_000_000,
    budgetUs: 0.02,
    group: 'capture',
    fn: () => captureBody('{"hello":"world","n":42}'),
  },
  {
    name: 'redactHeaders',
    iters: 500_000,
    budgetUs: 0.6,
    group: 'capture',
    fn: () => redactHeaders(SENSITIVE_HEADERS, []),
  },
  {
    name: 'shouldCaptureUrl',
    iters: 1_000_000,
    budgetUs: 0.5,
    group: 'capture',
    fn: () => shouldCaptureUrl('https://api.example.com/v1/x', { ignoreHosts: [], ignorePatterns: [] }),
  },
  // Wildcard host pattern — hostMatchesList's glob branch used to call globToRegExp
  // fresh per call; this guards the compiled-glob cache added in hostFilter.ts.
  {
    name: 'shouldCaptureUrl (wildcard)',
    iters: 1_000_000,
    budgetUs: 0.7,
    group: 'capture',
    fn: () =>
      shouldCaptureUrl('https://sub.example.com/v1/x', { mode: 'blacklist', hosts: ['*.example.com', '*.other.com'] }),
  },
  {
    name: 'decodeWsFrame (mqtt)',
    iters: 500_000,
    budgetUs: 0.8,
    group: 'decode',
    fn: () => decodeWsFrame(MQTT_PUBLISH, 'mqtt'),
  },
  { name: 'parseSetCookie', iters: 500_000, budgetUs: 1.6, group: 'decode', fn: () => parseSetCookie(SET_COOKIE) },
  {
    name: 'parseRequestCookies',
    iters: 500_000,
    budgetUs: 1,
    group: 'decode',
    fn: () => parseRequestCookies(COOKIE_HEADER),
  },
  { name: 'decodeUrl', iters: 1_000_000, budgetUs: 0.3, group: 'decode', fn: () => decodeUrl(ENCODED_URL) },
]

function ringAdd() {
  const buf = new RingBuffer(4096)
  let i = 0
  return () => {
    buf.add({ ...FIXTURE[i % N], id: `add_${i++}` })
  }
}
function ringGetAll() {
  const buf = new RingBuffer(N)
  for (const r of FIXTURE) buf.add(r)
  return () => buf.getAll()
}
function ringRemoveOlderThanActive() {
  const buf = new RingBuffer(N)
  const now = Date.now()
  for (const r of FIXTURE) buf.add({ ...r, startTime: now }) // all fresh — nothing to prune
  const maxAgeMs = 24 * 60 * 60 * 1000 // matches DEFAULT_CONFIG.maxAge (86400s)
  return () => buf.removeOlderThan(maxAgeMs)
}
function ringGetByUrl() {
  const buf = new RingBuffer(N)
  for (const r of FIXTURE) buf.add(r)
  let i = 0
  return () => buf.getByUrl(FIXTURE[i++ % N].url)
}
function predicateEval() {
  const pred = compileQuery(QUERY)
  let i = 0
  return () => pred(FIXTURE[i++ % N])
}

// ── timing ───────────────────────────────────────────────────────────────────
function measureOnce(fn, iters) {
  const warm = Math.min(iters, 2_000)
  for (let i = 0; i < warm; i++) fn(i)
  const t0 = nowNs()
  for (let i = 0; i < iters; i++) fn(i)
  const t1 = nowNs()
  return (t1 - t0) / iters / 1000 // µs per op
}
function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const results = BENCHES.map((b) => {
  const reps = []
  for (let r = 0; r < REPS; r++) reps.push(measureOnce(b.fn, b.iters))
  const us = median(reps)
  return { ...b, us, ok: us <= b.budgetUs }
})

// ── output ───────────────────────────────────────────────────────────────────
const fmtUs = (us) =>
  us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : us >= 1 ? `${us.toFixed(2)} µs` : `${(us * 1000).toFixed(0)} ns`
const pad = (s, n) => String(s).padEnd(n)
const w = [30, 14, 14, 8]
const header = ['Module op', 'Measured', 'Budget', 'Status'].map((h, i) => pad(h, w[i])).join('')
const body = results
  .map((r) => [r.name, fmtUs(r.us), fmtUs(r.budgetUs), r.ok ? 'ok' : 'OVER'].map((c, i) => pad(c, w[i])).join(''))
  .join('\n')
console.log('\n' + header + '\n' + w.map((n) => '─'.repeat(n - 1)).join(' ') + '\n' + body + '\n')

if (CALIBRATE) {
  console.log('Suggested budgets (measured × 2):')
  for (const r of results) console.log(`  ${pad(r.name, 30)} ${(r.us * 2).toPrecision(2)}`)
  process.exit(0)
}

const md = `# hakka-core per-module micro-benchmarks

Single-op timing for every hot path in the engine. Budgets are **regression ceilings**
(machine-relative), retuned 2026-07-11 to observed max (10 fresh runs) × 1.3, rounded up —
they catch a real regression, not just a >2× slowdown. Median of ${REPS} reps within each
run. Run: \`bun bench/run.mjs\` · gate: \`bun bench/run.mjs --check\` ·
recalibrate after intended changes: \`bun bench/run.mjs --calibrate\`.

| Module op | Measured | Budget | Status |
|---|---|---|---|
${results.map((r) => `| ${r.name} | ${fmtUs(r.us)} | ${fmtUs(r.budgetUs)} | ${r.ok ? '✅' : '❌ OVER'} |`).join('\n')}

Fixture: ${N} synthetic requests with realistic headers/bodies. "(2000)" ops process the whole
fixture per call; the rest are per-item. Numbers vary by machine; regenerate locally.
`
writeFileSync(join(HERE, 'RESULTS.md'), md)
process.stderr.write(`\nWrote ${join(HERE, 'RESULTS.md')}\n`)

const over = results.filter((r) => !r.ok)
if (over.length) {
  process.stderr.write(
    `\n${over.length} op(s) over budget:\n${over.map((r) => `  ${r.name}: ${fmtUs(r.us)} > ${fmtUs(r.budgetUs)}`).join('\n')}\n`,
  )
  if (CHECK) process.exit(1)
}
