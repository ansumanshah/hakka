---
title: Performance
description: Runtime collectors, bridge overhead, and benchmark policy.
---

Hakka runs inside your app — a page overlay on the client, an in-process SDK on
the server. That means its performance contract is not "fast for a devtool";
it is **invisible to real users and unmeasurable on the server**.

## The contract

| Surface                          | Budget                                                                                                                                              | Enforced by                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Client main-thread overhead      | ~9.6 µs/request observed, budget ≤ 13 µs/req (store runs in a Web Worker)                                                                           | `packages/hakka-bench` (`--check` gated in CI)          |
| Server added latency             | p99 ≤ 0.1 ms (fetch path), p99 ≤ 0.2 ms (`http`/`https` path)                                                                                       | `packages/hakka-node/bench` (`bench:check` gated in CI) |
| Client retained memory           | count cap (`maxRequests`, 500) **and** byte ceiling (`maxBufferBytes`, 16 MiB) — oldest evict first                                                 | `RingBuffer` byte accounting + tests                    |
| Steady-state heap (filled store) | ~2.7 MB heap delta over an empty store (median-of-3: 2667 KB, ~5.3 KB/record) — `maxRequests: 500`, realistic bodies (~2KB avg, ~1-in-200 at ~50KB) | `scripts/bench-heap.mjs` (report only, not CI-gated)    |
| Capture CPU per response         | bounded by `maxBodySize` (256 KB), never by body size — capped reads cancel the clone stream at the cap                                             | `readCappedBody` + tests                                |
| Eager bundle cost                | size gate: ESM entry / IIFE / worker shim / lazy chunks each budgeted                                                                               | `scripts/web-size-gate.mjs` (CI)                        |

Budgets are deliberately re-baselined in the gate scripts with a comment when
a feature legitimately grows a bundle — CI red is a decision point, never
background noise. See [Benchmarks](/reference/benchmarks/) for measured
Android/iOS size and runtime numbers against baseline and competitor SDKs.

## Mechanisms

**Do the work once.** Glob patterns, header-redaction literals, and trace-id
derivations are compiled/hashed once and cached. The request body is parsed at
most once per request (GraphQL extraction and redaction share the parse).
Bridge frames are stringified once, at enqueue.

**Bound every buffer.** The ring buffer evicts by count _and_ bytes. The
bridge offline queue is capped by count _and_ bytes. Body capture cancels the
clone stream the moment the cap is crossed. WebSocket sends respect
`bufferedAmount` backpressure and drop honestly instead of growing. This is
why a filled store's heap footprint is a flat ~2.7 MB, not a function of how
much traffic the host app generates: the ring buffer's count cap
(`maxRequests`) bounds _how many_ records are retained, and `maxBodySize` /
`maxBufferBytes` bound _how large_ each retained body can be — together they
put a ceiling on steady-state memory that traffic volume alone can't cross.

Age-based retention (`RingBuffer.removeOlderThan`, driven by `maxAge`) evicts
oldest-first with a tail-walk rather than a full-buffer scan: entries insert
roughly chronologically, so it removes entries from the oldest slot until it
hits one that isn't stale yet, then stops. `DEFAULT_CONFIG.maxAge` is set, so
this runs on every ingest and has to stay cheap even when nothing is stale —
the tail-walk is what keeps a no-op pass O(1) instead of O(n).

**Body-capture algorithm** (`readCappedBody`, `hakka-core/src/capture`). An identity-encoded
body no larger than `maxBodySize` bytes reads via the native `.text()` fast path (~0.6 µs/response
vs ~8 µs for the manual stream loop, Bun 1.3) — bounded by construction, since decoding can't
yield more UTF-16 units than input bytes and HTTP framing caps an identity body at its
Content-Length. Every other body streams through a manual reader that appends chunks until the
cap would be crossed, then cancels the reader immediately, so CPU cost stays proportional to
`maxBodySize` rather than to the real body's size. When truncated, the reported size prefers the
server's Content-Length over the partial decode count, but only for an unencoded body: a gzip/br
response's Content-Length is compressed wire bytes, not decoded text, so trusting it there would
report an impossible "truncated at 100, total 40".

**SSE capture algorithm** (`captureSseBody`, `hakka-core/src/capture`). A `text/event-stream`
response is long-lived — an LLM token stream may stay open for the whole reply — so a plain
`clone().text()` would leak a pending read that never resolves. This reads the clone's stream
incrementally, decoding chunks as they arrive and invoking the caller's update callback on a
throttled cadence: at most once every 250ms or every 8KB of newly decoded text, whichever comes
first, plus exactly one terminal `done: true` emit when the stream closes, errors, or the tail
drain ceiling gives up on it. Bounding mirrors the body-capture algorithm's cancel-at-cap
discipline above, but with two deliberate differences. First, an over-cap SSE capture KEEPS the
up-to-cap prefix instead of nulling it out, since a live token stream's partial transcript is
still useful to show. Second, it also keeps a bounded 8KB tail of the stream's FINAL events:
LLM APIs deliver token accounting in their last chunks (usage / `message_delta`), so capture
keeps reading past the cap — retaining only prefix + tail, never the middle — until the stream
ends or a 4MB drain ceiling cancels it, which keeps a never-ending stream bounded in CPU,
memory, and update count.

**Nothing blocks the caller.** `await fetch()` resolves at headers-received
time; body capture reads a synchronous clone in a detached task. The server
`http`/`https` interceptor never taps the response body stream (OTel-style),
and phase timing (DNS/TCP/TLS/TTFB/download) comes from socket lifecycle
events, not wrappers.

