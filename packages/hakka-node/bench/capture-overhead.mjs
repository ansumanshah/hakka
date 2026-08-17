/**
 * capture-overhead.mjs — per-request wall-time overhead `startCapture()` adds on
 * top of a bare `node:http` server, for both capture surfaces hakka-node
 * instruments: the global `fetch()` interceptor and the Node `http`/`https`
 * interceptor. Each scenario runs in its own process (fresh module state — no
 * patches carry over between runs) so requests never double-count.
 *
 *   bun bench/capture-overhead.mjs <scenario>
 *     baseline-fetch  — plain global fetch() against a bare http server, no capture
 *     hakka-fetch     — same fetch() path with startCapture() installed (http capture off)
 *     baseline-http   — plain node:http request() against a bare http server, no capture
 *     hakka-http      — same http.request() path with startCapture() installed (fetch capture off)
 *
 * Only the public entry point is imported — `startCapture`/`stopCapture` — never
 * hakka-node internals, so this bench stays stable while the package's sources
 * are under active development. Bridge streaming is disabled (`bridge: false`,
 * matching the pattern used by hakka-node's own serverCapture tests) so we
 * isolate capture cost, not WebSocket I/O to a bridge hub.
 *
 * Emits one JSON line: { scenario, p50Us, p99Us, n }.
 */
import http from 'node:http'

const N = 2_000
const WARMUP = 200
const RESPONSE_BODY = JSON.stringify({ ok: true, id: 42, items: [1, 2, 3] })

// ── a bare node:http server, no framework, listening on an ephemeral port ────
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Drain the request body before responding, like a real handler would —
      // otherwise the socket can stay half-open and skew request timing.
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(RESPONSE_BODY)
      })
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function percentile(sortedUs, p) {
  const idx = Math.min(sortedUs.length - 1, Math.floor((p / 100) * sortedUs.length))
  return sortedUs[idx]
}

// ── fetch() path ─────────────────────────────────────────────────────────────
async function measureFetch(url) {
  for (let i = 0; i < WARMUP; i++) await fetch(url)
  const samples = Array.from({ length: N })
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint()
    await fetch(url)
    samples[i] = Number(process.hrtime.bigint() - t0) / 1000 // ns → µs
  }
  return samples
}

// ── node:http request() path ─────────────────────────────────────────────────
function httpRequestOnce(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume()
      res.on('end', resolve)
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

async function measureHttp(url) {
  for (let i = 0; i < WARMUP; i++) await httpRequestOnce(url)
  const samples = Array.from({ length: N })
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint()
    await httpRequestOnce(url)
    samples[i] = Number(process.hrtime.bigint() - t0) / 1000
  }
  return samples
}

const scenario = process.argv[2] ?? 'baseline-fetch'

async function main() {
  const server = await startServer()
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/`

  let capture = null
  if (scenario === 'hakka-fetch' || scenario === 'hakka-http') {
    // Public entry only — sibling agents own hakka-node's internals while this
    // bench is being written. `bridge: false` skips the WS hub entirely (no
    // embedded bridge, no client), and each scenario disables the *other*
    // capture surface so the fetch and http numbers stay isolated from each
    // other (fetch() in Node runs on undici, not node:http, so in practice they
    // don't double-instrument the same call — this just keeps intent explicit).
    const { startCapture } = await import('../src/index.ts')
    capture = startCapture({
      bridge: false,
      embedBridge: false,
      sink: () => {},
      captureFetch: scenario === 'hakka-fetch',
      captureHttp: scenario === 'hakka-http',
    })
  }

  let samples
  if (scenario === 'baseline-fetch' || scenario === 'hakka-fetch') {
    samples = await measureFetch(url)
  } else if (scenario === 'baseline-http' || scenario === 'hakka-http') {
    samples = await measureHttp(url)
  } else {
    throw new Error(`unknown scenario: ${scenario}`)
  }

  capture?.stop()
  await new Promise((resolve) => server.close(resolve))

  samples.sort((a, b) => a - b)
  return { scenario, p50Us: percentile(samples, 50), p99Us: percentile(samples, 99), n: N }
}

main()
  .then((r) => {
    process.stdout.write(JSON.stringify(r) + '\n')
    process.exit(0)
  })
  .catch((e) => {
    process.stdout.write(JSON.stringify({ scenario, error: String(e?.message ?? e) }) + '\n')
    process.exit(0)
  })
