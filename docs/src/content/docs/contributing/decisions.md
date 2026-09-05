---
title: Architecture Decisions
description: Key pre-1.0 decisions on platform support floors, OTel pinning, diagnostics scope, and docs stack.
---

This page records smaller, narrower decisions made during the Hakka pre-1.0
pass — SDK floors, version pins, docs stack. For the larger architectural bets
(trace correlation, production capture, embeddable components, remote
sessions), see the [Architecture Decision Records](/contributing/adr/).

## Android SDK Levels

- Core Android modules compile and target SDK 35.
- The React Native example app compiles and targets SDK 36.
- **Decision:** Keep core Android modules at compile/target SDK 35 for the pre-1.0 base SDK.
- **Trigger to revisit:** Move core modules to SDK 36 only when a public core dependency, Play policy, or Android Gradle Plugin requirement makes SDK 36 the lower-friction consumer baseline.

## React Native Support Floor

- The package peer range is `react-native >=0.78.0`; both local runtime validation apps run React Native 0.86.3, the exact version required by Expo 57. React Native 0.87 is deferred because its generated `StyleSheet` types require a broader UI style-typing migration.
- The package prefers the New Architecture TurboModule path, but the TypeScript surface and optional JS fallback do not require a newer RN version.
- **Decision:** Keep `react-native >=0.78.0` until a compatibility matrix proves a higher minimum or a required codegen/API dependency forces the change.
- **Trigger to revisit:** Raise the peer floor only with explicit validation for the new minimum, the latest stable RN, and both Android/iOS example smoke checks.

## OTel Semantic Convention Pin

- TypeScript, Kotlin, and Swift constants all pin OpenTelemetry semantic conventions to `1.40.0`.
- **Decision:** Keep `1.40.0` as the fixture-pinned semconv version for the current export JSON.
- Future semconv updates require fixture migrations across TypeScript, Kotlin, and Swift in the same change.

## Perfetto and ATrace

- V1 collectors emit lightweight Hakka frame, memory, CPU, network-usage, health, breadcrumb, and trace records without platform trace marker APIs.
- **Decision:** Keep V1 collectors marker-free.
- When optional advanced Android diagnostics are added, use nested ATrace sections with stable names: `hakka.capture`, `hakka.process`, `hakka.store`, `hakka.sink`, `hakka.export`, and `hakka.ui`.
- **Trigger to implement:** Add markers only behind an opt-in diagnostics flag after measuring overhead in a release-like Android build.

## React Native Monitor UI Default

- React Native UI is imported only from `hakka-react-native/ui`; the core `hakka-react-native` import stays UI-free.
- `hakka-ui` is 149 KB APK; the base SDK (`hakka-network + hakka-performance`) is 76 KB APK over the OkHttp baseline.
- **Decision:** Recommend the React Native JS Monitor UI as the default RN surface. Keep Android native `hakka-ui` optional for native Android apps that explicitly want a platform inspector.
- **Trigger to revisit:** Change only if longer runtime sessions show JS UI lag that the native UI avoids, or if the JS peer graph becomes materially heavier than the measured native UI artifact.

## V1 Runtime Collectors

- Collectors are optional through `hakka-performance` / `HakkaPerformance` and not forced into the base network flow.
- **Decision:** V1 remains lightweight and opt-in, with collector sampling clamped to a minimum interval of `>= 1000ms`.
- V1 does not persist per-frame or per-event data to disk; it produces bounded summaries and health reports.
- V1 metric scope: frame p95/p99, jank ratio, frozen frame ratio; memory heap and optional native-memory fields; CPU window statistics; JS event-loop lag; network usage; health summaries.

## V2 Diagnostics Path

- **Decision:** Flashlight is an external benchmark lane, not a runtime dependency.
- Perfetto and ATrace remain explicitly opt-in deep diagnostics in V2 only, behind diagnostic flags and explicit overhead validation.

## Expo SDK 56 / Swift-JSI Direction

Expo SDK 56 introduced a more direct Apple native-module path built around Swift/C++ interop and a Swift wrapper over React Native JSI.

- **Decision:** Do not add Expo Modules, ExpoModulesJSI, or Swift/C++ interop for the pre-1.0 release.
- **Decision:** Keep the standalone React Native package on the conservative TurboModule/codegen path with thin Android and Swift adapters over the native SDKs.
- **Rationale:** Hakka's high-cost work is native capture, post-processing, bounded storage, export mapping, and UI rendering. The React Native bridge mostly moves control commands, snapshots, health reports, and optional UI data — not high-frequency synchronous values or zero-copy buffers.
- **Trigger to revisit:** Re-evaluate only if profiling shows bridge overhead dominates in a release-like app, or if Hakka needs high-frequency sync calls, host objects, array-buffer/typed-array access, or a prebuilt JSI wrapper without experimental Swift/C++ interop leaking into consumer module graphs.

