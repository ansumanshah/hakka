# Hakka SPEC — cross-platform parity ledger

The **16 published spec cards** at [hakka.noodleapps.com/spec](https://hakka.noodleapps.com/spec/)
(source: `docs/src/content/docs/spec/`) are the per-capability source of truth — what each
capability does, its public API, config defaults, wire format, test anchors, and limits. This
file does not compete with them. It holds what no single card owns:

- **§5 Parity matrix** — the cross-platform status ledger every card's own "Platform matrix"
  section is checked against. `scripts/spec-drift-check.mjs` (run in CI) parses §5 and every
  card's table and fails the build on any mismatch — this is a machine-read contract, not prose.
  Edit a status cell here, or in a card, and the other must follow.
- **§2/§3** — the panel set and UX feature checklist, grouped by user-facing category rather
  than by capability, so no one card owns them.
- **§4/§6** — the plugin contract pointer and the release roadmap.

The invariant: React Native (TS), iOS (Swift), Android (Kotlin), and web (TS) share **one**
capability set and **one** wire contract (`RECORD_SCHEMA_VERSION`, OTel semconv). Rendering is
native per platform — no shared UI code crosses the boundary.

> Colors are unified via [`design-tokens.json`](./design-tokens.json) (generated to every
> platform by `scripts/sync-design-tokens.mjs`). The record schema is pinned by
> [`fixtures/hakka-records/`](./fixtures/hakka-records). Both are pinned contracts checked in CI,
> same as §5.

## Spec cards

| Capability                         | Card                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Capture (fetch/XHR/native/console) | [/spec/capture/](https://hakka.noodleapps.com/spec/capture/)                 |
| WebSocket                          | [/spec/websocket/](https://hakka.noodleapps.com/spec/websocket/)             |
| GraphQL detail                     | [/spec/graphql/](https://hakka.noodleapps.com/spec/graphql/)                 |
| Trace correlation                  | [/spec/trace/](https://hakka.noodleapps.com/spec/trace/)                     |
| Mock                               | [/spec/mock/](https://hakka.noodleapps.com/spec/mock/)                       |
| Breakpoints                        | [/spec/breakpoints/](https://hakka.noodleapps.com/spec/breakpoints/)         |
| Throttle                           | [/spec/throttle/](https://hakka.noodleapps.com/spec/throttle/)               |
| Search DSL                         | [/spec/search-dsl/](https://hakka.noodleapps.com/spec/search-dsl/)           |
| Export                             | [/spec/export/](https://hakka.noodleapps.com/spec/export/)                   |
| Retention                          | [/spec/retention/](https://hakka.noodleapps.com/spec/retention/)             |
| Redaction                          | [/spec/redaction/](https://hakka.noodleapps.com/spec/redaction/)             |
| Bridge                             | [/spec/bridge/](https://hakka.noodleapps.com/spec/bridge/)                   |
| Control channel                    | [/spec/control-channel/](https://hakka.noodleapps.com/spec/control-channel/) |
| Plugins                            | [/spec/plugins/](https://hakka.noodleapps.com/spec/plugins/)                 |
| Storage panel                      | [/spec/storage/](https://hakka.noodleapps.com/spec/storage/)                 |
| Theming                            | [/spec/theming/](https://hakka.noodleapps.com/spec/theming/)                 |

## 1. Capture model

The engine captures **requests** (HTTP via fetch/XHR/native interceptors, WebSocket frames,
`sendBeacon`, and — on web — the Performance Timeline) and **console** entries, normalizes them
to the shared record contract, stores them in a bounded ring buffer with age-based retention, and
dispatches to listeners, record sinks, and the desktop bridge. Detail: [capture](https://hakka.noodleapps.com/spec/capture/).

- **Capture is pluggable** — see §4. Each platform registers platform-appropriate capture
  plugins into the same engine.
- **No-op artifacts** strip the SDK to zero cost in release builds (Android/iOS today; web ships
  dev-gated; RN via `enabled: false`).

## 2. Panel set

Every platform UI renders the same panels (by `id`), mapping each to a native renderer. Not
covered by an individual spec card except storage:

| id        | Panel                                                                                                                                                                                                                  | Status                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `network` | request list + detail (overview, headers, request/response, **timing waterfall**, JSON viewer, cookies)                                                                                                                | ● core                                                                                                                     |
| `console` | log/info/warn/error capture, level filter, search, dedup, group nesting                                                                                                                                                | ●                                                                                                                          |
| `storage` | web localStorage/sessionStorage/cookies · RN AsyncStorage/MMKV · iOS UserDefaults · Android SharedPreferences — view + delete (in-place edit on RN)                                                                    | ● [card](https://hakka.noodleapps.com/spec/storage/)                                                                       |
| `stats`   | rates (success/error), latency (avg/min/max/p95), byte totals, method & status-class breakdown                                                                                                                         | ●                                                                                                                          |
| `info`    | UA / platform / viewport / network status / app + bundle version                                                                                                                                                       | ●                                                                                                                          |
| `mocks`   | rule list + editor (match → canned response / block / redirect / rewrite / transport-error `failure`), per-rule delay + `skipCount`/`stopAfter` match budget (throttle profiles planned), request/response breakpoints | ● RN/Web · [mock](https://hakka.noodleapps.com/spec/mock/) / [breakpoints](https://hakka.noodleapps.com/spec/breakpoints/) |

## 3. Feature requirements

The capability set Hakka commits to on every platform. Each row is implemented per
platform, and every group now has a spec card — including
[triggers](https://hakka.noodleapps.com/spec/triggers/) and
[sessions](https://hakka.noodleapps.com/spec/sessions/). The cards carry the
per-platform status; this list is the grouped, user-facing view.

**Capture** — WebSocket frames · `sendBeacon` · Resource Timing (web) · pluggable
**BodyDecoder** (gzip/brotli/protobuf) · GraphQL op-name detection · form-data/multipart
introspection · configurable max body size + truncation marker · **retention/TTL**
(1h/1d/1w/forever) · rolling cap · **pause/resume** (buffer, don't drop) · regex
skip-paths/skip-domains · per-session enable/disable.

**Inspect** — timing waterfall (DNS/TCP/TLS/TTFB/download, per redirect hop) ·
original-vs-current request toggle · cookie inspector · image inline preview · large-body
reveal guard · JSON tree + XML pretty-print · URL encode/decode toggle · copy raw vs
formatted · **body search** with next/prev + highlight.

**List** — virtual/recycling list · group-by (host/status/method/error) · sort-by
(time/duration/size/status) · status-code chip filter · compact row mode · status colors.

**Search/Filter** — typed token pills + confidence suggestions · search scopes
(url/headers/body) · status-code range DSL (`2XX`, `200..<300`) · custom filter with
AND/OR + negation · saved/recent filters · `defaultFilter` startup preset.

**Export** — HAR · OpenTelemetry · cURL (with auth + `--compressed` + escaping) · Postman
Collection · plain text / HTML · per-section + filtered-subset share · save-to-file.

**Triggers** — shake-to-open (RN/iOS/Android) · live-stats notification (Android full
inbox; iOS one-shot count only) · imperative trigger API · draggable persistent entry
button (all four). An **app launcher shortcut** is roadmap, not shipped — no
`ShortcutManager` or `shortcuts.xml` exists in `android/`. Per-platform status:
[triggers card](https://hakka.noodleapps.com/spec/triggers/).

**Sessions/Analytics** — per-launch sessions · session share/export · store-size view.

## 4. Plugin model

Defined in `hakka-core` ([`engine/plugins.ts`](./packages/hakka-core/src/engine/plugins.ts)); current
interface, public API, and test anchors are maintained in the
[Plugins spec card](https://hakka.noodleapps.com/spec/plugins/), not duplicated here.
`Hakka.use(plugin)` registers panels, body renderers, and context-menu items as platform-neutral
descriptors; `Hakka.getPanels()` drives the host tab bar. Each host (web Solid, RN, SwiftUI,
Compose) maps a panel `id` to its own renderer, so the panel set stays identical while rendering
stays native.

## 5. Parity matrix

● shipped · ◐ partial · ○ roadmap · — not offered · ⊘ out of scope

**Reading the RN column.** RN cells describe the **React Native JS inspector**
(`hakka-react-native/ui`). RN users who opt into the native inspector instead
(`bubble.renderMode: 'native'`, or the imperative `Hakka.show()`) get the **iOS**
and **Android** columns, not this one — the two are not interchangeable. See
[React Native package](https://hakka.noodleapps.com/react-native/package/).

**Engine vs UI.** A `●` means the capability ships on that platform. That is not
always the same as it having a management UI — the engine can be complete while
the inspector exposes no screen for it. Where the two diverge, the row's footnote
says so explicitly; see ⁵ and ⁶ for mocking on iOS and Android.

**Inspector surfaces vs capture targets.** This table indexes **inspector
surfaces** — where a developer looks at captured traffic — not **capture
targets** — where the SDK actually runs and intercepts. The four original
columns happen to be both at once (the iOS in-app inspector ships inside the
same package that captures iOS traffic, and the same holds for
Android/RN/web), which is easy to miss until a fifth surface breaks the
pattern. **Mac app** is `apps/hakka/` — a standalone macOS application (API
client + live traffic inspector + bridge hub) that _receives_ already-captured
traffic over the bridge. It is not an SDK embedded in a host app, does not
intercept its own process's network calls the way the other four intercept
their host's, and several rows that only make sense for an in-app SDK (a
shake gesture, a floating bubble, a device's own UA/platform info) are `⊘` or
`—` for it rather than roadmap. See **Capture targets** at the end of this
section for the different, unrelated question of which platforms the capture
SDK itself builds and ships for — do not conflate the two tables.

| Capability                        | RN      | iOS | Android | Web | Mac app |
| --------------------------------- | ------- | --- | ------- | --- | ------- |
| Native capture                    | ●       | ●   | ●       | —   | —       |
| JS capture                        | ●       | —   | —       | ●   | —       |
| WebSocket frames¹⁷ ²⁰             | ●       | ●   | ●       | ●   | ●       |
| Timing waterfall                  | ●       | ●   | ●       | ●   | ●       |
| HAR / OTel / cURL¹ ²¹             | ●⁴      | ●   | ●       | ●   | ◐       |
| Postman export                    | ●       | ●   | ●       | ●   | —       |
| Mocking / throttle²²              | ●       | ●⁵  | ●⁶      | ●   | ●       |
| Breakpoints³ ²³                   | ●       | ●   | ●       | ●   | ●       |
| Pause/resume²                     | ●       | ●   | ●       | ●   | ●       |
| Status-code chips²⁴               | ●       | ●   | ●       | ●   | —       |
| Group-by / sort-by⁷ ²⁵            | ●       | ●   | ●       | ●   | ◐       |
| Cookie inspector                  | ●       | ●   | ●       | ●   | —       |
| Body search                       | ●       | ●   | ●       | ●   | ●       |
| GraphQL detail                    | ●       | ●   | ●       | ●   | —       |
| Trace correlation⁹                | ●       | ●   | ●       | ●   | ●       |
| Console panel²⁶                   | ●       | ●   | ●       | ●   | ●       |
| Storage panel²⁶                   | ●       | ●   | ●       | ●   | ●       |
| Stats panel²⁷                     | ●       | ●   | ●       | ●   | ◐       |
| Info panel                        | ●       | ●   | ●       | ●   | —       |
| Notification inbox                | —       | ○   | ●       | —   | —       |
| Plugin system                     | ●(core) | ●   | ●       | ●   | —       |
| BodyDecoder¹⁰ ²⁸                  | ●       | ●   | ●       | ●   | ◐       |
| Advanced search                   | ●       | ●   | ●       | ●   | ●       |
| Bridge to hub⁸                    | ●       | ●   | ●       | ●   | ●       |
| Framework span capture¹¹ ²⁹       | —       | —   | —       | ●   | ●       |
| Trace-id adoption¹²               | —       | —   | —       | ●   | —       |
| Trace badge row¹³                 | —       | —   | —       | ●   | —       |
| Verbose span toggle¹⁴ ³⁰          | —       | —   | —       | ●   | ●       |
| Cache-status tags¹⁵               | —       | —   | —       | ●   | —       |
| Request-kind filter¹⁶             | —       | —   | —       | ●   | —       |
| Crash containment¹⁸               | ●       | —   | —       | ●   | —       |
| Stale-body revalidation¹⁹         | ○       | ⊘   | ⊘       | ●   | ⊘       |
| Cross-target trace waterfall³¹    | —       | —   | —       | —   | ●       |
| Device attribution³²              | —       | —   | —       | —   | ●       |
| Deterministic failure diagnosis³³ | —       | —   | —       | —   | ●       |
| Folder runs³⁴                     | —       | —   | —       | —   | ●       |
| gRPC frame inspector³⁵            | —       | —   | —       | —   | ●       |
| gRPC unary send³⁷                 | —       | —   | —       | —   | ◐       |
| OAuth2 + PKCE (API client)³⁶      | —       | —   | —       | —   | ●       |

¹ cURL hardened (shell-safe quoting, `--compressed`, Basic-auth `-u`) in v1.1.
² JS-side pause/resume gates the ring buffer on every platform. RN **native-mode** pause/resume now forwards through the `HakkaMonitor` TurboModule — `pause`/`resume` on the codegen spec and `rnCaptureAdapter` ([`native/nativeAdapter.ts`](./packages/hakka-react-native/src/native/nativeAdapter.ts)) call into the native engines (`HakkaInterceptor.pause()` on iOS, `LogStore.pause()` via `HakkaInterceptor` on Android), so `Hakka.pause()` stops the native engine recording, not just the JS ring buffer.
³ Request **and** response-phase breakpoints (pause-and-edit, in-process, no proxy or cert). The `breakpointEngine` lives in `hakka-core` and is consumed by the web overlay today; other hosts can adopt the same engine. On web, XHR supports request-phase breakpoints only (fetch covers both).
⁴ RN exports HAR via the inspector share button. OTel, Postman, and per-request cURL are available as API calls (`toCurl`, `toOtelJson`, `toPostmanCollection` from `hakka-core`) and share-sheet buttons (HAR/OTel/Postman/cURL) are wired into the RN request-detail share action.
⁵ iOS: mock rules (block / canned response / redirectTo / declarative `modify` / transport-error `failure`, per-rule delay, `skipCount`/`stopAfter` match budget) plus named throttle profiles (fast-3g / slow-3g / edge / offline) with latency + bandwidth drip applied to real requests via URLProtocol. `redirectTo` and `modify` route the match through `HakkaURLProtocol`'s passthrough-then-transform path (`Common/MockRuleModify.swift`'s `MockRuleTransform`) — the real request is issued (with the URL/headers/query rewritten first), then the real response's status/headers/body are transformed before delivery. Precedence when several are set: `failure` > `block` > rewrite path (`redirectTo`/`modify`) > plain mock `response`. `block` short-circuits with a network-error-shaped `NSURLErrorNotConnectedToInternet` failure; `failure` short-circuits with the specific `URLError.Code` its `MockFailureCode` declares (`MockFailure.swift`) — both are still recorded as a completed capture. `skipCount`/`stopAfter` gate whether a match applies at all (`MockEngineMatching.swift`'s `admitMatchLocked`): the counter is in-memory engine state, keyed per rule id, reset on process relaunch and on re-add/edit — the desktop cannot show live progress through that budget (no feedback frame on the control channel), only the configured numbers (`RuleEntryDisplay`). Parity with the TS engine's declarative surface (`MockRuleModify`, `MockFailure`); no `rewriteRequest`/`rewriteResponse` functions (those cannot cross a native bridge). iOS ships a full mock-rule management screen (`UI/Mocks/MocksView.swift`, reached via Rules → Mocks): add by URL pattern + method + action (mock / redirect / block / failure) with status, delay, body, target URL, or failure code, plus optional skip/stop fields; per-rule hit count, enable/disable, and delete. Rules created by the one-shot "Mock this" action in request detail appear there and are managed from there. Editing an existing rule's fields in place is not offered on any platform — the web overlay and RN inspector are add/toggle/delete too.
⁶ Android: mock rules (block / canned response / redirectTo / declarative `modify` / transport-error `failure`, delayMs, `skipCount`/`stopAfter` match budget) plus named throttle profiles (fast-3g / slow-3g / edge / offline) with latency + bandwidth drip via an OkHttp ForwardingSource. `redirectTo` and `modify` route the match through `HakkaInterceptor.interceptRewrite` — the real request is issued via `chain.proceed` (URL/headers/query rewritten first via `request.newBuilder()`), then the real response's status/headers/body are transformed via `response.newBuilder()` with the body re-wrapped (`MockEngine.kt`'s `MockRuleTransform`). Precedence: `failure` > `block` > rewrite path > plain mock response — same order as iOS/TS. `block` throws an `IOException("Blocked by Hakka")`; `failure` throws the specific `IOException` subtype its `MockFailureCode` maps to (`UnknownHostException`/`SocketTimeoutException`/`ConnectException`/`SSLException`/plain `IOException`, per `HakkaInterceptor.kt`'s `ioExceptionForFailure`) — both before any real request is sent, both still recorded as a completed capture. `skipCount`/`stopAfter` gate application via `MockEngine.kt`'s in-memory `matchCounts`, same semantics and same "no live progress on desktop" caveat as iOS. Parity with the TS engine's declarative surface; no `rewriteRequest`/`rewriteResponse` functions. Android ships a full mock-rule management screen (`ui/MocksPanel.kt`, reached via Rules → Mock): add by URL pattern + method + action (mock / redirect / block) with status, delay, body or target URL; per-rule hit count, enable/disable, edit, and delete. Rules created by the one-shot "Mock this" action in the detail overflow menu appear there and are managed from there. All four platforms now present the same Rules switch — **Mock | Breakpoints | Throttle**, in that order.
⁷ RN sort/group is implemented in `packages/hakka-react-native/src/ui/utils/groupSort.ts` using `hakka-core` types and `extractHost`; the UI exposes sort field, sort direction, and group-by pickers. The core `sortRequests`/`groupRequests` query engine is also available for RN callers.
⁸ All three native platforms stream canonical `{ type: "request", payload }` frames to the bridge hub (`hakka-bridge`), which forwards them to `hakka mcp`. RN uses `HakkaBridge` (WebSocket client in TS). iOS uses `HakkaBridgeClient` (Swift, `URLSessionWebSocketTask`). Android uses `BridgeSink` (Kotlin, OkHttp). The bridge also relays `{ type: "control", payload: ControlCommand }` frames peer-to-peer (never buffered): `hakka mcp`'s **write tools** (`create_mock` / `promote_capture_to_mock` / `delete_mock` / `clear_mocks` / `set_breakpoint` / `delete_breakpoint` / `set_throttle`) drive the in-app mock/breakpoint/throttle engines through it. The contract lives in `hakka-core` (`parseControlCommand` / `applyControlCommand`, strict + fail-open, remote ids replace-by-id). Control-frame consumers: web ● (worker → main-thread engines) · RN ● (`HakkaBridge`) · iOS ● (`HakkaBridgeClient` receive loop + `Common/ControlCommand.swift`) · Android ● (`BridgeSink`'s `WebSocketListener.onMessage` + `hakka-network/ControlCommand.kt`, replace-by-id added to `MockEngine`/`BreakpointEngine`). `search_requests` also accepts the advanced search DSL via its `query` param. URL encode/decode toggle: RN ships a Decoded/Raw toggle in `ContentTab.tsx` (`decodeUrl` from `hakka-core`); iOS ships the same toggle in `QueryParamsView` (`Common/UrlCodec.swift`'s `HakkaUrlCodec.decodeUrl`, mirroring core's fail-open semantics); Android ships it in `DetailActivity` via `UrlCodec.kt` (`decodeUrl`/`isUrlEncoded`, same fail-open semantics). Body search: web's `BodySearch` (`Detail.tsx`) and RN's `ContentTab`/`CodeBlock` ship inline search with next/prev + an n/m match counter; iOS mirrors it in `BodyContentCard` (`DetailBodyHelpers.swift`) via `MatchHighlightedBody`, an `AttributedString`-backed highlighter with the same active/dim match grammar; Android mirrors it in `DetailActivity` (debounced search bar, `‹ X/N ›` match-nav, span-highlighted focused match).

⁹ **Web** ships full client↔server trace correlation: the `hakka-next` full-stack case joins a browser request with the server hop it triggers into one timeline (verified — a `x-hakka-trace` id propagates client → server → upstream). **RN / iOS / Android** originate and stamp the `x-hakka-trace` header + `correlationId` on every outgoing request (iOS `RequestBuilder`, Android `HakkaInterceptor`, RN `correlationId` display). The **`hakka-node`** package (ADR 0001) reads that header on any Node backend (Fastify / Express / Hono / raw `http`), falls back to a W3C `traceparent`, and streams the server hop, so a native client's request joins its backend's capture into one causal chain, the same join `hakka-next` already does for the web (verified by `scripts/smoke-trace-correlation.mjs`). Native is trace-_joining_ when the backend runs `hakka-node`.

¹⁰ The `BodyDecoder` registry (gzip/deflate/SSE/protobuf-wire/gRPC-web) lives in `hakka-core` (`engine/decoders.ts`) and is invoked in the JS body renderers — RN (`ContentTab`) and web (`Detail`) call `bodyDecoders.decode(body, contentType, contentEncoding)` before display. iOS ports the same chain to Swift (`ios/Sources/Common/BodyDecoders`, wired into `DetailBodyHelpers`) and Android to Kotlin (`android/hakka-common`, wired into `DetailActivity`), each matching core's decoded-output format against the shared `decoders.test.ts` fixtures.

¹¹ `hakkaSpanProcessor()` (`packages/hakka-node/src/spanProcessor.ts`) attaches to an already-registered OTel `TracerProvider` (`attach()` is the SDK-1.x fallback; `hakkaSpanProcessor()` itself is the SDK-2.x-safe path, since 2.x removed post-registration `addSpanProcessor`) and surfaces Next.js's own request-tree spans (`BaseServer.handleRequest`, `AppRouteRouteHandlers.runHandler`, …) as `FrameworkSpan` records once `enableTraceSpans()` is on. `hakka-node`/`hakka-browser` only — no RN/iOS/Android OTel SDK integration exists, and core interceptors never emit `FrameworkSpan` themselves.

¹² `adoptOtelTraceId()` (`packages/hakka-node/src/trace.ts`) lets a root span's own OTel trace id become the request's `correlationId`, but only when no trace context exists yet — the pure SSR/document-navigation case where no `x-hakka-trace`/`traceparent` header was present. Called from `spanProcessor.ts`'s `onStart`. Web/`hakka-node` only; native platforms have no OTel span source to adopt an id from.

¹³ `TraceBadgeRow` (`packages/hakka-browser/src/ui/TraceBadgeRow.tsx`) renders a trace group's method/status/requestKind pills, fetch/operation counts, a cache summary line, and a "Slowest: `<label>` (`<duration>`)" callout computed from `TraceBadgeSummary`. Web only — no RN/iOS/Android trace-grouping UI exists to host it.

¹⁴ The same `TraceBadgeRow` renders a `.hakka-switch` toggle that flips a trace group's span list between only `'primary'`-classified spans and the full `'primary' | 'verbose'` set a `FrameworkSpan` carries (`spanProcessor.ts`'s `PRIMARY_SPAN_TYPES` classification). Web only.

¹⁵ `NetworkRequest.cacheStatus` (`packages/hakka-core/src/model/types.ts`) is never set by core interceptors — it's populated by `hakka-node`'s server capture (`next/serverCapture.ts`) reading a framework cache-status response header (Next.js `x-nextjs-cache` wins when present, else Vercel `x-vercel-cache`), then rendered as a `.hakka-rt-tag hakka-cache-<status>` pill in `RequestRow.tsx` and a `Cache` KVRow in `Detail.tsx`. Web/`hakka-node` only.

¹⁶ `FrameworkSpan.requestKind` (`'document' | 'rsc' | 'route-handler' | 'server-action'`) is classified per-trace by `classifyRequestKind()` in `spanProcessor.ts` from the `next.rsc` span attribute plus an inbound `server-action` header hint (`trace.ts`'s `requestKindHint`), then exposed as a segmented filter (`FilterBar.tsx`'s `requestKindFilter`) that narrows visible trace GROUPS by their root span's kind. Client-side only, shown while grouped by trace. Web only.

¹⁸ The web overlay wraps the inspector in a root error boundary (`CrashBoundary.tsx`, Solid's `<Errored>`): a crashed inspector renders a compact "Inspector crashed — reload" bar inside its own shadow root instead of freezing or unstyling the host page, and Reload tears down the entire crashed tree and mounts a fresh one. Captured traffic survives the reload — the store lives outside the UI tree (Worker/singleton). RN wraps the JS inspector root the same way (`hakka-react-native/src/ui/CrashBoundary.tsx`, a class component — React has no hooks-based error boundary): `HakkaInspector.tsx`'s `Wrapper` and `Standalone` both mount `InspectorUI` inside it, a caught crash swaps in a compact "Inspector crashed — reload" bar built from the shared design tokens, and Reload bumps a `generation` counter used as the wrapped children's `key`, which forces React to fully unmount the crashed tree and mount a fresh one rather than re-rendering in place. Captured traffic survives — `hakka-core`'s `Hakka` log store is a module-level singleton outside the React tree, untouched by the remount. iOS/Android native panels ride the host app's native exception model — a boundary of this kind is not offered. Mac app is a standalone native application, not embedded in any host — it rides the same OS-level exception model as iOS/Android's native panels, so the same reasoning applies and no boundary of this kind is offered there either.
¹⁹ Switching rows in the web Detail keeps the previous request's body visible (dimmed while `isPending`) while the next body hydrates asynchronously, instead of flashing an empty state (`Detail.tsx` async memo + `<Loading>`). iOS/Android read bodies in-process with no async gap, so there is nothing to revalidate (out of scope by design). RN fetches bodies over the bridge (async) — roadmap. Mac app also reads bodies in-process from its own in-memory `TrafficStore` (`apps/hakka/Sources/Core/Traffic/TrafficStore.swift`) with no async gap — same reasoning as iOS/Android, out of scope by design.
¹⁷ All four platforms capture WebSocket connections and frames: RN and web through core's JS interceptor (`capture/websocket.ts`), iOS through `WebSocketMonitor.swift`, Android through `HakkaWebSocketWrapper.kt`. The sub-protocol frame-decoder registry (MQTT / Socket.IO / STOMP / graphql-ws) is now implemented on all four: `engine/wsDecoders.ts` in core-TS, ported to Swift in `ios/Sources/Common/BodyDecoders/WsFrameDecoders+*.swift` and to Kotlin in `android/hakka-common/.../{Mqtt,SocketIo,Stomp,GraphqlWs}WsDecoder.kt`, each verified against the TypeScript fixtures. Native panels render the decoded kind and payload summary, falling back to raw frame text when no decoder matches. Server-side outbound WebSocket capture (`hakka-node`) is not offered on any platform.

²⁰ Mac app ships its own interactive WebSocket console (`Sources/App/Views/Detail/DetailFramesTabView.swift`, driven by `WebSocketConnectionModel` over a real `URLSessionWebSocketTask`) — connect, send, and watch frames arrive live, the same job the API-client's other request types do, with a lifecycle bar and dropped-frame counter (`WebSocketCaps.perConnectionFrameCount`). It does **not** render `WsMessage` frames relayed inside a bridge-captured `NetworkRequest` from a connected device (`ios/Sources/Common/NetworkRequest.swift`'s `messages` field) — grepped for it, no view reads that field. So the mark reflects "Mac app can act as its own WS client," not "Mac app can inspect a device's captured WS traffic."

²¹ HAR export is fully wired (`AppModel+TrafficSessions.swift` → `TrafficModel+Session.exportHar()` → `TrafficStore.exportHar` → the shared `HarExporter`, same field mapping as iOS/RN/web). Per-request cURL (plus JS/Swift/Python/Go/HTTPie) is available via the "Copy as" menu (`DetailActionBar.swift` → `CurlCodeGenerator`). There is no OTel export anywhere in `apps/hakka` — grepped for `Otel`/`OTel`/`otel` across `Sources/`, zero hits — so the row is partial, not shipped.

²² Mac app authors mock/breakpoint/throttle rules and pushes them to connected devices over the same control channel MCP's write tools use (footnote ⁸) — it does not intercept its own outbound traffic the way the four SDKs intercept a host app's. `RuleStore` (`Sources/Core/Rules/RuleStore.swift`) is the authoring list; `RulesView` manages it (add/toggle/delete, per-rule hit count); `installCommand(for:)` (`RuleWireCommand.swift`) turns an entry into a `ControlCommand.mockAdd`/`.breakpointAdd` a device engine executes. The one-shot "Mock" button on a captured row (`DetailActionBar.swift`) freezes that exact response into a replay mock via `CapturedMockConverter` — the desktop-UI counterpart of the `promote_capture_to_mock` MCP tool, and the same "Mock this" idea iOS/Android's own detail views already offer (footnotes ⁵, ⁶), just authored centrally and pushed rather than installed in-process.

²³ Full remote pause-and-edit, not just rule authoring: a device hitting a breakpoint sends a `ControlCommand.breakpointPaused` frame with the paused request/response; `PauseStore`/`PauseInboxModel` hold it (with a 300s auto-abort watchdog, since the device-side engine blocks on a bare semaphore with no timeout of its own); `PauseEditorView` (`Sources/App/Views/PauseInbox/PauseEditorView.swift`) lets a person edit URL/method/headers/body (request phase) or status/headers/body (response phase) before Resume or Abort sends `breakpoint.resume`/`.abort` back over the bridge. This is the same pause-and-edit contract footnote ³ describes, over the wire instead of in-process.

²⁴ No chip-style status-code filter control exists anywhere in `apps/hakka` — grepped for `chip`/`Chip`, zero hits. The equivalent filtering is available as typed tokens in the free-text search bar (`2xx`, `status>=400`, etc., via `TrafficQueryParser`/`Advanced search`), just not as the clickable-chip affordance this row names.

²⁵ Sort is real but DSL-only: `sort:duration`/`order:asc` tokens, parsed by `TrafficQueryParser` and applied via `TrafficSort.sort` — no dedicated sort-field/order picker control. Group-by does not exist at all; `TrafficQueryCompiler.swift`'s own doc comment says so explicitly ("this desktop tool has no grouping UI yet").

²⁶ The bridge wire protocol carries five frame kinds — `request`, `span`, `console`, `storage`, `control` (`Sources/Server/BridgeWireFrame.swift`'s `BridgeFrameKind`, mirroring `packages/hakka-bridge/src/protocol.ts`'s `BridgeMessage` union). `console` carries a small batch of the SDK's own `LogEntry` (never a new shape — the same model each platform's Logs tab already used), `storage` carries a named `StorageSnapshot` (`store`/`timestamp`/`entries`) with snapshot-replace semantics, never a diff. Shared fixtures live in `fixtures/console/` and `fixtures/storage/`, same convention as `fixtures/span/`. Both frame kinds ship end to end for iOS: `HakkaInterceptor.log(...)` calls `HakkaBridgeClient.sendConsole`, and `StorageView`'s UserDefaults poll calls the new `HakkaInterceptor.publishStorageSnapshot(store:entries:)` → `HakkaBridgeClient.sendStorage` — proven over a real loopback socket by `SDKBridgeClientTests` in `apps/hakka/Tests/CoreTests/BridgeSocketTests.swift`. The Mac app's `BridgeHub` gained `consoleEntries`/`storageSnapshots` streams, consumed by `LogsModel`/`StorageModel` (`Sources/App/Models/`) feeding the Logs/Storage sidebar sections (`LogsPanelView.swift`/`StoragePanelView.swift`). Both panels now carry text search (`LogsModel.filteredEntries`/`StorageModel.visibleStores`, matching message/metadata or key/value), and the Logs panel adds a level filter while the Storage panel adds a store picker — closing the "no search or filtering yet" gap this footnote used to flag, hence `●` rather than `◐`. `LogsModel` still has no per-device filter: unlike `.request` frames, `BridgeHub.ingest` never pairs a `.console` frame with sender identity (see `LogsModel.swift`'s doc comment), so there is nothing to filter by yet — a wire-level gap, not a UI one. `hakka-node`'s `bridgeClient.ts` also has `sendConsole`/`sendStorage` methods mirroring `sendSpan`'s fire-and-forget contract, but nothing in `hakka-node` calls them — deliberately: it captures only network requests and spans, with no structured-log or device-storage source of its own, so there is nothing genuine to wire (contract + client method only, same as before). RN's `HakkaBridge` (`packages/hakka-react-native/src/core/HakkaBridge.ts`) now sends both: `sendConsole` streams every entry added to `hakka-core`'s shared `logStore` (the Logs tab's "Structured" segment — the same `LogEntry` model iOS's `HakkaInterceptor.log()` streams from) as a batch-of-one `console` frame, and `sendStorage` publishes a redacted AsyncStorage/MMKV snapshot both on every Storage-tab refresh (`StorageViewer.tsx`, mirroring iOS's `StorageView.refreshPairs()`) and once per installed backend right after the bridge connects (`_publishStorageSnapshotsOnConnect`) — redaction reuses `redactStorageValue`/`redactStorageEntries` (`packages/hakka-react-native/src/storage/redact.ts`, shared with the storage monitors), since the live Storage tab's own on-screen values were unredacted before this change. Android's `BridgeSink` (`android/hakka-network`) gained matching `sendConsole`/`sendStorage` methods, queued the same way `onRecord` already queues `request` frames while disconnected (unlike `hakka-node`'s fire-and-forget contract for this frame kind); `HakkaInterceptor.sendConsoleFrame`/`sendStorageFrame` fan them out to every attached `BridgeSink` (the one from `Builder.bridgeUrl` plus any attached later via `connectBridge`). `Hakka.log(...)` (`hakka-ui`) calls `sendConsoleFrame` right after appending to `HakkaLogStore` — Timber integration (`HakkaTimberTree`) inherits it for free, since it already routes through `Hakka.log`. `StorageTabController.reload()` publishes one `StorageSnapshot` per discovered `SharedPreferences` file (`store: "sharedPreferences:<file>"`), redacted with the existing `redactLogMetadata` helper against `HakkaConfig.sensitiveBodyFields`. The vendored RN-Android module (`packages/hakka-react-native/android/`) never sets `bridgeUrl` on the interceptor it builds, and deliberately does not — a second `BridgeSink`/socket would double-report every request already relayed via `onHakkaRequests` → the JS `HakkaFacade` → the JS-side `HakkaBridge`'s own WebSocket (that path already reaches the desktop; it just isn't `BridgeSink`). Console and storage were the actual gap, and not for the reason this footnote used to claim: `Hakka.log(...)`'s `sendConsoleFrame` call and `StorageTabController.publishSnapshots()`'s `sendStorageFrame` call both read `HakkaUI.interceptor`, set only by `attachInterceptor` — which RN's `NativeCoreDelegate.showUI` never calls (it launches `HakkaActivity`/`HakkaBottomSheet`/`HakkaBubble` directly by reflection, bypassing `Hakka.install()`), so both calls were no-ops in RN native-render mode independent of `bridgeUrl`. Fixed by relaying over the *existing* `onHakkaRequests` event channel instead of attaching an interceptor (attaching one would light up `HakkaUI`'s Settings "connect to desktop" toggle, reopening the same double-report risk): `HakkaUI` gained `subscribeStructuredLogs` (wraps `HakkaLogStore.subscribe`, independent of `attachInterceptor`) and `captureStorageSnapshots` (wraps the extracted `SharedPreferencesSnapshotter`, redaction supplied by the caller). `NativeCoreDelegate` subscribes to the former at `initialize()` and emits each entry as `onHakkaConsole` (live push, mirrors `onHakkaRequests`'s per-record granularity); `publishStorageSnapshots()` — a new `HakkaMonitor` TurboModule method — captures a fresh, natively-redacted SharedPreferences snapshot on demand and emits it as `onHakkaStorage` (no live push — matches the JS bridge's own AsyncStorage/MMKV publish, which is connect-time-only too). JS's `nativeProtocol.ts` gained the two event consts plus `parseConsoleBatch`/`parseStorageSnapshot`, subscribed in `HakkaFacade.startNativeCapture` alongside `NATIVE_REQUEST_EVENT`: console entries feed straight into the shared `logStore` (so `HakkaBridge`'s existing `logStore.subscribe` relays them for free — no new console plumbing needed in the RN package), storage snapshots dispatch to `Hakka.onNativeStorage` listeners. `HakkaBridge._connect()` subscribes one such listener straight to `sendStorage` — deliberately skipping `redactStorageEntries` (unlike the AsyncStorage/MMKV branch), since the snapshot is already redacted on-device — and `_publishStorageSnapshotsOnConnect()` now also calls `Hakka.requestNativeStorageSnapshots()` to trigger the on-demand capture right after connecting.

²⁷ `TrafficStats`/`TrafficStatsAccumulator` compute exactly what SPEC §2 calls for — count, error rate, p50/p95 latency, byte totals — live, on every `TrafficStore.append` (`Sources/Core/Traffic/TrafficStats.swift`). The only UI consumer is `LiveTrafficHeader`'s single request-count line; there is no dedicated stats screen surfacing the rest. The data model is complete; the UI exposure is thin — partial, not shipped.

²⁸ Confirmed present: gRPC/gRPC-Web frame decode (`GrpcBodyDecode.swift`, fixture-tested) and JSON pretty-print/outline (`JSONPrettyPrinter.swift`, `JSONOutlineNode.swift`). SSE/streaming assembly also exists but is scoped to LLM providers (`AnthropicStreamAssembler.swift`, `OpenAiStreamAssembler.swift`), not a general SSE decoder. No generic gzip/deflate content-encoding inflate path was found in `Sources/Core/Detail` — `BodyViewerRegistry.swift` recognizes `application/gzip` as a viewer _kind_ for routing, but nothing there or elsewhere inflates it, unlike the shared `BodyDecoder` chain (footnote ¹⁰) iOS/Android/RN/web all port in full. Partial, not the same registry.

²⁹ Mac app receives and stores `FrameworkSpan` frames over the bridge (`.span` case in `BridgeWireFrame`), correlating them with requests in `TraceStore` for the cross-target waterfall (footnote ³¹) — it consumes and renders spans, the same role web plays relative to `hakka-node` (footnote ¹¹), never originating one itself (no OTel SDK integration in `apps/hakka`).

³⁰ `TraceWaterfallView` has its own `verbose` toggle (a SwiftUI `Toggle`, `Sources/App/Views/Trace/TraceWaterfallView.swift`) gating `Trace.tree(verbose:)`'s `'primary'`/`'verbose'` span filter (`TraceTree.swift`) — the same classification footnote ¹⁴ describes for web's `.hakka-switch`, in a different widget.

³¹ `TraceStore` (`Sources/Core/Trace/TraceStore.swift`) correlates `NetworkRequest`s and `FrameworkSpan`s by trace id across every connected device into one `Trace`, carrying `participantRuntimes`/`isMultiTarget`; `TraceWaterfallView` renders the result as one cross-target timeline — "a mobile hop, the server span tree it caused, and where the time actually went, on one axis," per the view's own doc comment, ADR 0001's whole argument made visual. No SPEC-row equivalent exists on any in-app SDK, because none of them see more than their own device's traffic.

³² `BridgeDeviceLabeler` (`Sources/Server/BridgeDeviceLabel.swift`) assigns a stable "Device N" label the first time a bridge peer's frame is observed — explicitly _not_ a real device/app identity, since the wire protocol carries no device name, app name, or bundle id (a deliberate choice documented in the same file: adding one is a wire-contract change, not a desktop-only decision). `DeviceLabelIndex` keeps a `requestID → label` map in step with the traffic buffer; `DeviceTagView` renders it per row. No other platform needs this — each of them only ever sees its own device's traffic.

³³ `RequestDiagnoser.diagnose(_:)` (`Sources/Core/Detail/RequestDiagnosis.swift`) is a pure, rule-based function over fields already on a captured record (TLS/connect/DNS/TTFB timestamps, redirect chain, status, headers) that returns a specific, evidence-backed sentence for known failure shapes (TLS handshake died, connect-then-no-response, DNS-resolved-then-failed, a 401 with vs without an `Authorization` header, a 304 naming its validator header, a 413 naming the body size, 429) — and returns `nil` rather than guessing when the evidence doesn't support a specific claim, per its own doc comment. Rendered as a `DiagnosisBanner` in `DetailOverviewSection`. Deterministic, not generated text; no other platform has an equivalent.

³⁴ `FolderRunner` (`Sources/Core/Runner/FolderRunner.swift`) runs every request nested under a saved folder in sequence, carrying captures and cookies forward request-to-request (one `CookieJar` shared across the run, so a login response's `Set-Cookie` reaches request 5), and deliberately does not stop at the first failure — every request in the plan is attempted regardless of what happened before it. This is an API-client capability (Bruno/Postman collection-runner style); no other Hakka platform is an API client with saved collections to run.

³⁵ `GrpcBodyDecoder` renders each length-prefixed gRPC/gRPC-Web message as its own row — index, byte length, compressed flag, and a resolved `GrpcStatus` — via `GrpcFrameRowView` (`Sources/App/Views/Detail/GrpcFrameRowView.swift`), reusing the same wire-format walk the shared `BodyDecoder` registry uses for its gRPC-Web decode (footnote ¹⁰, already `●` on RN/iOS/Android/Web). This row names the distinct capability those platforms don't have: a dedicated per-frame, per-status inspector view, not just a decoded body blob. It does not mean the other four columns can't decode a gRPC-Web body at all — see the `BodyDecoder` row for that.

³⁶ Full RFC 6749 §4.1 + RFC 7636 authorization-code-with-PKCE flow for the API client's own outgoing requests: `PKCE.swift` (S256 challenge only, no `plain` fallback by design), a real loopback HTTP listener (`OAuth2LoopbackListenerLive.swift`) catching the redirect, `state` verification, and client-credentials/refresh-token grants alongside it (`OAuth2FlowRunner+*.swift`). This is an API-client auth feature; no other Hakka platform issues its own authenticated requests, so none needs an OAuth flow of its own.

³⁷ ADR 0012 (phase 1) — a `grpc://`/`grpcs://` request in the collection/request editor sends a real unary gRPC call over HTTP/2 (`grpc-swift-2` + `grpc-swift-nio-transport`, TLS and plaintext/h2c both supported) via `GrpcRunner`/`GRPCSwiftUnaryTransport` (`Sources/Core/Grpc/`), decoding the response through the same `GrpcBodyDecoder`/`GrpcBodyView` the frame inspector row above already ships (footnote ³⁵) — no duplicated decode path. `◐`, not `●`, for two phase-1 cuts: the message is raw hex/base64 only (target/service/method are typed directly, via the request URL's `/package.Service/Method` path — no picker), and server reflection (both service/method discovery and JSON→proto message encoding) was cut entirely, not merely scoped down, because `grpc.reflection.v1`'s `ServerReflectionInfo` RPC is structurally bidirectional-streaming, which sits on the wrong side of phase 1's unary-only boundary. Streaming RPCs (server/client/bidi) and reflection are both phase 2.

## Capture targets

A different question from the table above: not where a developer _looks_ at traffic, but where
the capture SDK itself actually builds and ships. Grounded in `ios/Package.swift`'s declared
`platforms:` and the per-platform build configs below — not in assumption.

| Platform            | Capture SDK ships? | Grounded in                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS (incl. iPadOS)¹ | ●                  | `ios/Package.swift`: `.iOS(.v16)`. `HakkaNetwork` (the interceptor engine) and `HakkaUI` both ship on it.                                                                                                                                                                                                                                                                       |
| macOS²              | ◐                  | `ios/Package.swift`: `.macOS(.v14)` is also declared, and `HakkaNetwork`/`HakkaCommon` compile for it (no `#if os(iOS)` gating found in `Sources/Network`) — but no product ships a macOS-host capture SDK, and `apps/hakka` itself does not consume `HakkaNetwork`, only `HakkaCommon`'s shared model types. Compiles; not shipped as anything a macOS host app can integrate. |
| watchOS             | —                  | Not declared in `ios/Package.swift`'s `platforms:` list at all. Not roadmapped anywhere in this repo — "not offered" is the honest mark, not "roadmap."                                                                                                                                                                                                                         |
| tvOS                | —                  | Same: absent from `platforms:`, no roadmap commitment found.                                                                                                                                                                                                                                                                                                                    |
| Android             | ●                  | Native Kotlin interceptor ships as its own Gradle module (`android/hakka-network/build.gradle.kts`), separate from the inspector UI (`android/hakka-ui`).                                                                                                                                                                                                                       |
| Web (browser)       | ●                  | JS interceptor ships in `hakka-browser` (fetch/XHR/WebSocket monkey-patching).                                                                                                                                                                                                                                                                                                  |
| React Native        | ●                  | JS ring-buffer engine ships in `hakka-react-native`, bridging to the native iOS/Android engines above in native-render mode.                                                                                                                                                                                                                                                    |
| Node.js (server)    | ●                  | `hakka-node` (`packages/hakka-node`) intercepts `fetch`/`http`/`https` on any Node backend — the capture target behind web's client↔server trace correlation (footnote ⁹).                                                                                                                                                                                                      |

¹ iPadOS has no separate platform case in Swift Package Manager — `.iOS(.v16)` covers both; it is
the same build, not a distinct target, so it does not get its own row here.

² Read this row narrowly: it says the capture _engine_ target compiles for macOS, nothing more.
It is not an announcement of a macOS host-app SDK, and nobody should point an app at it expecting
support — that product does not exist today.

## 6. Roadmap

- **1.0 (current wave)** — RN + iOS + Android + web at panel parity
  (network/console/storage/stats/info), P0 features, plugin infra, **breakpoints**,
  **mocking** (block/redirect/rewrite executing in the fetch interceptor), HAR /
  OTel / cURL / **Postman** export, request-initiator, the desktop **bridge**,
  full-stack **Next.js** capture (with **client↔server trace correlation**), the
  **MCP** server, `hakka-core`'s `/test` subpath, and cross-target **trace
  correlation** (a native client → any Node backend joins into one causal chain
  via `hakka-node`, ADR 0001).
  Publishes **7 npm packages** (`hakka-core`, `hakka-browser`, `hakka-bridge`,
  `hakka-node`, `hakka-react-native`, `hakka-rozenite`, `hakka`) + Maven (6
  Android artifacts) + SPM. The CDP capture, standalone elements, React
  wrappers, Next.js capture, MCP server, and test helpers that previously
  published as their own packages (`hakka-cdp`, `hakka-components`,
  `hakka-react`, `hakka-next`, `hakka-mcp`, `hakka-test`) now ship as subpaths
  of the 7: `hakka/cdp`, `hakka-browser/elements/*`, `hakka-browser/react`,
  `hakka-node/next`, `hakka/mcp`, `hakka-core/test`. The Vite/webpack/rspack
  plugins ship as `hakka-browser` subpaths (`hakka-browser/vite`, `/webpack`,
  `/rspack`) the same way, not a separate package.
- **1.1** — first-class sessions and the iOS live-stats notification inbox.
  (Byte-rate throttle enforcement, previously listed here, shipped in 1.0 on every
  platform: core-TS drips response bytes at `downloadKbps` on the fetch path
  (`ThrottleEngine.throttleResponse`) and applies an equivalent completion-delay
  formula on XHR — a timing approximation, not a streamed drip, since XHR cannot
  substitute a response stream; iOS drips via `URLProtocol`, Android via an OkHttp
  `ForwardingSource`. See §5 footnotes 5–6.)
- **2.0** — plugin marketplace, custom renderers, runtime userland plugins.

There is no Flutter target in this tree today — no Dart code, no `hakka_flutter` package. A
prior draft of this roadmap listed one; treat that as withdrawn until real work starts, at which
point it gets its own column back in §5.

> Note: `rewrite` / map-local executes in the **fetch** interceptor (canned mock,
> `block`, `redirectTo`, and `rewriteRequest`/`rewriteResponse` are all wired and
> tested). **XHR** supports mock + block but passes `rewrite` through untransformed
> by design — XHR cannot substitute a response body.
