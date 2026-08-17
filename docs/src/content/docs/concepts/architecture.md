---
title: Architecture
description: The core Hakka data flow and invariants.
---

Hakka's architecture is native-first. React Native is a consumer of native
capture engines, not the owner of the canonical model.

## Canonical Flow

```text
Platform network API
  -> capture adapter
  -> capture processor queue
  -> record
  -> bounded store
  -> subscribers, exporters, desktop bridge, optional UI
```

Interceptors collect raw facts and return quickly. Processors perform filtering,
redaction, mapping, storage, and notification.

## Record Contract

The shared contract uses:

- `RecordKind`
- `NetworkRecord`
- `TraceRecord`
- `HealthReportRecord`

Records are OpenTelemetry-convertible but do not require OpenTelemetry in the
base SDK.

## Invariants

- no unbounded buffers
- no per-request disk writes by default
- no cloud upload by default
- no sensitive headers in stores, UI, exports, or desktop payloads
- no dependency-heavy observability SDKs in base core
- no work on network threads that can move to a processor queue

## Optional UI

Core SDK modules are UI-less. UI surfaces are optional consumers of snapshots.
Do not add UI dependencies to core Hakka to share UI code.

## Web: store off the main thread

`hakka-browser` splits the store from capture across a thread boundary.
Interceptors (fetch/XHR/WebSocket patches) must stay on the main thread —
that's where those APIs originate — but everything downstream (the
`hakka-core` engine in `mode: 'store'`, dedup, retention, the ring buffer,
filter/search, HAR/OTel/Postman serialization, and the desktop-bridge socket)
runs in an inline Web Worker, so a large body's `JSON.stringify` or a 10k-row
filter recompute never blocks the host page.

Two backends implement the same `storeClient` interface:

- **Worker**: `postMessage` for fire-and-forget events (ingest, updates);
  snapshots and exports are request/response RPCs. The default everywhere a
  `Worker` is available.
- **in-process**: the identical `storeEngine` module driven directly on the
  main thread — same behavior, no thread boundary, no round-trip. Used when
  `Worker` is unavailable (SSR, locked-down hosts) and in unit tests.

`hakka-core` exports a singleton `Hakka`; each thread that imports
`storeEngine` gets its own instance, which is exactly the one-store-per-thread
shape both backends need.

**Why the worker bundle stays `&inline` for both the ESM and IIFE build
targets:** two alternatives were tried and rejected while chasing bundle size.
Dropping `&inline` for ESM only doesn't work — both formats come from one
`rolldown()` call that bundles once, so the specifier resolves identically for
both, and the non-inline IIFE build emitted a host-root-absolute
`new Worker("/assets/store.worker-HASH.js")` path that 404s for any embedder
whose page doesn't serve a file at that exact path, breaking the "drop in via
one `<script>` tag" contract the IIFE bundle exists for. Deferring the
`storeEngine` import behind a dynamic `import()` for the in-process path was
rejected on correctness: `import()` is asynchronous by spec even when cached,
and a unit test asserts a `subscribe()` callback sees an `ingest()` call in
the same synchronous tick under `forceInProcess: true` — deferring the load
would desync that ordering.

**Memory: `slimEcho`.** By default, the store never sends the main thread a
captured request's `requestBody`/`responseBody` in the live `subscribe()`
echo — every other field (headers, timing, sizes, status) still crosses.
Bodies can be up to `maxBodySize` (256 KB default) times up to `maxRequests`
(500) live requests, and the request list only ever reads
`*BodySize` — so that's real host-page memory held for zero payoff. Detail
and the exporters fetch real bytes on demand via `getBody`/`getBodies`
instead. Set `start({ slimEcho: false })` to restore the pre-slim-mirror
shape for code that reads bodies straight off `getLogs()`/a custom
`subscribe()` instead of through the body RPCs.
