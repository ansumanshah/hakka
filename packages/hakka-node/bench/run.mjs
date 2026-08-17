/**
 * run.mjs — drive hakka-node's capture-overhead scenarios (fetch path + node
 * http path) each in their own process, take the median of a few reps, print a
 * comparison table (and write RESULTS.md), and — in --check mode — assert the
 * *added* p99 latency stays under budget.
 *
 *   bun bench/run.mjs            # measure + print table + write RESULTS.md
 *   bun bench/run.mjs --check    # also exit non-zero if either path is over budget
 *
 * The performance contract this enforces: startCapture() must stay cheap enough
 * that dropping it into a production Node server is a non-decision.
 *
 * Retuned 2026-07-11 (P2 sprint): budgets were a generous first cut (2 ms /
 * 500 µs). This metric — p99 ADDED latency, a difference of two independently
 * sampled percentiles over only 2000 requests — is genuinely noisy: 15 fresh
 * `bun bench/run.mjs` runs on a dev machine under light concurrent load swung
 * from -134 µs to +153 µs (http) and -34 µs to +72 µs (fetch), including
 * negative "added" readings when the baseline sample's p99 happened to land
 * high. Budgets below are max(15 runs) × 1.3, rounded up — wider than a
 * single 3-run sample would suggest, deliberately, so CI doesn't flake on
 * this noise. Re-sample (10+ runs, not 3) before tightening further.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'capture-overhead.mjs')
const REPS = 3
const SCENARIOS = ['baseline-fetch', 'hakka-fetch', 'baseline-http', 'hakka-http']
const args = new Set(process.argv.slice(2))
const CHECK = args.has('--check')

// p99 ADDED latency (capture − baseline), in µs, per capture surface.
// See the file-header note: max observed over 15 fresh runs × 1.3, rounded up.
const BUDGETS = {
  fetch: 100, // was 2_000 (2 ms) — observed max +71.8 µs (fetch/undici path)
  http: 200, // was 500 — observed max +152.8 µs (node:http transport path)
}

const LABELS = {
  'baseline-fetch': 'Baseline (fetch, no capture)',
  'hakka-fetch': 'hakka-node (fetch path)',
  'baseline-http': 'Baseline (http.request, no capture)',
  'hakka-http': 'hakka-node (http.request path)',
}

function once(scenario) {
  const r = spawnSync('bun', [SCRIPT, scenario], { encoding: 'utf8' })
  const line = (r.stdout || '').trim().split('\n').pop() || '{}'
  try {
    return JSON.parse(line)
  } catch {
    return { scenario, error: (r.stderr || '').trim() || 'no-output' }
  }
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function measureAll() {
  const results = {}
  for (const s of SCENARIOS) {
    const p50s = []
    const p99s = []
    let err = null
    for (let i = 0; i < REPS; i++) {
      const r = once(s)
      if (r.error) {
        err = r.error
        break
      }
      p50s.push(r.p50Us)
      p99s.push(r.p99Us)
    }
    results[s] = err ? { error: err } : { p50Us: median(p50s), p99Us: median(p99s) }
    process.stderr.write(
      `  ${s}: ${err ? `n/a (${err})` : `p50 ${results[s].p50Us.toFixed(1)}µs / p99 ${results[s].p99Us.toFixed(1)}µs`}\n`,
    )
  }
  return results
}

function addedLatency(results, pathKey) {
  const base = results[`baseline-${pathKey}`]
  const cap = results[`hakka-${pathKey}`]
  if (!base || !cap || base.error || cap.error) return null
  return { p50: cap.p50Us - base.p50Us, p99: cap.p99Us - base.p99Us }
}

function report(results) {
  const rows = SCENARIOS.map((s) => {
    const r = results[s]
    if (r.error) return { label: LABELS[s], p50: 'n/a', p99: 'n/a', added: 'n/a' }
    const pathKey = s.endsWith('-fetch') ? 'fetch' : 'http'
    const isHakka = s.startsWith('hakka-')
    const added = isHakka ? addedLatency(results, pathKey) : null
    return {
      label: LABELS[s],
      p50: `${r.p50Us.toFixed(1)} µs`,
      p99: `${r.p99Us.toFixed(1)} µs`,
      added: added ? `+${added.p99.toFixed(1)} µs` : '—',
    }
  })

  const pad = (s, n) => String(s).padEnd(n)
  const w = [38, 14, 14, 16]
  const header = ['Scenario', 'p50', 'p99', 'p99 added'].map((h, i) => pad(h, w[i])).join('')
  const sep = w.map((n) => '─'.repeat(n - 1)).join(' ')
  const body = rows.map((r) => [r.label, r.p50, r.p99, r.added].map((c, i) => pad(c, w[i])).join('')).join('\n')
  console.log('\n' + header + '\n' + sep + '\n' + body + '\n')

  const md = `# hakka-node capture overhead

Per-request wall time \`startCapture()\` adds on top of a bare \`node:http\` server,
for both capture surfaces: the \`fetch()\` interceptor and the Node \`http\`/\`https\`
interceptor. Bridge streaming is disabled (\`bridge: false\`) so this isolates
capture cost, not WebSocket I/O to a bridge hub. Median of ${REPS} reps, ${2_000}
requests each (after a ${200}-request warmup). Run: \`bun bench/run.mjs\` · gate:
\`bun bench/run.mjs --check\`.

| Scenario | p50 | p99 | p99 added |
|---|---|---|---|
${rows.map((r) => `| ${r.label} | ${r.p50} | ${r.p99} | ${r.added} |`).join('\n')}

## Budgets (retuned 2026-07-11: max observed over 15 fresh runs × 1.3, rounded up)

- fetch path: p99 added ≤ ${BUDGETS.fetch} µs
- http path: p99 added ≤ ${BUDGETS.http} µs

This p99-added metric is a difference of two independently sampled percentiles over
only 2000 requests, so it is noisier than it looks — 15 fresh runs on a dev machine
under light concurrent load ranged from -134 µs to +153 µs (http) and -34 µs to +72 µs
(fetch), including negative "added" readings. Re-sample 10+ runs (not 3) before
tightening further; a 3-run sample understated the true tail by ~2× in that sampling.

Numbers vary by machine; regenerate locally with \`bun bench/run.mjs\`.
`
  writeFileSync(join(HERE, 'RESULTS.md'), md)
  process.stderr.write(`\nWrote ${join(HERE, 'RESULTS.md')}\n`)
}

function checkBudgets(results) {
  const failures = []
  for (const [pathKey, budget] of Object.entries(BUDGETS)) {
    const added = addedLatency(results, pathKey)
    if (!added) {
      failures.push(`${pathKey}: could not measure (scenario error)`)
      continue
    }
    if (added.p99 > budget) {
      failures.push(`${pathKey}: p99 added ${added.p99.toFixed(1)}µs > budget ${budget}µs`)
    }
  }
  return failures
}

let results = measureAll()
report(results)

if (CHECK) {
  let failures = checkBudgets(results)
  // CI boxes get noisy under contention; retry the whole measurement once
  // before failing so a single slow rep doesn't flake the gate.
  if (failures.length) {
    process.stderr.write(`\nOver budget (${failures.join('; ')}) — retrying once…\n`)
    results = measureAll()
    report(results)
    failures = checkBudgets(results)
  }
  if (failures.length) {
    process.stderr.write(`\n${failures.length} path(s) over budget:\n${failures.map((f) => `  ${f}`).join('\n')}\n`)
    process.exit(1)
  }
}
