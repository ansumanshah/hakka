# Changelog

This project follows the spirit of Keep a Changelog. Hakka is pre-1.0, and every
package — npm, Maven, and the Swift Package — moves in lockstep at one version,
so there is a single entry per release rather than one per package.

## Unreleased

### Added

- **Transport-error mocks (`failure`) and match-budget mocks (`skipCount`/`stopAfter`)** —
  parity with Pulse Pro's in-process-only mocking advantages. A mock rule can now simulate a
  specific transport failure (timeout, no connection, TLS failure, …) instead of serving any
  response, and can be scoped to a match budget: skip the first N matches (serve real traffic),
  then apply for the next N, then stop forever. Shipped atomically across every engine —
  `hakka-core`, iOS (`HakkaCommon`/`HakkaNetwork`), Android (`hakka-network`), the RN native
  bridges, and the desktop app's Rules surface.

## 0.1.0 - 2026-08-02

First public release. Ships as seven npm packages, six Android Maven artifacts,
and six Swift Package products, all moving in lockstep at one version:

- **npm**, published in dependency order: `hakka-core`, `hakka-bridge`,
  `hakka-browser`, `hakka-node`, `hakka-react-native`, `hakka-rozenite`, and
  `hakka` (the CLI, which also carries the `hakka mcp` and `hakka cdp`
  subcommands). Capabilities that were briefly their own packages are subpath
  exports — see [ADR 0005](./docs/src/content/docs/contributing/adr/0005-package-consolidation.md).
- **Android** (`com.noodleapps.hakka`): `hakka-common`, `hakka-network`,
  `hakka-network-noop`, `hakka-performance`, `hakka-performance-noop`, and
  `hakka-ui`.
- **iOS** (Swift Package): `HakkaCommon`, `HakkaNetwork`, `HakkaNetworkNoop`,
  `HakkaPerformance`, `HakkaPerformanceNoop`, and `HakkaUI`.

The through-line across all four platforms: local-first network capture with
bounded storage, redaction on by default, HAR / Postman / OpenTelemetry export,
and optional in-app inspection — no cloud, no accounts, no proxy, no CA
certificate. `-noop` artifacts keep it out of release builds entirely.

### Added

