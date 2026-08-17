# hakka-node capture overhead

Per-request wall time `startCapture()` adds on top of a bare `node:http` server,
for both capture surfaces: the `fetch()` interceptor and the Node `http`/`https`
interceptor. Bridge streaming is disabled (`bridge: false`) so this isolates
capture cost, not WebSocket I/O to a bridge hub. Median of 3 reps, 2000
requests each (after a 200-request warmup). Run: `bun bench/run.mjs` · gate:
`bun bench/run.mjs --check`.

| Scenario                            | p50     | p99     | p99 added |
| ----------------------------------- | ------- | ------- | --------- |
| Baseline (fetch, no capture)        | 30.8 µs | 51.0 µs | —         |
| hakka-node (fetch path)             | 34.4 µs | 60.1 µs | +9.0 µs   |
| Baseline (http.request, no capture) | 41.2 µs | 72.7 µs | —         |
| hakka-node (http.request path)      | 43.3 µs | 72.7 µs | +-0.0 µs  |

## Budgets (retuned 2026-07-11: max observed over 15 fresh runs × 1.3, rounded up)

- fetch path: p99 added ≤ 100 µs
- http path: p99 added ≤ 200 µs

This p99-added metric is a difference of two independently sampled percentiles over
only 2000 requests, so it is noisier than it looks — 15 fresh runs on a dev machine
under light concurrent load ranged from -134 µs to +153 µs (http) and -34 µs to +72 µs
(fetch), including negative "added" readings. Re-sample 10+ runs (not 3) before
tightening further; a 3-run sample understated the true tail by ~2× in that sampling.

Numbers vary by machine; regenerate locally with `bun bench/run.mjs`.
