/**
 * run.mjs — drive every capture-overhead scenario in its own process, take the
 * median of a few reps, and print a comparison table (and write RESULTS.md).
 *
 *   bun run.mjs            # measure + print table + write RESULTS.md
 *   bun run.mjs --check    # also exit non-zero if a gated scenario is over budget
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'capture-overhead.mjs')
const REPS = 3
const SCENARIOS = ['baseline', 'hakka-worker', 'hakka-worker-large', 'hakka-inproc', 'vconsole', 'eruda']
const args = new Set(process.argv.slice(2))
const CHECK = args.has('--check')

const LABELS = {
  baseline: 'Baseline (no capture)',
  'hakka-worker': 'hakka-browser (Worker model)',
  'hakka-worker-large': 'hakka-browser (Worker model, ~200KB body)',
  'hakka-inproc': 'hakka-browser (in-process, no Worker)',
  vconsole: 'vConsole',
  eruda: 'eruda',
}

// Per-scenario µs/request budgets = max observed over 3 runs × 1.3, rounded up.
// Only the shipped default path (Worker model) and its near-cap-body variant are
// gated; vConsole/eruda/in-process are reference rows, not a CI-failing budget.
const BUDGETS = {
  'hakka-worker': 13, // Content-Length fast path
  'hakka-worker-large': 185, // cancel-at-cap stream path
}

function once(scenario) {
  const r = spawnSync('bun', [SCRIPT, scenario], { encoding: 'utf8' })
  const line = (r.stdout || '').trim().split('\n').pop() || '{}'
  try {
    return JSON.parse(line)
  } catch {
    return { scenario, error: 'no-output' }
  }
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const results = {}
for (const s of SCENARIOS) {
  const reps = []
  let err = null
  for (let i = 0; i < REPS; i++) {
    const r = once(s)
    if (r.error) {
      err = r.error
      break
    }
    reps.push(r.perReqUs)
  }
  results[s] = err ? { error: err } : { perReqUs: median(reps) }
  process.stderr.write(`  ${s}: ${err ? `n/a (${err})` : `${results[s].perReqUs.toFixed(2)} µs/req`}\n`)
}

const base = results.baseline?.perReqUs ?? 0
const fmt = (s) => {
  const r = results[s]
  if (r.error) return { tool: LABELS[s], perReq: 'not measurable headlessly', overhead: '—', vsWorker: '—' }
  const overhead = r.perReqUs - base
  const worker = results['hakka-worker']?.perReqUs
  // The `-large` row is a body-size variant of hakka-worker, not a competing
  // tool — comparing its large-body overhead against the small-body baseline's
  // "vs Worker" ratio would be apples-to-oranges, so it gets its own dash.
  const skipVsWorker = !worker || s === 'baseline' || s === 'hakka-worker' || s.endsWith('-large')
  return {
    tool: LABELS[s],
    perReq: `${r.perReqUs.toFixed(2)} µs`,
    overhead: s === 'baseline' ? '—' : `${overhead.toFixed(2)} µs`,
    vsWorker: skipVsWorker ? '—' : `${(overhead / (worker - base)).toFixed(1)}× hakka`,
  }
}

const rows = SCENARIOS.map(fmt)
const pad = (s, n) => String(s).padEnd(n)
const w = [40, 27, 18, 14]
const header = ['Tool', 'Per request', 'Capture overhead', 'vs Worker'].map((h, i) => pad(h, w[i])).join('')
const sep = w.map((n) => '─'.repeat(n - 1)).join(' ')
const body = rows.map((r) => [r.tool, r.perReq, r.overhead, r.vsWorker].map((c, i) => pad(c, w[i])).join('')).join('\n')

console.log('\n' + header + '\n' + sep + '\n' + body + '\n')

const md = `# hakka-browser capture overhead vs competitors

Per-request **main-thread** time added by network capture — the number that affects a host
app's responsiveness. Each tool runs in its own process (fresh \`fetch\` patch). Median of
${REPS} reps, ${40_000} requests each, against an instant-resolving stub so we measure
interception, not the network. Run: \`bun run --cwd packages/hakka-bench bench\`.

| Tool | Per request (µs) | Capture overhead | Relative |
|---|---|---|---|
${rows.map((r) => `| ${r.tool} | ${r.perReq} | ${r.overhead} | ${r.vsWorker} |`).join('\n')}

## How to read this

- **Worker model** is how hakka-browser ships: the interceptor captures on the main thread and
  posts the record to a Web Worker. The store, dedup, retention, filter/search, HAR/OTel
  serialization, and the desktop-bridge socket all run **off** the main thread. Main-thread
  cost ≈ capture + the structured-clone for \`postMessage\`.
- **in-process** is the same engine with the Worker disabled (the SSR / no-Worker fallback) —
  it does the full store pipeline on the main thread. Its per-request cost can now come in
  BELOW the Worker row (ring-buffer ingest is cheaper than the structured clone), but that's
  only the ingest half of the story: with the Worker, filtering, search, retention scans, and
  HAR/OTel serialization also leave the main thread — in-process pays for those at
  interaction time instead.
- **vConsole** stores and renders on the main thread by architecture, like every other
  web-overlay inspector. **eruda** could not be instrumented headlessly (it needs a real
  browser to initialize); its network capture is also synchronous main-thread by design.
- **~200KB body** is a near-cap fixture (hakka-core's default \`maxBodySize\` is 256KB) that
  declares \`content-encoding: gzip\`, like real large payloads do — which forces the
  cancel-at-cap STREAM read (no decoded-size bound is knowable up front), the bounded-memory
  path that keeps huge bodies from allocating unbounded strings. The small-body row declares
  an identity \`Content-Length\`, like real small responses do, and takes the native-read fast
  path. Together the two rows price both capture paths honestly.

## Budgets (retuned 2026-07-11: max observed over 3 fresh runs × 1.3, rounded up)

${Object.entries(BUDGETS)
  .map(([s, us]) => `- ${LABELS[s]}: ≤ ${us} µs/req`)
  .join('\n')}

Numbers vary by machine; regenerate locally with \`bun run --cwd packages/hakka-bench bench\`.
`
writeFileSync(join(HERE, 'RESULTS.md'), md)
process.stderr.write(`\nWrote ${join(HERE, 'RESULTS.md')}\n`)

if (CHECK) {
  const failures = []
  for (const [s, budget] of Object.entries(BUDGETS)) {
    const r = results[s]
    if (!r || r.error) {
      failures.push(`${s}: could not measure (${r?.error ?? 'missing'})`)
      continue
    }
    if (r.perReqUs > budget) {
      failures.push(`${s}: ${r.perReqUs.toFixed(2)}µs/req > budget ${budget}µs/req`)
    }
  }
  if (failures.length) {
    process.stderr.write(`\n${failures.length} scenario(s) over budget:\n${failures.map((f) => `  ${f}`).join('\n')}\n`)
    process.exit(1)
  }
}