- **Mock-rule management on iOS and Android.** `RulesView` (iOS) and the new `MocksPanel` (Android) both ship a Mocks screen alongside Breakpoints and Throttle, so creating and editing mock rules is no longer exclusive to the React Native inspector and the web overlay. The engines already supported block/canned/redirectTo/modify; this exposes them.
- **Native copy-as snippets** — copy-as-`URLSession` on iOS and copy-as-`OkHttp` on Android, alongside the existing cURL. Web gains a **Playwright route-mock** export that turns a captured request into a `page.route()` stub.
- **JSON tree and GraphQL query text on iOS** — the collapsible syntax-coloured tree (`JSONTreeView` / `InlineJSONView`) is now wired into the request detail, and the parsed GraphQL query string is rendered with copy support instead of being discarded after parsing. Both closed real parity gaps against web/RN/Android.
- **MCP server for AI agents** (`hakka mcp`, also importable as `hakka-cli/mcp`) — exposes Hakka's live captured-network store to AI coding agents (Claude Code, etc.) over the Model Context Protocol (stdio, `@modelcontextprotocol/sdk` 1.29.0). It connects to the bridge hub as a read-only peer and serves tools `list_requests` / `get_request` / `search_requests` / `stats` / `clear` plus a `hakka://requests/recent` resource, so an agent can ask "what failed?" / "what did that POST return?" against your app's real traffic. Sensitive headers are redacted at ingest.
- **Native request capture for React Native** (`hakka-react-native`) — native **WebSocket** capture on iOS (`URLSessionWebSocketTask` monitor: message count + close code, opt-in via `captureNativeWebSocket`) and an Android **OkHttp** network interceptor + WebSocket-listener wrapper, runtime-tagged and streamed through the existing bridge alongside JS-side captures. URLSession HTTP was already captured; this fills the native-WebSocket and custom-`OkHttpClient` gaps.
- **Response-phase breakpoints** (`hakka-core` + `hakka-browser`) — breakpoints can now pause on the **response** as well as the request (or `both`). A matching response is **held after the real call returns but before the caller sees it**, so you can edit the status / headers / body and **Resume** (the caller receives your edited `Response`) or **Abort**. Add a phase to any breakpoint rule via the new selector.
- **Request breakpoints (pause-and-edit)** (`hakka-core` + `hakka-browser`) — the killer feature of Charles/Proxyman/Burp, in-process with no proxy or certificate. Add a breakpoint rule (URL pattern + method); a matching request is **held** before it's sent while the overlay (which auto-opens) shows it; you edit the URL / body / headers and **Resume**, or **Abort** it. Driven by a new `breakpointEngine` (also re-exported for scripting).
- **`npx hakka-cli init`** — a CLI that detects your framework (Next.js, Vite, Expo, React Native, or plain web) and wires Hakka up: it creates the Next `instrumentation.ts` + `instrumentation-client.ts`, or prints the exact install command + config snippet. Dependency-free, safe, and idempotent (only creates absent files).
- **Request-initiator stack trace** (`hakka-core` + `hakka-browser`) — the Chrome/RN-DevTools "Initiator": which app code made each call. Opt-in via a Settings toggle (`setStackCapture`), so it's zero-cost by default; shown as an Initiator section in the request detail.
- **Zero-config Next.js setup** (`hakka-node/next`) — `export { register } from 'hakka-node/next'` in `instrumentation.ts` and `import 'hakka-node/next/client'` in `instrumentation-client.ts` (Next 15.3+) is the whole integration. The bridge hub is **embedded in the dev server** (`embedBridge`, default on), so there's no separate `hakka-bridge` process. `startHakkaClient()` covers older Next.
- **`hakka-browser/vite`** — an unplugin-based Vite plugin (with `hakka-browser/webpack` and `hakka-browser/rspack` siblings) that auto-injects the overlay in dev with zero app-code (`plugins: [hakka()]`). No competitor ships a build-tool plugin for a passive inspector.
- **Proxy-class mock actions, without a proxy** (`hakka-core` + `hakka-browser`) — `redirect` (Map Remote: send a matched request to another URL) and `block` (abort an endpoint to test error states), surfaced in the Mock panel. Rules now persist to `localStorage` and import/export as JSON.
- **Postman Collection v2.1 export** — alongside HAR and OpenTelemetry, from the overlay or `exportPostmanString()` in core.
- **Full-stack request inspection for Next.js** — `hakka-node/next` instruments `fetch` + Node `http`/`https` inside the Next server runtime (Server Components, Route Handlers, Server Actions) and streams captures to the bridge hub; the browser overlay (also a bridge peer) renders them tagged `server`/`edge` alongside its own client calls, with a runtime badge and filter. In-process instrumentation via Next's `instrumentation.ts` — no proxy, no CA cert. Adds a `node http`/`https` interceptor, `RequestType: 'http'`, and `NetworkRequest.runtime`; an `examples/next-fullstack` app; and an ADR. Proven end-to-end through the real bridge.
- **Web capture runs in a Web Worker** (`hakka-browser`) — a new `store` engine mode (`hakka-core`) lets the full dedup/retention/ring-buffer/dispatch pipeline run off the capture thread. The main thread keeps only the interceptors and Mock/Throttle request-path decisions; the store, filter/search, HAR/OTel serialization, and the desktop-bridge socket all run in an inline Worker, with a transparent in-process fallback for SSR / no-Worker hosts. A `bench/` harness measures the result: ~7.7 µs/request main-thread overhead, ~5× lighter than vConsole and 6.7× lighter than the same engine without the Worker.
- **Web feature parity + surpass** (`hakka-browser`) — Mock, Throttle, and Stats panels (the first two have no equivalent in any web inspector); GraphQL operation display; a WebSocket frame viewer; per-request copy-as-`fetch()` / copy-as-text / native Share / **Replay**; content-type filtering with persisted filter state; OpenTelemetry export alongside HAR; and windowed request-list virtualization.
- **`hakka-core` perf** — cached header-redaction pattern compilation, an O(size) ring-buffer compaction, a GraphQL parse pre-check, and a `shouldIgnore` fast-path on the capture hot path.
- **Native Console / Storage / Info panels on iOS and Android.** iOS `InspectorView` is now a four-tab host (Network / Logs / Storage / Info): `ConsoleView` polls the `HakkaConsole` ring buffer (500 entries) with level badges, search, copy, and clear; `StorageView` browses `UserDefaults` with per-key delete and clear-all; `InfoView` shows App / Device / Environment sections. Android `HakkaActivity` gains Logs / Storage / Info buttons that launch `ConsoleActivity` (in-process buffer + `logcat` drain with level-filter chips), `StorageActivity` (all `SharedPreferences` files, per-key delete + clear-all), and `InfoActivity` (Device / App / Locale / Screen / Network). A `HakkaConsole` log sink (Swift + Kotlin, bounded to 500 entries) backs both.
- **`hakka-core/test`** — a framework-agnostic surface for asserting on captured traffic: `captureWith` / `findRequest` / `filterRequests`, a fluent `RequestMatcher` builder, and 12 assertion helpers (67 tests).
- **`StorageAdapter`** (`hakka-core`) — a swappable persistence interface; the engine hydrates on `start()` and persists on every ingest, so captured logs can survive reloads.
- **Web `console.table` mirror** (`hakka-browser`) — opt-in `logToConsole` mirrors every completed request to `console.groupCollapsed` + `console.table`, with nested timing and response-header tables.
- **Web → desktop bridge** (`hakka-browser`) — `connect()` opens a WebSocket to `ws://localhost:8989` with exponential-backoff reconnect and buffer replay. Client side only; the desktop-side receiver is not yet in-tree.
- **Web Settings tab** (`hakka-browser`) — toggles for console mirroring, desktop connection, and max-records, persisted to `localStorage` and wired into the panel registry.
- **Plugin render hooks** (`hakka-core`) — `bodyRenderers` and `contextMenuItems` plugin descriptors plus `getBodyRenderers()` / `getContextMenuItems()` aggregation. Declared and aggregated, but not yet consumed by any platform host renderer.
- **MockEngine `rewrite` / map-local** (`hakka-core`) — `MockRule.mode`, `rewriteRequest`, `rewriteResponse`, `redirectTo` (Map Remote), and `bodyProvider`, surfaced as a `rewrite` mode in the Mocks editor. Executes end-to-end in the **fetch** interceptor (transform the outgoing request and the real response, then hand the edited `Response` to the caller); covered by `capture/rewrite.test.ts`. **XHR** supports mock + block but passes `rewrite` through untransformed by design — XHR cannot substitute a response body.
- **`hakka-core`** — the platform-neutral capture engine (interceptors, ring buffer, mock engine, throttle, the record/contract data model, HAR + OpenTelemetry export) extracted into its own zero-dependency package. `hakka-react-native` now consumes it through injectable native adapters; the engine source lives once, with no duplication or drift.
- **`hakka-browser`** — a new browser target: a framework-agnostic, Shadow-DOM `<hakka-inspector>` overlay (Solid) that captures fetch/XHR/WebSocket plus real Resource Timing and `sendBeacon`, with Network/Console/Storage/Info tabs, status-code filtering, timing waterfall, JSON viewer, and HAR export. The heavy UI is lazy-loaded as a separate chunk (eager footprint ~2.4 KB gz) and never disrupts the host page.
- **Plugin/panel system** in `hakka-core` (`Hakka.use()`, `Hakka.getPanels()`) — the shared seam every platform uses to extend the engine and contribute UI panels from one cross-platform panel set.
- **Pause/resume** capture — requests that arrive while paused are buffered and flushed on resume, not dropped (RN + web).
- Web design tokens generated from `design-tokens.json` (navy-dark canonical default), gated by `sync-tokens --check` like the RN/iOS/Android mirrors.
- `SPEC.md` — the cross-platform capability + parity source of truth for RN/iOS/Android/web (and Flutter, v3).
- Astro + Starlight docs site at `docs/` covering install, the core engine, capture modes, RN/Expo, web overlay + Vite plugin, full-stack Next.js, the CLI, desktop bridge, MCP server, test helpers, breakpoints, mocking/throttling, Android, iOS, contributing, and release. Includes `/llms.txt`, `/llms-full.txt`, `/llms-small.txt`, and focused LLM text subsets for agents.
- `justfile` developer recipes (run `just` to list) covering build, test, lint, format, docs, simulator, benchmarks, and release gates — replaces fragmented npm scripts.
- Claude Desktop `.claude/launch.json` configuring `docs` (port 4321) and `serve-sim` (port 3200) preview entries.
- Contributing and reference sections merged into the docs site: architecture, design principles, SDK design, decisions, and benchmark reference.
- Canonical Hakka record contracts across TypeScript, Kotlin, and Swift.
- Shared v1 fixtures for network, trace, and health record wire shapes.
- Android and iOS capture processors for post-processing outside network
  callback paths.
