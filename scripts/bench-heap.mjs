#!/usr/bin/env bun
/**
 * Steady-state heap footprint of a filled hakka-core store (mode: 'store' —
 * the aggregator hakka-browser's store Worker and hakka-node's in-process
 * capture both run on top of).
 *
 *   bun scripts/bench-heap.mjs            # measure + print table (3 reps, median)
 *
 * Each rep runs in its own subprocess (`--worker`) so `Bun.gc(true)` measures
 * a clean heap — the same process-isolation pattern as
 * packages/{web,hakka-node}/bench/run.mjs.
 *
 * Requires the core dist build first: `bun run --cwd packages/hakka-core build` (or
 * `just build-core`) — imports the built `dist/index.mjs` directly, since this
 * script sits outside every workspace package's own node_modules, so the
 * number matches what real apps load, not the TS source.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const THIS_FILE = fileURLToPath(import.meta.url)
const HERE = dirname(THIS_FILE)
const CORE_DIST = join(HERE, '..', 'packages', 'hakka-core', 'dist', 'index.mjs')
const REPS = 3
const MAX_REQUESTS = 500
// 4x turnover past the cap: ensures the ring buffer's oldest-evict path has
// cycled enough for a genuinely steady-state mix, not just the first fill.
const N_INGEST = MAX_REQUESTS * 4

const HOSTS = ['api.example.com', 'cdn.example.com', 'auth.example.com', 'analytics.io']
const METHODS = ['GET', 'POST', 'PUT', 'DELETE']

// 1-in-200 requests carries a ~50KB response body (a big JSON list/blob
// response); the rest are ~2KB (a typical JSON API payload). Averages to
// ~2.24KB/body — "~2KB avg + some 50KB" without a contrived worst case.
function bodyFor(i) {
  if (i % 200 === 0) {
    // ~50KB: 1200 small objects.
    const items = Array.from({ length: 1200 }, (_, j) => ({ i: j, v: `row-${i}-${j}` }))
    return JSON.stringify({ id: i, items })
  }
  // ~2KB: one JSON object with a padded detail field.
  return JSON.stringify({ id: i, name: `item-${i}`, tags: ['a', 'b', 'c'], detail: 'x'.repeat(1900) })
}

function makeRequest(i) {
  const host = HOSTS[i % HOSTS.length]
  const method = METHODS[i % METHODS.length]
  const status = [200, 201, 301, 404, 500][i % 5]
  const responseBody = bodyFor(i)
  const requestBody = method === 'POST' || method === 'PUT' ? JSON.stringify({ q: `item-${i}`, n: i }) : null
  const now = Date.now()
  return {
    id: `r_${i}`,
    url: `https://${host}/v1/resource/${i}?page=${i % 20}`,
    method,
    status,
    startTime: now,
    endTime: now + (i % 500),
    duration: i % 500,
    requestHeaders: { 'content-type': 'application/json', authorization: `Bearer tok_${i}`, accept: '*/*' },
    responseHeaders: { 'content-type': 'application/json' },
    requestBody,
    responseBody,
    requestBodySize: requestBody?.length ?? 0,
    responseBodySize: responseBody.length,
    error: null,
    source: 'fetch',
  }
}

async function runOnce() {
  let core
  try {
    core = await import(CORE_DIST)
  } catch (e) {
    throw new Error(
      `could not load hakka-core dist at ${CORE_DIST} — build it first: bun run --cwd packages/hakka-core build (or 'just build-core'). ${e?.message ?? e}`,
    )
  }
  core.Hakka.start({ mode: 'store', maxRequests: MAX_REQUESTS })

  if (typeof Bun === 'undefined' || !Bun.gc) {
    throw new Error('bench-heap.mjs requires Bun (Bun.gc is used for deterministic measurement)')
  }

  Bun.gc(true)
  await new Promise((r) => setTimeout(r, 10))
  const baseline = process.memoryUsage()

  for (let i = 0; i < N_INGEST; i++) core.Hakka.ingest(makeRequest(i))
  // Retention already runs on every ingest above, but our synthetic startTime
  // is "now" so age-based eviction is a no-op here — it's the ring buffer's
  // count/byte-ceiling eviction that reaches steady state, exercised by
  // ingesting well past MAX_REQUESTS.

  Bun.gc(true)
  await new Promise((r) => setTimeout(r, 10))
  const steady = process.memoryUsage()

  return {
    logsSize: core.Hakka.getLogs().length,
    baseline: { heapUsed: baseline.heapUsed, rss: baseline.rss },
    steady: { heapUsed: steady.heapUsed, rss: steady.rss },
    deltaHeapUsed: steady.heapUsed - baseline.heapUsed,
    deltaRss: steady.rss - baseline.rss,
  }
}

if (process.argv.includes('--worker')) {
  runOnce()
    .then((r) => {
      process.stdout.write(`${JSON.stringify(r)}\n`)
      process.exit(0)
    })
    .catch((e) => {
      process.stdout.write(`${JSON.stringify({ error: String(e?.stack ?? e) })}\n`)
      process.exit(1)
    })
} else {
  const fmtKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
  const median = (nums) => {
    const s = [...nums].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }

  const reps = []
  for (let i = 0; i < REPS; i++) {
    const r = spawnSync('bun', [THIS_FILE, '--worker'], { encoding: 'utf8' })
    const line = (r.stdout || '').trim().split('\n').pop() || '{}'
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      parsed = { error: (r.stderr || '').trim() || 'no-output' }
    }
    if (parsed.error) {
      process.stderr.write(`rep ${i + 1}: FAILED — ${parsed.error}\n`)
      process.exit(1)
    }
    reps.push(parsed)
    process.stderr.write(
      `  rep ${i + 1}: baseline heapUsed ${fmtKb(parsed.baseline.heapUsed)} -> steady ${fmtKb(parsed.steady.heapUsed)} ` +
        `(delta ${fmtKb(parsed.deltaHeapUsed)}, logs=${parsed.logsSize})\n`,
    )
  }

  const medianBaselineHeap = median(reps.map((r) => r.baseline.heapUsed))
  const medianSteadyHeap = median(reps.map((r) => r.steady.heapUsed))
  const medianDeltaHeap = median(reps.map((r) => r.deltaHeapUsed))
  const medianDeltaRss = median(reps.map((r) => r.deltaRss))
  const perRecordBytes = medianDeltaHeap / MAX_REQUESTS

  console.log(`
hakka-core steady-state heap — mode: 'store', maxRequests: ${MAX_REQUESTS}, ${N_INGEST} requests ingested
${'─'.repeat(90)}
Empty baseline heapUsed:   ${fmtKb(medianBaselineHeap)}
Steady-state heapUsed:     ${fmtKb(medianSteadyHeap)}
Delta (heapUsed):          ${fmtKb(medianDeltaHeap)}  (~${fmtKb(perRecordBytes)}/record across ${MAX_REQUESTS} retained)
Delta (rss):               ${fmtKb(medianDeltaRss)}
Median of ${REPS} reps, each a fresh subprocess with Bun.gc(true) before/after fill.
`)
}
