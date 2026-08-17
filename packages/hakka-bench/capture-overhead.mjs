/**
 * capture-overhead.mjs — per-request MAIN-THREAD overhead of network capture.
 * Each scenario runs in its own process (fresh `fetch` patch) so tools never stack.
 * See RESULTS.md for methodology and results.
 *
 *   bun capture-overhead.mjs <scenario>
 *     baseline | hakka-worker | hakka-inproc | eruda | vconsole
 *     Append `-large` to a hakka-* scenario to run it against a ~200KB body.
 *
 * Emits one JSON line: { scenario, perReqUs, totalMs, n }.
 */
import { Window } from 'happy-dom'

const N = 40_000
const WARMUP = 4_000
const BODY_SMALL = JSON.stringify({
  id: 42,
  name: 'Ada Lovelace',
  roles: ['admin', 'user'],
  nested: { a: 1, b: [1, 2, 3] },
})
// ~200KB — near hakka-core's default 256KB (`DEFAULT_CONFIG.maxBodySize`) capture
// cap. Still one honest field (not padding spread across thousands of nested
// objects) so this measures clone/copy cost of a large-but-realistic payload
// (e.g. a big list or blob response), not an artificial worst case.
const BODY_LARGE = JSON.stringify({
  id: 42,
  name: 'Ada Lovelace',
  roles: ['admin', 'user'],
  blob: 'x'.repeat(200_000),
})

// eruda / vConsole need a document to initialize.
function installDom() {
  const win = new Window({ url: 'http://localhost:3000/' })
  globalThis.window = win
  globalThis.self = win
  for (const k of [
    'document',
    'navigator',
    'location',
    'history',
    'screen',
    'innerWidth',
    'innerHeight',
    'devicePixelRatio',
    'matchMedia',
    'HTMLElement',
    'Element',
    'Node',
    'customElements',
    'localStorage',
    'sessionStorage',
    'getComputedStyle',
    'MutationObserver',
    'ResizeObserver',
    'CSS',
    'CSSStyleSheet',
    'Event',
    'CustomEvent',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'XMLHttpRequest',
  ]) {
    try {
      if (win[k] !== undefined) globalThis[k] = win[k]
    } catch {
      /* some globals are read-only; skip */
    }
  }
  return win
}

// After a DOM tool inits, it wraps `window.fetch` (or `globalThis.fetch`). Return
// whichever reference is no longer the original stub, or null if neither wrapped.
function resolveWrappedFetch(win, stub) {
  if (win.fetch && win.fetch !== stub) return win.fetch
  if (globalThis.fetch && globalThis.fetch !== stub) return globalThis.fetch
  return null
}

// Resolves instantly so we measure interception, not network. Headers mirror real
// servers because hakka-core's readCappedBody routes on them: Content-Length takes
// the native text() fast path, gzip forces the cancel-at-cap stream path.
function makeStub() {
  const headers = {
    'content-type': 'application/json',
    'x-served-by': 'stub',
    'content-length': String(BODY.length),
    ...(isLarge ? { 'content-encoding': 'gzip' } : {}),
  }
  return () => Promise.resolve(new Response(BODY, { status: 200, headers }))
}

async function run(label, calls) {
  for (let i = 0; i < WARMUP; i++) await calls()
  const t0 = performance.now()
  for (let i = 0; i < N; i++) await calls()
  const totalMs = performance.now() - t0
  return { scenario: label, perReqUs: (totalMs * 1000) / N, totalMs, n: N }
}

const rawScenario = process.argv[2] ?? 'baseline'
// `-large` is a body-size modifier, not a distinct tool — strip it to dispatch
// on the base scenario, but keep emitting the raw name so run.mjs's table shows
// e.g. "hakka-worker-large" as its own row.
const isLarge = rawScenario.endsWith('-large')
const scenario = isLarge ? rawScenario.slice(0, -'-large'.length) : rawScenario
const BODY = isLarge ? BODY_LARGE : BODY_SMALL

async function main() {
  globalThis.fetch = makeStub()

  if (scenario === 'baseline') {
    const f = globalThis.fetch
    return run(rawScenario, () => f('https://api.example.com/users', { method: 'GET' }))
  }

  if (scenario === 'hakka-worker' || scenario === 'hakka-inproc') {
    const core = await import('hakka-core')
    let sink
    if (scenario === 'hakka-inproc') {
      core.Hakka.start({ mode: 'store', maxRequests: 500 })
      sink = (req) => core.Hakka.ingest(req)
    } else {
      // Worker model: the only main-thread cost beyond capture is serializing the
      // record for postMessage (structured clone). The store runs off-thread.
      sink = (req) => {
        structuredClone(req)
      }
    }
    const teardown = core.enableFetchInterceptor(sink, 262144, ['authorization', 'cookie', 'set-cookie'])
    const f = globalThis.fetch
    const r = await run(rawScenario, () => f('https://api.example.com/users', { method: 'GET' }))
    teardown()
    return r
  }

  if (scenario === 'eruda') {
    const win = installDom()
    const stub = makeStub()
    win.fetch = stub
    globalThis.fetch = stub
    const eruda = (await import('eruda')).default
    eruda.init()
    const f = resolveWrappedFetch(win, stub)
    if (!f) throw new Error('eruda did not wrap fetch')
    return run('eruda', () => f('https://api.example.com/users', { method: 'GET' }))
  }

  if (scenario === 'vconsole') {
    const win = installDom()
    const stub = makeStub()
    win.fetch = stub
    globalThis.fetch = stub
    const VConsole = (await import('vconsole')).default
    new VConsole()
    const f = resolveWrappedFetch(win, stub)
    if (!f) throw new Error('vConsole did not wrap fetch')
    return run('vconsole', () => f('https://api.example.com/users', { method: 'GET' }))
  }

  throw new Error(`unknown scenario: ${scenario}`)
}

main()
  .then((r) => {
    process.stdout.write(JSON.stringify(r) + '\n')
    process.exit(0)
  })
  .catch((e) => {
    process.stdout.write(JSON.stringify({ scenario: rawScenario, error: String(e?.message ?? e) }) + '\n')
    process.exit(0)
  })
