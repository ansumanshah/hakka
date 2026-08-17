# hakka-core per-module micro-benchmarks

Single-op timing for every hot path in the engine. Budgets are **regression ceilings**
(machine-relative), retuned 2026-07-11 to observed max (10 fresh runs) × 1.3, rounded up —
they catch a real regression, not just a >2× slowdown. Median of 5 reps within each
run. Run: `bun bench/run.mjs` · gate: `bun bench/run.mjs --check` ·
recalibrate after intended changes: `bun bench/run.mjs --calibrate`.

| Module op                     | Measured  | Budget    | Status |
| ----------------------------- | --------- | --------- | ------ |
| RingBuffer.add                | 339 ns    | 700 ns    | ✅     |
| RingBuffer.getAll (2000)      | 12.99 µs  | 30.00 µs  | ✅     |
| RingBuffer.getByUrl           | 40 ns     | 100 ns    | ✅     |
| removeOlderThan (retention)   | 25 ns     | 50 ns     | ✅     |
| parseSearchTokens             | 479 ns    | 1.00 µs   | ✅     |
| compileQuery (build)          | 81 ns     | 200 ns    | ✅     |
| predicate eval (per req)      | 111 ns    | 250 ns    | ✅     |
| sortRequests (2000)           | 62.49 µs  | 100.00 µs | ✅     |
| groupRequests (2000)          | 69.85 µs  | 120.00 µs | ✅     |
| exportHarString (2000)        | 7.15 ms   | 12.00 ms  | ✅     |
| recordsToOtelJson (2000)      | 1.09 ms   | 2.00 ms   | ✅     |
| buildPostmanCollection (2000) | 901.02 µs | 2.00 ms   | ✅     |
| captureBody (string)          | 5 ns      | 20 ns     | ✅     |
| redactHeaders                 | 240 ns    | 600 ns    | ✅     |
| shouldCaptureUrl              | 290 ns    | 500 ns    | ✅     |
| shouldCaptureUrl (wildcard)   | 344 ns    | 700 ns    | ✅     |
| decodeWsFrame (mqtt)          | 310 ns    | 800 ns    | ✅     |
| parseSetCookie                | 924 ns    | 1.60 µs   | ✅     |
| parseRequestCookies           | 568 ns    | 1.00 µs   | ✅     |
| decodeUrl                     | 155 ns    | 300 ns    | ✅     |

Fixture: 2000 synthetic requests with realistic headers/bodies. "(2000)" ops process the whole
fixture per call; the rest are per-item. Numbers vary by machine; regenerate locally.