## Docs Stack

- **Decision:** Use Astro Starlight for Hakka's public docs website.
- **Decision:** Add `starlight-llms-txt` for agent- and LLM-readable docs entrypoints, including focused React Native and native SDK subsets.
- **Decision:** Use raw Markdown content for generated LLM docs so headings, code blocks, and install snippets stay structurally readable.
- **Rationale:** Starlight keeps the docs source as Markdown, provides sidebar navigation and search-ready static pages, matches the existing Astro family, and does not add runtime dependencies to the SDK packages.
- **Trigger to revisit:** Move to a heavier custom site only if Hakka needs interactive examples, generated API reference pages, or product marketing pages that outgrow a docs-first static site.

## Expo Config Plugin

- The React Native Android bridge compiles against Hakka Android artifacts as `compileOnly`, so Expo and bare React Native apps must provide app-level debug/release artifacts for native Android capture.
- **Decision:** Ship `hakka-react-native/app.plugin.js` as an Expo config plugin that adds `hakka-network` for debug builds and `hakka-network-noop` for release builds during Expo prebuild.
- **Decision:** Keep Android performance collectors opt-in through the `androidPerformance` plugin option.
- **Decision:** Keep `expo` as an optional peer dependency. Bare React Native users should not need to install Expo.
- **Decision:** Keep `@react-native-clipboard/clipboard` as a required peer for this release because share/copy helpers are still exported from the core package surface.
- **Reversed (2026-08-17, pre-publish):** clipboard is now an **optional** peer, resolved at runtime behind a guarded require (falling back to `expo-clipboard`, else copy reports failure) — the same optional-peer pattern every other native module already uses. With it, the SDK has zero required native dependencies beyond React Native. Install commands still recommend it, since copy actions are core to the product.
- **Trigger to revisit:** Replace Gradle-file insertion with a more structured native dependency mechanism if Expo exposes one for Maven artifacts, or if Hakka's Android artifact graph changes.

## Full-Stack (Server + Client) Request Inspection for Next.js

- **Context:** `hakka-browser` captures browser `fetch`/`XHR`/`WebSocket`. A Next.js app also makes outbound HTTP from the **server** (Server Components, Route Handlers, Server Actions, middleware). Developers want both sides in one inspector, the way a proxy (mitmproxy) would show everything — but without a proxy's cost.
- **Decision: instrument in-process; do not build a proxy.** Patch `globalThis.fetch` and Node `http`/`https` inside the Next server runtime rather than routing traffic through an external MITM proxy.
  - **Rationale:** no CA cert / `NODE_EXTRA_CA_CERTS` / TLS re-decryption, no extra network hop, and the interceptor sees decrypted application-level data natively. It also captures _origin context_ (which route/component/action made the call) that a wire-level proxy cannot know. The capture engine (`hakka-core`) is already runtime-agnostic — `enableFetchInterceptor` patches `globalThis.fetch`, which exists in Node 18+ (undici) — so the browser interceptor runs server-side unchanged.
- **Decision: integrate via Next's `instrumentation.ts` `register()` hook**, the same server-boot seam OpenTelemetry/Sentry use. A `hakka-next` package exposes `startServerCapture()` for that hook; the client overlay is unchanged.
- **Decision: reuse the existing bridge hub as the unifying transport.** Server captures stream into the `packages/hakka-bridge` WebSocket hub (`{ type: 'request', payload: NetworkRequest }`); the browser overlay subscribes to the same hub, so server and client requests land in one store and one UI. (Dev alternative: a Next route handler SSE endpoint.)
- **Decision: tag every record with `runtime: 'client' | 'server' | 'edge'`** (new optional `NetworkRequest` field). The overlay filters/groups on it. Existing `source`/`library` are unchanged.
- **Decision: run the server store in a Node `worker_thread`** via the same `mode: 'store'` engine the browser Worker uses — the server mirror of the off-thread store, keeping the dev server's main thread clean.
- **Scope:** HTTP(S) outbound only. `fetch` covers most Next outbound; an added core `http`/`https` interceptor covers `axios` (node adapter), `got`, `node-fetch`, and SDKs built on `http.request`. **Non-HTTP** (Postgres/Prisma over TCP) is out of scope — neither in-process patching nor a proxy sees those as requests; driver-level hooks are a separate, later concern.
- **Caveats:**
  - **Edge runtime** (middleware, edge route handlers) is Web-APIs-only: patch `fetch`, but there is no Node `http` module. `instrumentation.ts` runs per-runtime; handle and tag `edge` separately.
  - **Next wraps `fetch`** for its cache. Install Hakka's patch _after_ Next's wrapper (inside `register()`), or capture would observe the cache layer rather than the wire call.
  - **Dev-time tool.** In `next dev` the Node server is long-lived and local, so the WebSocket/SSE stream to the browser works. Serverless/edge **prod** has no long-lived socket — the prod path is OTel export (already in `hakka-core`), not the live overlay.
