---
title: 'ADR 0006 — CaptureSource, the first contract off ADR 0009'
description: CaptureSource identity, lifecycle, emission, correlation, and teardown across eight capture mechanisms.
---

Status: Implemented · Date: 2026-08-15 · Implements [ADR 0009](/contributing/adr/0009-contracts-first-internals/)

The contract was frozen on 2026-08-17 after eight implementations passed the
conformance harness. Additions must be optional and consumers must fail open.
The source contract and its member documentation live in
`packages/hakka-core/src/contract/captureSource.ts`.

## Context

Capture mechanisms share lifecycle and teardown requirements but emit through
different hosts. Requests enter through `ingest`; framework spans use an optional
`emitSpan` callback because the core engine has no span store. Resource Timing
also needs record lookup and partial updates.

The browser Worker relay reuses fetch, XHR, and WebSocket interceptors in another
realm. It does not need a separate source contract.

## Decision

Sources receive plain host callbacks once at startup. The contract covers
identity, correlation, start, and stop; it adds no per-record registry dispatch.

```ts
export interface CaptureSourceIdentity {
  readonly id: string
  readonly runtime: RequestRuntime
  readonly transport: string
}

export type CaptureCorrelation = 'none' | 'originates' | 'inherits' | 'adopts-foreign'

export interface CaptureSourceContext {
  ingest(request: NetworkRequest): void
  emitSpan?(span: FrameworkSpan): void
  update?(partial: Partial<NetworkRequest> & { id: string }): boolean
  getLogs?(): readonly NetworkRequest[]
}

export interface CaptureSource extends CaptureSourceIdentity {
  readonly correlation: CaptureCorrelation
  start(ctx: CaptureSourceContext): void | Promise<void>
  stop(): void | Promise<void>
}
```

### Why this shape

- `id` is namespaced; `runtime` reuses `RequestRuntime`. `transport` describes
  the source and is never written onto `NetworkRequest.source`.
- `ingest` uses the existing request listener signature and store path.
  Repeated emissions with one ID update the same logical record.
- `emitSpan` is optional. If absent, a source drops spans without throwing or
  buffering them. Console has a separate record-shape limitation described below.
- `update` returns false for an evicted or missing record. `getLogs` supplies a
  snapshot ordered oldest to newest, read at most once per external signal.
- Correlation declares whether a source originates, inherits, adopts, or does
  not participate in trace identity.

Start and stop are idempotent. Restart must rearm the source. Capture errors
must leave the observed operation intact; lifecycle failures must leave the
source stoppable and restartable. Stop restores globals, removes listeners and
timers, and prevents delivery from pending work. `createCycleGuard()` permanently
retires each lifecycle cycle so restarting cannot revive old emissions.

### Mapping today's nine mechanisms onto the contract

| Mechanism             | Package         | Emission                                     |
| --------------------- | --------------- | -------------------------------------------- |
| Fetch, XHR, WebSocket | `hakka-core`    | Requests                                     |
| Console               | `hakka-core`    | Console callback; no network-shaped emission |
| Resource Timing       | `hakka-browser` | Updates existing requests                    |
| Browser Worker relay  | `hakka-browser` | Reuses the three interceptor sources         |
| Node HTTP/HTTPS       | `hakka-node`    | Requests                                     |
| OTel span bridge      | `hakka-node`    | Framework spans                              |
| CDP                   | `hakka-cli`     | Requests                                     |

Console cannot use a `NetworkRequest` callback for its non-network records.
Resource Timing's snapshot lookup is O(n), while the browser store also has an
indexed matching path. The Worker relay crosses realms through messages rather
than passing callback functions.

### The hot path stays monomorphic (ADR 0009's binding condition)

Capture sources call the host callback captured at start. They do not route
events through a source registry or change the store's ingest path. For source
migrations, compare `bun run --cwd packages/hakka-bench bench:check` before and
after, plus the affected source benchmarks. Existing ceilings remain regression
gates.

### Conformance harness

`checkCaptureSourceConformance` takes a factory and a source-specific event
trigger. It checks stop-before-start, duplicate start, duplicate stop, delivery,
no delivery after stop, and restart. Tests include intentionally broken sources
to verify that the harness detects duplicate wiring and emissions after stop.

## Consequences

All eight source wrappers are exported by their packages. Capture lifecycle
rules have one definition; hosts retain their own storage and span handling.
Non-network record emission and indexed Resource Timing lookup remain separate
concerns. Optional public types are not dead code merely because in-repository
consumers use them structurally.

## Alternatives considered

- A single request/span union callback would require hosts to discriminate on
  every emission. Separate callbacks preserve the existing call sites.
- An `emits` metadata field has no registry consumer yet.
- Widening `NetworkRequest.source` would mix source metadata with stored record
  fields and change an existing public type.

The original contract landed with tests and documentation before source
migrations. Those migrations are complete.