**Off the main thread, off the hot path.** The web store runs in a Web Worker;
the overlay UI virtualizes both flat and grouped lists, coalesces ingest
bursts, debounces search, and lazy-loads every occasional-use surface
(panels, waterfall, palette, diff).

**Production is gated before capture, not after.** `shouldCapture` /
`sampleRate` are evaluated _before_ any capture allocation — a non-sampled
request pays one function call. The cohort path (ADR 0002) rides
`runInTraceContext({ traceId, debug })` set by your own middleware, and
`HAKKA_DISABLE=1` is a live kill switch (polled, no redeploy).

## Escape hatches

- `enabled: false` / noop packages — compile-out for prod builds.
- `_noHakka` on a `RequestInit`, or the `x-hakka-ignore` header — per-request bypass.
- `ignoreHosts` / `ignorePatterns` — pattern-level bypass (compiled once).
- `HAKKA_DISABLE=1` — server-side live kill switch.

## Measuring

```sh
bun --cwd packages/hakka-core bench:check    # engine primitives (CI-gated)
bun --cwd packages/hakka-node bench:check  # p50/p99 added server latency (CI-gated)
bun run --cwd packages/hakka-bench bench:check  # main-thread overhead vs vConsole/eruda (CI-gated)
node scripts/web-size-gate.mjs         # bundle budgets (CI-gated)
bun scripts/bench-heap.mjs             # steady-state heap footprint (report only, not CI-gated)
```

## Web e2e render benchmarks (`packages/hakka-browser/e2e`)

Three Playwright specs measure the overlay's real Solid UI in real Chromium,
separate from `packages/hakka-bench/capture-overhead.mjs`'s isolated per-request interception
cost:

- **`render-bench.spec.ts`** — the `createProjection` adoption baseline (Solid
  2.0). Four scenarios: `cold-open-10k` (10k records seeded panel-closed, then
  opened, time to first windowed row), `ingest-paint-latency` (~100 records,
  one ingest at a time, ingest-call to row-appears), `update-propagation` (10k
  records, one status flip at a time — the fine-grained-update path
  `createProjection` should improve most, since today every update runs the
  full upsert/filter/sort/render pipeline for a one-field change), and
  `filter-latency` (10k records, narrow to ~10 via search). Every measurement
  runs inside a single `page.evaluate()` using `performance.now()` +
  `requestAnimationFrame` polling — real in-page DOM timing, not inflated by
  Node↔browser IPC round-trips that would swamp the low-millisecond signal.
  Seeded record fields are pure functions of index (no `Math.random`, so no
  row ever renders different text run to run) except `startTime`, which
  anchors to real `Date.now()` — an arbitrary fixed-epoch timestamp would fall
  outside the store's default 24h retention window and evict on arrival.
  Assertions are loose fixed-multiple ceilings (not scale-10k's self-relative
  convention below — there's no "this run's own numbers" to be relative to for
  a cross-run/cross-branch baseline), sized to catch a 10x+ regression, not to
  hold Solid to a lab-conditions bar.
- **`scale-10k.spec.ts`** — filter-keystroke latency, virtualized-scroll
  functionality, and DOM-node cap (virtualization proof: row-element count
  must stay far below the 10k record count at every scroll offset) all at 10k
  records. Ceilings here ARE self-relative — 2.5x whatever this run itself
  measured, logged alongside — because the 10k-record setup is itself the
  thing under test, so there's no meaningful fixed number to hardcode across
  machines/CI load.
- **`overlay-open-latency.spec.ts`** — 5 reps of closed-launcher-click to
  request-list-interactive, under CDP 4x CPU throttling (a rough
  mid-tier-phone emulation). Unlike scale-10k, this budget is a fixed,
  hardcoded baseline (re-baseline procedure and measured values live in the
  spec file itself) with 2.5x slack for CI's concurrent-load noise — a
  self-relative budget here could never catch a regression, since a slowdown
  would inflate the gate along with the measurement.

All three treat their Solid UI as living inside `<hakka-inspector>`'s open
Shadow DOM — `document.querySelectorAll` doesn't pierce it, so in-page timed
queries go through an explicit `shadowRoot()` helper (Playwright's own
locators, used only for untimed setup/assertions, pierce automatically).

**List virtualization** (`windowedList.ts`'s `windowFlatItems`) windows an
array of variable-height items by pixel offset rather than row count, needed
once grouped items mix fixed-height rows with taller group-header items.
`heights[i]` is `items[i]`'s rendered pixel height; a prefix sum over the
cumulative heights is binary-searched for the window start, keeping that
lookup O(log n) regardless of list length.

## V1 Collectors

V1 collectors are optional through `hakka-performance` and `HakkaPerformance`.
They should remain lightweight and production-safe:

- sample interval clamped to at least `1000ms`
- no per-frame persistence by default
- bounded summaries and health reports
- no Flashlight, Perfetto, or ATrace runtime dependency

## V2 Diagnostics

Deep diagnostics such as trace markers or advanced platform tracing belong in an
explicit V2 diagnostics path behind flags and overhead validation.

## Bridge Overhead

Reducing JS/native boundary hops matters only when boundary cost actually
dominates the workload. Hakka currently prioritizes native capture, processor
queues, bounded stores, and optional UI rendering over direct Swift-JSI
integration.

## Validation Gates

```bash
node scripts/benchmark-verify.mjs
bun run phase:verify:ci
bun run phase:verify:full
```

`phase:verify:full` is the strict physical-device gate. Do not claim full
physical performance completion without physical Android and iOS benchmark
artifacts.
