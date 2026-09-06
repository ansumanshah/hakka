---
title: Performance
description: Runtime collectors, bridge overhead, and benchmark policy.
---

Hakka limits capture work, storage, and UI cost so inspection does not disrupt the host app.

## The contract

| Surface                     | Limit                                          | Check                       |
| --------------------------- | ---------------------------------------------- | --------------------------- |
| Client main-thread overhead | 13 µs/request                                  | `packages/hakka-bench`      |
| Server added latency        | p99 0.1 ms for fetch; 0.2 ms for HTTP/HTTPS    | `packages/hakka-node/bench` |
| Retained requests           | Default 500 records and 16 MiB                 | `RingBuffer` tests          |
| Body capture                | Default 256 KB preview                         | `readCappedBody` tests      |
| Web bundles                 | Separate eager, IIFE, worker, and lazy budgets | `scripts/web-size-gate.mjs` |

These are benchmark limits, not promises for every device or workload. Gate scripts
hold the current budgets. A budget change requires a measured baseline and an
explanation. [Benchmarks](/reference/benchmarks/) records native size and runtime
results. `scripts/bench-heap.mjs` reports memory use; its recorded 500-request
baseline was about 2.7 MB and is not a CI gate.

## Mechanisms

Compile filters and redaction patterns once. Cache bounded trace-ID derivations,
share request-body parsing between GraphQL extraction and redaction, and
serialize bridge frames once at enqueue.

Stores and offline queues have count and byte caps. WebSocket sends check
`bufferedAmount`; overload drops data rather than growing queues. Age retention
walks from the oldest stored request until it reaches one inside the retention
window. This assumes roughly chronological insertion and makes a no-op pass O(1).

**Body capture.** An identity-encoded response with a trusted Content-Length
within the cap uses `.text()`. Other responses stream up to the cap, then cancel
the clone reader. Compressed Content-Length describes wire bytes and cannot be
used as the decoded body's total size.

**SSE capture.** Stream chunks update the preview at most every 250 ms or 8 KB,
plus one terminal update. Capture retains the capped prefix and an 8 KB tail for
final usage events. A 4 MB drain ceiling bounds long-running streams; the middle
is discarded. It never waits for the entire stream before showing a preview.

**Caller latency.** Fetch returns at headers-received time. Body capture reads a
clone in a detached task. The server HTTP/HTTPS interceptor uses socket events
for phase timing and does not read the response body stream.

**UI work.** The web store runs in a Worker. Lists are virtualized, ingest bursts
are coalesced, search is debounced, and optional panels load lazily. Variable-height
list windows use prefix sums and binary search to find the start in O(log n).

**Production capture.** `shouldCapture` and `sampleRate` run before capture
allocation. Cohort capture uses `runInTraceContext({ traceId, debug })` supplied
by application middleware. The server polls `HAKKA_DISABLE=1` as a live kill switch.

## Escape hatches

- `enabled: false` disables capture; noop packages replace SDK implementations.
- `_noHakka` on `RequestInit` or `x-hakka-ignore` bypasses one request.
- `ignoreHosts` and `ignorePatterns` bypass matching traffic.
- `HAKKA_DISABLE=1` stops server capture without redeployment.

## Measuring

```sh
bun run --cwd packages/hakka-core bench:check
bun run --cwd packages/hakka-node bench:check
bun run --cwd packages/hakka-bench bench:check
node scripts/web-size-gate.mjs
bun scripts/bench-heap.mjs
```

## Web e2e render benchmarks (`packages/hakka-browser/e2e`)

- `render-bench.spec.ts` measures opening, ingest-to-paint, updates, and filtering
  with up to 10,000 records. Timing runs inside the browser to exclude IPC cost.
- `scale-10k.spec.ts` checks filtering, scrolling, and DOM-node bounds at 10,000
  records. Its latency ceilings are relative to that run.
- `overlay-open-latency.spec.ts` measures launcher-to-interactive time over five
  runs under 4× CPU throttling, against a fixed baseline with CI headroom.

Specs query the inspector's open Shadow DOM. Fixtures use deterministic record
content and current timestamps to avoid eviction by the default age limit.

## V1 collectors

`hakka-performance` and `HakkaPerformance` are optional. Sampling intervals are
at least 1,000 ms. Collectors keep bounded summaries and health reports, avoid
per-frame persistence, and add no Flashlight, Perfetto, or ATrace dependency.

## V2 diagnostics

Advanced tracing requires explicit flags and overhead measurements.

## Bridge overhead

Optimize boundary calls when measurements show they dominate. Native capture,
processor queues, bounded stores, and optional UI remain the default design.

## Validation gates

```sh
node scripts/benchmark-verify.mjs
bun run phase:verify:ci
bun run phase:verify:full
```

The full phase gate runs builds and tests. Physical-device performance requires
separate Android and iOS measurements; simulator results do not establish it.
