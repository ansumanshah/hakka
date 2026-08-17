---
title: SDK Design
description: The target API shape, record family, capture processor contract, storage, and testing policy for Hakka across TypeScript, Kotlin, and Swift.
---

This document defines the shape Hakka is converging on across TypeScript,
Kotlin, and Swift. Some items here are the current implementation; others are
the planned target. The current implemented contract starts with network, trace,
and health report records — the full record family and extended `start()` options
are the target shape.

## Design Goals

- Native-first capture with React Native bindings on top.
- One record contract across every platform.
- Small base artifacts with optional UI and optional exporters.
- Safe defaults: local-first, bounded memory, redacted sensitive data.
- Fast hot paths: capture now, process after the network callback returns.
- API names that are obvious to people and AI tools.

## Public API Direction

The high-level API should stay small:

```ts
Hakka.start({
  enabled: true,
  profile: 'development',
  capture: {
    network: true,
    performance: false,
    traces: true,
  },
  privacy: {
    bodies: true,
    maxBodyBytes: 256 * 1024,
    redactHeaders: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'],
  },
  sinks: [(record) => analytics.track('hakka_record', record)],
})

Hakka.show()
Hakka.hide()
Hakka.clear()
Hakka.getSnapshot()
Hakka.getHealthReport()
Hakka.setUserId(userId)
Hakka.setTag('tier', 'internal')
Hakka.addBreadcrumb('checkout_started', { cartItems: 3 })

const trace = Hakka.startTrace('checkout')
trace.setAttribute('screen', 'Checkout')
trace.setMetric('cart_items', 3)
trace.finish()
```

Native Kotlin and Swift APIs should expose the same concepts before the RN
wrapper depends on them.

## Record Family

The canonical record family:

- `NetworkRecord`
- `FrameMetricRecord`
- `MemoryMetricRecord`
- `CpuMetricRecord`
- `NetworkUsageMetricRecord`
- `JsThreadMetricRecord`
- `BreadcrumbRecord`
- `TraceRecord`
- `HealthReportRecord`

Additional records should be added only with shared fixtures and tests across
TypeScript, Kotlin, and Swift.

## Capture Processor Contract

Each platform should have the same processing boundary:

```text
RawCapture
  -> filter
  -> redact
  -> bound bodies
  -> enrich timing/metadata
  -> map to record
  -> store
  -> notify sinks
```

Rules:

- Interceptors do not serialize JSON.
- Interceptors do not notify UI directly.
- Interceptors do not hold locks while reading or writing bodies.
- Processors expose a flush method for deterministic tests.
- Processors are allowed to drop records rejected by filters before expensive processing.

## Privacy Defaults

Default redacted headers:

- `authorization`
- `proxy-authorization`
- `cookie`
- `set-cookie`

Recommended extra production redactions:

- `x-api-key`
- `x-auth-token`
- `x-csrf-token`
- app-specific session headers

Body capture defaults to a 256 KB preview. Large bodies should retain byte
counts and truncation state without storing full payloads.

## Storage

Base storage is an in-memory ring buffer. Persistence is off by default.

Store requirements:

- fixed max record count
- O(1) append
- snapshot reads for UI
- no unbounded maps
- no disk I/O while holding store locks
- stable ordering by capture time

## Sinks

Sinks are user-owned destinations for records. Base Hakka supports callbacks and
later optional adapters but does not force any cloud transport.

Sink delivery must be:

- bounded
- non-blocking for capture paths
- explicit about dropped records
- safe to disable at runtime

Current native surface:

- Android: `RecordSink`, `SinkSubscription`, `addSink`, `flushSinks`, `droppedSinkRecords`
- iOS: `RecordSink`, `SinkSubscription`, `addSink`, `flushSinks`, `droppedSinkRecords`
- TypeScript: `RecordSink` and `SinkSubscription` contract types only; no exporter dependency in the base package

`flushSinks` is timeout-aware and returns whether queued sink work drained in
time. Sink queues are bounded; overflow increments `droppedSinkRecords` instead
of blocking capture.

## Testing Policy

Every shared contract change needs:

- TypeScript unit tests
- Kotlin unit tests
- Swift tests
- golden JSON fixtures when a serialized shape is public

Every capture processor change needs tests for:

- success
- network failure
- cancellation
- redirects where supported
- header redaction
- body truncation
- filter rejection
- processor flush determinism

## Size Policy

Before adding new Android collectors or default UI code, measure final minified
APK delta with and without Hakka. The base Hakka budget is below 180 KB after
R8/ProGuard (see `scripts/android-size-gate.sh` for the current measured delta
and how the budget was derived).

Optional features should be split into optional artifacts or user-owned dynamic
delivery when they cannot meet the base budget.