- **Differentiator:** because capture is in-process with origin context, a future version can correlate `client request → server route → that route's downstream calls` as one trace (via `traceparent` propagation), which a wire proxy cannot. Hakka already exports OTel, so the trace model is in place.
- **Version split:**
  - **v1:** core `http`/`https` interceptor + `runtime` tag; `hakka-next` `startServerCapture()` streaming to the bridge hub; overlay runtime filter; a Next example app proving server + client in one UI.
  - **v1.1:** SSE endpoint helper (no separate bridge process), `worker_thread` store on the server, edge-runtime capture.
  - **v2:** client↔server request correlation / trace waterfall via header propagation.
- **Trigger to revisit:** revisit the proxy stance only if a use case needs traffic from processes Hakka cannot instrument (non-JS sidecars, third-party binaries) — there a local proxy lane could complement, not replace, in-process capture.

## Dropping `@frozen` from Wire Enums

- **Context:** `RecordKind` and the other wire-shape enums in `ios/Sources/Common/Contract.swift` / `NetworkRequest.swift` (mirrored in the generated `packages/hakka-react-native/ios/Core` copy) were marked `@frozen`. Swift's library evolution mode compiles a `@frozen` enum's exhaustive `switch` statements assuming no future case can ever be added — an assumption ADR 0011's additive-wire-evolution rule (new frame/record kinds ship as additive, unknown-tolerant) directly contradicts.
- **Decision:** Remove `@frozen` from every wire enum in `Contract.swift` and `NetworkRequest.swift`. Consumers keep exhaustive switches with a `@unknown default` case rather than relying on the compiler to guarantee there is nothing left to handle.
- **Rationale:** a case added under `@frozen` doesn't fail to compile — it silently traps at runtime for any client on a stale incremental build that still assumes the old case set, which is a worse failure mode than a compiler error. This was found the hard way while adding a wire case and is exactly the trap ADR 0011's "unknown kinds are dropped, not thrown" rule exists to avoid at the protocol level; the enum's own attribute was undermining that rule.
- **Trigger to revisit:** re-add `@frozen` only if a wire enum is deliberately closed for good (no more cases, ever) and that guarantee is worth losing forward compatibility with older binaries.

## Desktop macOS Floor: 14 → 15

- **Context:** `apps/hakka` shipped on a macOS 14.0 floor (ADR 0008). Adding gRPC unary send (ADR 0012) pulled in `grpc-swift-2`, whose `GRPCCore` depends on the `Synchronization` module's `Mutex`, which requires macOS 15+.
- **Decision:** Bump `apps/hakka/Package.swift`'s `platforms` from `.macOS(.v14)` to `.macOS(.v15)`.
- **Rationale:** the app is unreleased and unsigned, so there is no installed base on macOS 14 to protect, and vendoring or avoiding `grpc-swift-2` just to hold a floor nobody depends on yet was not worth it. See [ADR 0012](/contributing/adr/0012-grpc-sending/) for the full gRPC-sending decision.
- **Trigger to revisit:** only relevant again if a future macOS floor decision has to weigh a real installed base against a new hard dependency — this one didn't.

## `test-web` / `verify` Pre-Build Hakka-Node and Hakka-Browser Dist

- **Context:** `hakka-node`'s and `hakka-browser`'s test suites import each other's built `dist` output (and `hakka-core`'s, and `hakka-bridge`'s), not source. Running their tests without building first fails or silently tests stale dist.
- **Decision:** `justfile`'s `test-web` recipe depends on `build-core build-bridge build-node build-browser` before running the four packages' test suites. `scripts/verify.sh` uses a separate `test-web-prebuilt` recipe (same test commands, no build deps) and pre-builds `hakka-core`/`hakka-bridge` once, sequentially, itself: rebuilding inside `verify`'s parallel phase was wiping `dist` mid-typecheck for a sibling leg.
- **Rationale:** a shared build step run once beats every parallel leg racing to rebuild the same dependency's `dist` out from under each other.
- **Trigger to revisit:** if the web/node packages move to testing against source directly (no dist import), the prebuild step and the `test-web`/`test-web-prebuilt` split both become unnecessary.