- Shared host filtering and header redaction behavior across JS, Android, and
  iOS.
- Optional Android and iOS performance collector products for lightweight
  frame, memory, CPU, and network health summaries.
- React Native `getHealthReport()` native bridge wiring and native/JS/auto mode
  validation harness.
- Expo development-build documentation plus a stable package config plugin
  entrypoint for prebuild users.
- Public documentation set for architecture, SDK design, open-source boundary,
  package usage, benchmarking, and release validation.
- CI-safe `phase:verify:ci` release gate for artifact-independent validation.
- Native mock-rule mirroring for the React Native bridge so JS mock rules stay
  active when native capture is selected.

### Changed

- **Every directory under `packages/` is now named for the package it publishes.** `packages/core` → `hakka-core`, `web` → `hakka-browser`, `bridge` → `hakka-bridge`, `react-native-hakka` → `hakka-react-native`, `cli` → `hakka`. Five of seven previously disagreed, which forced the release path to carry a bare-directory list _and_ a published-name list side by side — the mismatch that silently broke `pack:npm:dry-run` during the rename to `hakka-browser`. Both lists collapse into one: `pack:npm:dry-run` and the release workflow's version check are now globs over `packages/*/`, and the tarball smoke gate reads the directory instead of parsing the shell one-liner out of `package.json`. Only the publish step keeps an explicit list, because it is ordered by dependency.
- **`hakka-browser` and `hakka-rozenite` no longer publish sourcemaps.** The two were 6.2 MB of the 7 MB of `.map` files across all seven tarballs. Generation is off in their six build configs rather than filtering `.map` out of `files`, so no dangling `sourceMappingURL` comment is left to 404 in a consumer's devtools. `hakka-rozenite` drops from 634 kB to 192 kB packed (2.5 MB to 630 kB unpacked). `hakka-core`, `hakka-node`, and `hakka` (CLI) keep theirs — they are small, and the engine is where user-facing bugs surface.
- **Changesets is configured for versions only, not changelogs.** `.changeset/config.json` sets `"changelog": false`, so `bun run version-packages` bumps the seven-package fixed group and rewrites their internal pins without scattering seven generated `CHANGELOG.md` files — this file stays the single hand-written one. The private `react-native-example` app joins `@hakka/docs` on the `ignore` list; it was being version-bumped on every release for no reason. `CONTRIBUTING.md` had claimed changesets was "deliberately not used", which contradicted the config, the `version-packages` script, and the release workflow's own error message.
- **Thirteen npm packages consolidated to seven** ([ADR 0005](./docs/src/content/docs/contributing/adr/0005-package-consolidation.md)). `hakka-components` and `hakka-react` became `hakka-browser/elements/*` and `hakka-browser/react`; `hakka-mcp` and `hakka-cdp` became the `hakka mcp` / `hakka cdp` subcommands plus `hakka-cli/mcp` and `hakka-cli/cdp`; `hakka-test` became `hakka-core/test`; `hakka-next` became `hakka-node/next` (its only hard dependency was already `hakka-node`, and `hakka-browser` was an optional peer, so the merge adds nothing for existing consumers). MCP client configs change from `npx -y hakka-mcp` to `npx -y hakka-cli mcp`. The dividing line is runtime, not topic — the survivors are the ones that can never share a dependency set. `hakka-bridge` and `hakka-rozenite` stay standalone: the first is the hub both the Node package and the CLI connect to, and the second carries its own `rozenite build` toolchain.
- **`hakka-browser` is now `hakka-browser`, and `react-native-hakka` is now `hakka-react-native`.** The React Native package was the one name that broke the `hakka-*` pattern, having taken the RN ecosystem's own prefix convention; `browser` is the more precise term for what the package is, matching `@sentry/browser`. The IIFE bundle is renamed to match (`dist/hakka-browser.global.js`), so `<script src>` and unpkg/jsdelivr URLs change with it. A `@hakka/*` scope was evaluated and rejected — the namespace was unavailable, and a scoped name's `/` breaks every regex literal that lists module names.
- **One bubble interaction model on all four platforms.** **Tap** expands the bubble in place, **long-press** opens the full sheet/drawer, **drag** repositions it — previously tap opened the inspector outright and the platforms disagreed. Gesture arbitration is per-platform but tuned to match: `tap.require(toFail:)` + `pan.require(toFail:)` at 0.45 s / 10 pt (iOS), `Gesture.Exclusive` at 450 ms / 10 pt (RN), a `pointermove`-cancelled 450 ms timer (web), and `GestureDetector` + `ViewConfiguration.scaledTouchSlop` on Android, which deliberately keeps platform defaults so it feels native.
- **The web inspector opens partial on mobile.** Narrow viewports now open at 60 dvh (`--hakka-panel-height-mobile`) with a grip to escalate to full height, instead of going straight to full-screen. Matches the 60% detent already used by iOS (`hakkaMedium`) and Android, and the partial-by-default rule the other platforms already followed.
- **`bubble.renderMode` values renamed `'react' | 'native'` → `'js' | 'native'`**, so the RN inspector uses the same vocabulary as `Hakka.start`'s capture `mode`. Public API change for anyone setting `renderMode: 'react'`.
- **Detail-tab names unified across platforms** — iOS's "Timeline" tab is now "Timing", and web's WebSocket "Messages" tab is now "Frames", matching RN and Android. On iOS this also renamed the `DetailTab.timeline` case, because that enum's raw value _is_ the rendered label; web kept its internal `id: 'messages'`, which is never displayed.
- **Android ships a single inspector UI.** `HakkaBottomSheet` now hosts the same `NavTab`-keyed `TabController` map as `HakkaActivity` instead of maintaining a second, thinner row/list implementation, so the sheet and the full-screen activity can no longer drift apart.
- `BubbleWindow.swift` (iOS) split from 951 lines into five files — core state plus `Display` / `Construction` / `Runtime` / `Gestures` extensions — to fit the repo's ~200-line Swift convention. All stored properties stay in the primary file, since Swift extensions cannot hold them.
- The web "Console" tab is now labelled "Logs", matching the iOS and Android panel labels.
- **RN native-mode pause/resume** now forwards through the `HakkaMonitor` TurboModule. `pause`/`resume` were added to the codegen spec (`NativeHakkaMonitor`) and `rnCaptureAdapter`, with native implementations calling `HakkaInterceptor.pause()` (iOS) and `HakkaInterceptor.pause()` → `LogStore.pause()` (Android). `Hakka.pause()` / `resume()` now stop the native capture engine, not just the JS ring buffer (closes the last `SPEC.md` §5 footnote ² gap).
- `docs/package.json` package name updated from `@hakka/docs-site` to `@hakka/docs` following the directory rename.
- All `docs-site/` path references across the codebase updated to `docs/`.
- Root `README.md` doc section links now point to the live docs site at `hakka.noodleapps.com` instead of local file paths.
- Release checklist updated: stale `bun run build:android:fast` replaced with `just build-android`, `bun run version:audit` replaced with `just version-audit`.
- `android/README.md` studio-core script updated to `just studio-core`.
- `ios/README.md` docs path references updated to `docs/`.
- `package.json` trimmed from 50+ scripts to 17 CI-essential ones; all developer workflows moved to `justfile`.
- Private agent notes moved from committed `docs/` to gitignored `.claude/memory/`.
- Documentation now uses Hakka naming consistently.
- The active architecture direction is native-first: Android and iOS SDKs own
  capture, redaction, storage, and export behavior; React Native wraps them.
