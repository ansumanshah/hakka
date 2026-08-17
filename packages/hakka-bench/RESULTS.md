# hakka-browser capture overhead vs competitors

Per-request **main-thread** time added by network capture — the number that affects a host
app's responsiveness. Each tool runs in its own process (fresh `fetch` patch). Median of
3 reps, 40000 requests each, against an instant-resolving stub so we measure
interception, not the network. Run: `bun run --cwd packages/hakka-bench bench`.

| Tool                                      | Per request (µs)          | Capture overhead | Relative   |
| ----------------------------------------- | ------------------------- | ---------------- | ---------- |
| Baseline (no capture)                     | 0.43 µs                   | —                | —          |
| hakka-browser (Worker model)              | 9.61 µs                   | 9.18 µs          | —          |
| hakka-browser (Worker model, ~200KB body) | 138.64 µs                 | 138.21 µs        | —          |
| hakka-browser (in-process, no Worker)     | 3.36 µs                   | 2.94 µs          | 0.3× hakka |
| vConsole                                  | 45.71 µs                  | 45.29 µs         | 4.9× hakka |
| eruda                                     | not measurable headlessly | —                | —          |

## How to read this

- **Worker model** is how hakka-browser ships: the interceptor captures on the main thread and
  posts the record to a Web Worker. The store, dedup, retention, filter/search, HAR/OTel
  serialization, and the desktop-bridge socket all run **off** the main thread. Main-thread
  cost ≈ capture + the structured-clone for `postMessage`.
- **in-process** is the same engine with the Worker disabled (the SSR / no-Worker fallback) —
  it does the full store pipeline on the main thread. Its per-request cost can now come in
  BELOW the Worker row (ring-buffer ingest is cheaper than the structured clone), but that's
  only the ingest half of the story: with the Worker, filtering, search, retention scans, and
  HAR/OTel serialization also leave the main thread — in-process pays for those at
  interaction time instead.
- **vConsole** stores and renders on the main thread by architecture, like every other
  web-overlay inspector. **eruda** could not be instrumented headlessly (it needs a real
  browser to initialize); its network capture is also synchronous main-thread by design.
- **~200KB body** is a near-cap fixture (hakka-core's default `maxBodySize` is 256KB) that
  declares `content-encoding: gzip`, like real large payloads do — which forces the
  cancel-at-cap STREAM read (no decoded-size bound is knowable up front), the bounded-memory
  path that keeps huge bodies from allocating unbounded strings. The small-body row declares
  an identity `Content-Length`, like real small responses do, and takes the native-read fast
  path. Together the two rows price both capture paths honestly.

## Budgets (retuned 2026-07-11: max observed over 3 fresh runs × 1.3, rounded up)

- hakka-browser (Worker model): ≤ 13 µs/req
- hakka-browser (Worker model, ~200KB body): ≤ 185 µs/req

Numbers vary by machine; regenerate locally with `bun run --cwd packages/hakka-bench bench`.
