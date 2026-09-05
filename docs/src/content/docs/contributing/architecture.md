---
title: Architecture Reference
description: Deep architecture reference — module structure, data flow internals, and contributor invariants.
---

Hakka is a cross-platform diagnostics SDK built around native capture engines.
React Native is a consumer of those engines, not the owner of the canonical model.

## Product Shape

Hakka has four layers:

1. Capture adapters collect raw facts from platform networking APIs.
2. Capture processors redact, normalize, bound, and map facts into records.
3. Stores and sinks retain records locally and expose snapshots to UI, export, desktop streaming, or user-provided transports.
4. Optional UI surfaces inspect records in the app or in Hakka for macOS (`apps/hakka`).

The base SDK is local-first. It does not upload data by default and does not depend on cloud observability SDKs.

## Repository Layout

```text
hakka/
  android/
    hakka-common/               shared records, config, storage, sinks
    hakka-network/              OkHttp capture, record mapping, storage, export
    hakka-network-noop/         same API, no behavior
    hakka-performance/          optional frame, memory, CPU, network collectors
    hakka-performance-noop/     same API, no behavior
    hakka-ui/                   optional Android inspector
    example/                    native Android harness

  ios/
    Sources/Common/             shared records, config, storage, sinks
    Sources/Network/            URLProtocol capture, record mapping, storage, export
    Sources/NetworkNoop/        same API, no behavior
    Sources/Performance/        optional frame, memory, CPU collectors
    Sources/PerformanceNoop/    same API, no behavior
    Sources/UI/                 optional SwiftUI inspector
    Tests/HakkaTests/           Swift tests

  packages/
    hakka-core/              hakka-core — platform-neutral capture engine (one dep: fflate)
                             + /test — capture-assertion helpers
    hakka-react-native/      hakka-react-native — RN SDK + native-only bridge + native UI + monitors
    hakka-browser/           hakka-browser — browser overlay (Solid, Shadow DOM, Web Worker)
                             + /elements/*, /react — standalone elements + React wrappers
    hakka-node/              hakka-node — framework-agnostic Node server capture
                             + /next, /next/server, /next/client — full-stack Next.js capture
    hakka-bridge/            hakka-bridge — desktop WebSocket hub
    hakka-rozenite/          EXPERIMENTAL React Native DevTools panel via Rozenite
    hakka-cli/                   hakka-cli — `npx hakka-cli init` setup
                             + /mcp, `hakka mcp` — MCP server for AI agents
                             + /cdp, `hakka cdp` — Chrome DevTools Protocol capture

  apps/
    hakka/                   Hakka for macOS — native Swift/SwiftUI desktop app
                             (SPM products HakkaDesktopCore, HakkaDesktopServer;
                             see ADR 0008/0010, unreleased); consumes ios/Sources by path

  docs/                      public documentation website
```

Package directory names match their published npm names (ADR 0005). `packages/hakka-bench` is an unpublished internal bench workspace, omitted above.

`hakka-core` holds the canonical engine, record contract, and exporters. The RN,
web, and Next.js packages consume it through injectable adapters so the engine
source lives once with no duplication.

## Canonical Data Flow

```text
Platform network API
  -> capture adapter
  -> capture processor queue
  -> record
  -> bounded store
  -> subscribers, exporters, desktop bridge, optional UI
```

The interceptor path must do the minimum work needed to avoid losing facts.
Serialization, HAR export, bridge emission, expensive redaction, and UI
notifications belong after the hot path.

## Record Contract

The shared contract uses short names inside Hakka packages:

- `RecordKind`
- `NetworkRecord`
- `TraceRecord`
- `HealthReportRecord`

Records are OpenTelemetry-convertible but do not require OpenTelemetry
dependencies. OTel, Sentry, Firebase, or custom analytics integrations should be
optional adapters owned by the application or future add-on packages.

Network records include:

- stable `id`
- `kind`
- method, URL, host, path
- canonical `hakka.source` attribute (`native`, `fetch`, `xhr`, `websocket`)
- optional platform/library metadata for more specific labels such as OkHttp or URLSession
- start/end timestamps and duration
- request/response headers after redaction
- bounded body preview and byte counts
- TLS/protocol metadata when available
- GraphQL operation metadata when available
- error information when capture failed or request failed

## Android Core

Android capture starts in `HakkaInterceptor`. Post-processing runs through
`CaptureProcessor`, matching the iOS processor boundary so OkHttp threads do not
perform redaction, store mutation, export mapping, or subscriber work inline.

```text
OkHttp interceptor
  -> apply cheap host and URL ignore checks
  -> capture immutable raw snapshot
  -> enqueue CaptureProcessor work
  -> return response promptly

CaptureProcessor
  -> redact headers and body previews
  -> map to NetworkRecord
  -> add to LogStore
  -> enqueue sink delivery on a bounded background-safe boundary
```

Android size policy is strict: Hakka artifacts included in the base app must add
less than 180 KB to the final minified APK after R8/ProGuard. New collectors and
UI code need measured size deltas before becoming defaults.

## iOS Core

iOS capture uses URLProtocol and a `CaptureProcessor` for serial post-processing.
URLProtocol callbacks should capture facts and return control; normalization and
store mutation stay off callback paths.

Swift core should remain Foundation-first. SwiftUI belongs in `Sources/UI`, not
in `Sources/Core`.

## React Native Package

`hakka-react-native` provides:

- TypeScript API surface
- TurboModule bridge to native SDKs
- native inspector presentation through the TurboModule bridge
- optional monitors for React Query and storage

The RN package must not define the canonical storage model, privacy model, or
native capture behavior. It wraps native capture capabilities and adds JavaScript monitors and explicit
WebView instrumentation. It does not install JavaScript fallback interceptors.

## Local Desktop Bridge

Hakka streams records to a local hub over a WebSocket transport on port 8989,
using the same shared record schema — not a separate event schema. The hub is the
[`hakka-bridge`](/bridge/overview/) package; it relays each frame to every other
connected peer (web overlay, Next.js server capture, RN, and read-only consumers
like the [MCP server](/mcp/overview/)) and keeps a replay buffer for late viewers.

Desktop streaming is **optional and off by default** in the mobile SDKs, but
`hakka-node/next` embeds the hub in the dev server automatically (`embedBridge: true`)
so server and client traffic land in one overlay with no separate process.

**Addendum 2026-08-22:** Hakka for macOS (`apps/hakka`, see
[ADR 0008](/contributing/adr/0008-desktop-plugin-products/)) ships a second
hub implementation, `HakkaDesktopServer`, a Swift actor speaking the same
wire protocol over `NWListener` with Bonjour discovery: a drop-in
replacement for the Node hub for desktop users. The wire protocol also grew
`console` and `storage` frame kinds alongside `request`/`span`/`control`
([ADR 0011](/contributing/adr/0011-additive-wire-evolution/)); unknown frame
kinds are dropped, not thrown, so older peers keep working unmodified.

## UI Policy

Core SDK modules are UI-less. UI surfaces are optional consumers of snapshots.

Do not add Nitro, Compose, Material, or large UI dependencies to core Hakka to
share UI code. UI dependencies must stay behind optional JS imports or native
UI artifacts and remain measured against size budgets.

## Invariants

- No unbounded buffers.
- No per-request disk writes by default.
- No cloud upload by default.
- No sensitive headers in stores, UI, exports, or desktop payloads.
- No dependency-heavy observability SDKs in base core.
- No work on network threads that can be safely moved to a processor queue.