- The bare React Native app is the release harness. The old Expo example path is
  not part of the current public plan.
- Optional UI surfaces remain separate from the core imports and artifacts.
- Optional storage and React Query monitor hooks now expose typed integration
  shapes for consumer-provided instances.
- The React Native bridge compiles against React Native `0.85.3`'s compatible
  OkHttp line while standalone Android SDK validation continues on OkHttp
  `4.12.0`.
- npm release automation now checks every documented Android Maven artifact
  before publishing the React Native package.

### Fixed

- **The initiator stack filter matched package names as bare substrings.** `hakka-core|hakka-browser|hakka-node` were unanchored, so _every_ frame whose path merely contained one of those strings was stripped as a Hakka internal — a consumer working in, say, `~/src/hakka-core-demo` got `initiator: undefined` instead of their call site. They are now anchored to `node_modules/`, which is what they were for: catching the installed, bundled build where the interceptor function names are minified away. In-repo and unbundled frames were already covered by the file-path and function-name alternatives. Surfaced by renaming `packages/core` to `packages/hakka-core`, which made this repo's own sources hit the same trap.
- **The Android size gate measured against an unfair baseline, and the published size number was wrong.** The gate app's `baseline` flavor built an `OkHttpClient` but never called it, so R8 could shrink OkHttp's own network layer (Dispatcher, connection/protocol codecs) out of the control while every Hakka flavor kept it reachable through `HakkaInterceptor` — charging Hakka's delta for OkHttp's code. A shared `NetworkExerciser` now issues a real `newCall(...).execute()` from all seven flavors. The corrected base-SDK delta is **148.9 KB** (was reported as 201.8 KB against the unfair control), and the independent `android/benchmark` harness agrees within noise at 149,300 bytes. The budget moves from 100 KB to **180 KB** — `hakka-network` genuinely grew with WebSocket capture, mock/bridge discovery, control commands, and OTel export since the budget was set. `docs/.../reference/benchmarks.md` had published a stale `+78,828 bytes`; it and every other restatement of the 100 KB figure are corrected.
- **The RN timing waterfall rendered nothing.** `Timing.tsx` read `dnsLookup` / `tcpConnection` / `tlsHandshake` / `firstByte` / `contentDownload`, but the engine emits `dnsMs` / `connectMs` / `tlsMs` / `ttfbMs` / `downloadMs`. Every phase was `undefined`, so the whole waterfall silently collapsed to empty rather than degrading visibly.
- **R8 broke for consumers without Timber or OkHttp on the classpath.** `android/hakka-ui/proguard-rules.pro` shipped no `-dontwarn` entries for `timber.log.**`, `okhttp3.**`, or `okio.**`, so minified consumer builds failed on missing references. This affected real integrators, not just the in-repo size gate.
- **iOS `NotificationTrigger` silently did nothing for most hosts.** `isAuthorized` was only ever set inside `requestAuthorization()`, so an app that already held notification permission but never called Hakka's method never posted a notification. It now re-reads live authorization on `didBecomeActive`, matching how the Android manager checks permission at post time. Its diagnostics are also `DEBUG`-only now instead of unconditionally printing into the host app's console.
- **Android RN bridge now compiles.** `HakkaMonitorModule` could not access `HakkaMockEngine` / `HakkaMockRule` / `HakkaMockResponse` (declared `internal`), so `packages/hakka-react-native/android` failed `compileDebugKotlin`. Made the three module-visible. The RN bridge module is not compiled by the standalone Android build or CI — this was caught by building the example app while wiring native pause/resume.
- `HakkaInterceptor` (Android `hakka-network`) now correctly initialises the `CaptureProcessor` coroutine scope and flushes the backpressure queue on interceptor stop — previously the scope was created but never started, causing test hangs under high concurrency.
- `HakkaEventListener` timing events (`dnsStart`, `connectStart`, `requestStart`, `responseStart`) now record against a stable `startNanos` baseline, preventing negative elapsed-time values in the waterfall view.
- `HakkaPerformance` (Android) CPU and frame collectors use `Dispatchers.Default` for background work, removing accidental main-thread reads that blocked the UI thread on slow devices.
- iOS `URLProtocol` callbacks now enqueue-and-return immediately; heavy normalization and redaction happen off the callback thread on the `CaptureProcessor` serial queue.
- iOS `HakkaPerformance` memory sampling uses the correct `MACH_TASK_BASIC_INFO` struct layout and field alignment for ARM64 — the previous version read incorrect bytes on Apple Silicon.
- `HakkaNetworkNoop` and `HakkaPerformanceNoop` (iOS) updated to expose identical public APIs to their active counterparts after the noop-parity contract review.

### Removed

- **Repo-wide dead-code sweep.** Android: `SearchQuery.responseContentType`, `Theme.blendColor`, the superseded `fmtStatusLine`, and `HakkaNotificationManager.updateNotification` (which had no callers and skipped the permission check its sibling performed). iOS: a stale `pendingResponseURLResponse` duplicate, a `closeReason` captured but never surfaced, a noop-target stub, two write-only `HakkaPerformance` properties, and unused test helpers. React Native: an unused `Database` icon and a duplicate `formatSize`. The `hakka-core`/bridge/CLI/MCP/node/cdp packages were swept and found clean.
- `Detail/BodySearchView.swift` (iOS) — a full-screen search modal with no call sites; the live path is the inline `MatchHighlightedBody` in `DetailBodyHelpers`.
- Removed the stale AI analyzer UI/config surface from the public React Native
  package for the first local-first release.
