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

| id        | Panel                                                                                                                                               | Status                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `network` | request list + detail (overview, headers, request/response, **timing waterfall**, JSON viewer, cookies)                                             | ● core                                                                                                                     |
| `console` | log/info/warn/error capture, level filter, search, dedup, group nesting                                                                             | ●                                                                                                                          |
| `storage` | web localStorage/sessionStorage/cookies · RN AsyncStorage/MMKV · iOS UserDefaults · Android SharedPreferences — view + delete (in-place edit on RN) | ● [card](https://hakka.noodleapps.com/spec/storage/)                                                                       |
| `stats`   | rates (success/error), latency (avg/min/max/p95), byte totals, method & status-class breakdown                                                      | ●                                                                                                                          |
| `info`    | UA / platform / viewport / network status / app + bundle version                                                                                    | ●                                                                                                                          |
| `mocks`   | rule list + editor (match → canned response / block / redirect / rewrite), per-rule delay (throttle profiles planned), request/response breakpoints | ● RN/Web · [mock](https://hakka.noodleapps.com/spec/mock/) / [breakpoints](https://hakka.noodleapps.com/spec/breakpoints/) |

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

| Capability                | RN      | iOS | Android | Web |
| ------------------------- | ------- | --- | ------- | --- |
| Native capture            | ●       | ●   | ●       | —   |
| JS capture                | ●       | —   | —       | ●   |
| WebSocket frames¹⁷        | ●       | ●   | ●       | ●   |
| Timing waterfall          | ●       | ●   | ●       | ●   |
| HAR / OTel / cURL¹        | ●⁴      | ●   | ●       | ●   |
| Postman export            | ●       | ●   | ●       | ●   |
| Mocking / throttle        | ●       | ●⁵  | ●⁶      | ●   |
| Breakpoints³              | ●       | ●   | ●       | ●   |
| Pause/resume²             | ●       | ●   | ●       | ●   |
| Status-code chips         | ●       | ●   | ●       | ●   |
| Group-by / sort-by        | ●⁷      | ●   | ●       | ●   |
| Cookie inspector          | ●       | ●   | ●       | ●   |
| Body search               | ●       | ●   | ●       | ●   |
| GraphQL detail            | ●       | ●   | ●       | ●   |
| Trace correlation⁹        | ●       | ●   | ●       | ●   |
| Console panel             | ●       | ●   | ●       | ●   |
| Storage panel             | ●       | ●   | ●       | ●   |
| Stats panel               | ●       | ●   | ●       | ●   |
| Info panel                | ●       | ●   | ●       | ●   |
| Notification inbox        | —       | ○   | ●       | —   |
| Plugin system             | ●(core) | ●   | ●       | ●   |
| BodyDecoder¹⁰             | ●       | ●   | ●       | ●   |
| Advanced search           | ●       | ●   | ●       | ●   |
| Bridge to hub⁸            | ●       | ●   | ●       | ●   |
| Framework span capture¹¹  | —       | —   | —       | ●   |
| Trace-id adoption¹²       | —       | —   | —       | ●   |
| Trace badge row¹³         | —       | —   | —       | ●   |
| Verbose span toggle¹⁴     | —       | —   | —       | ●   |
| Cache-status tags¹⁵       | —       | —   | —       | ●   |
| Request-kind filter¹⁶     | —       | —   | —       | ●   |
| Crash containment¹⁸       | ●       | —   | —       | ●   |
| Stale-body revalidation¹⁹ | ○       | ⊘   | ⊘       | ●   |

¹ cURL hardened (shell-safe quoting, `--compressed`, Basic-auth `-u`) in v1.1.
² JS-side pause/resume gates the ring buffer on every platform. RN **native-mode** pause/resume now forwards through the `HakkaMonitor` TurboModule — `pause`/`resume` on the codegen spec and `rnCaptureAdapter` ([`native/nativeAdapter.ts`](./packages/hakka-react-native/src/native/nativeAdapter.ts)) call into the native engines (`HakkaInterceptor.pause()` on iOS, `LogStore.pause()` via `HakkaInterceptor` on Android), so `Hakka.pause()` stops the native engine recording, not just the JS ring buffer.
³ Request **and** response-phase breakpoints (pause-and-edit, in-process, no proxy or cert). The `breakpointEngine` lives in `hakka-core` and is consumed by the web overlay today; other hosts can adopt the same engine. On web, XHR supports request-phase breakpoints only (fetch covers both).
⁴ RN exports HAR via the inspector share button. OTel, Postman, and per-request cURL are available as API calls (`toCurl`, `toOtelJson`, `toPostmanCollection` from `hakka-core`) and share-sheet buttons (HAR/OTel/Postman/cURL) are wired into the RN request-detail share action.
⁵ iOS: mock rules (block / canned response / redirectTo / declarative `modify`, per-rule delay) plus named throttle profiles (fast-3g / slow-3g / edge / offline) with latency + bandwidth drip applied to real requests via URLProtocol. `redirectTo` and `modify` route the match through `HakkaURLProtocol`'s passthrough-then-transform path (`Common/MockRuleModify.swift`'s `MockRuleTransform`) — the real request is issued (with the URL/headers/query rewritten first), then the real response's status/headers/body are transformed before delivery. `block` short-circuits with a network-error-shaped `NSURLErrorNotConnectedToInternet` failure and is still recorded as a completed capture. Parity with the TS engine's declarative surface (`MockRuleModify`); no `rewriteRequest`/`rewriteResponse` functions (those cannot cross a native bridge). iOS ships a full mock-rule management screen (`UI/Mocks/MocksView.swift`, reached via Rules → Mocks): add by URL pattern + method + action (mock / redirect / block) with status, delay, body or target URL; per-rule hit count, enable/disable, and delete. Rules created by the one-shot "Mock this" action in request detail appear there and are managed from there. Editing an existing rule's fields in place is not offered on any platform — the web overlay and RN inspector are add/toggle/delete too.
⁶ Android: mock rules (block / canned response / redirectTo / declarative `modify`, delayMs) plus named throttle profiles (fast-3g / slow-3g / edge / offline) with latency + bandwidth drip via an OkHttp ForwardingSource. `redirectTo` and `modify` route the match through `HakkaInterceptor.interceptRewrite` — the real request is issued via `chain.proceed` (URL/headers/query rewritten first via `request.newBuilder()`), then the real response's status/headers/body are transformed via `response.newBuilder()` with the body re-wrapped (`MockEngine.kt`'s `MockRuleTransform`). `block` throws an `IOException("Blocked by Hakka")` before any real request is sent and is still recorded as a completed capture. Parity with the TS engine's declarative surface; no `rewriteRequest`/`rewriteResponse` functions. Android ships a full mock-rule management screen (`ui/MocksPanel.kt`, reached via Rules → Mock): add by URL pattern + method + action (mock / redirect / block) with status, delay, body or target URL; per-rule hit count, enable/disable, edit, and delete. Rules created by the one-shot "Mock this" action in the detail overflow menu appear there and are managed from there. All four platforms now present the same Rules switch — **Mock | Breakpoints | Throttle**, in that order.
⁷ RN sort/group is implemented in `packages/hakka-react-native/src/ui/utils/groupSort.ts` using `hakka-core` types and `extractHost`; the UI exposes sort field, sort direction, and group-by pickers. The core `sortRequests`/`groupRequests` query engine is also available for RN callers.
⁸ All three native platforms stream canonical `{ type: "request", payload }` frames to the bridge hub (`hakka-bridge`), which forwards them to `hakka mcp`. RN uses `HakkaBridge` (WebSocket client in TS). iOS uses `HakkaBridgeClient` (Swift, `URLSessionWebSocketTask`). Android uses `BridgeSink` (Kotlin, OkHttp). The bridge also relays `{ type: "control", payload: ControlCommand }` frames peer-to-peer (never buffered): `hakka mcp`'s **write tools** (`create_mock` / `delete_mock` / `clear_mocks` / `set_breakpoint` / `delete_breakpoint` / `set_throttle`) drive the in-app mock/breakpoint/throttle engines through it. The contract lives in `hakka-core` (`parseControlCommand` / `applyControlCommand`, strict + fail-open, remote ids replace-by-id). Control-frame consumers: web ● (worker → main-thread engines) · RN ● (`HakkaBridge`) · iOS ● (`HakkaBridgeClient` receive loop + `Common/ControlCommand.swift`) · Android ● (`BridgeSink`'s `WebSocketListener.onMessage` + `hakka-network/ControlCommand.kt`, replace-by-id added to `MockEngine`/`BreakpointEngine`). `search_requests` also accepts the advanced search DSL via its `query` param. URL encode/decode toggle: RN ships a Decoded/Raw toggle in `ContentTab.tsx` (`decodeUrl` from `hakka-core`); iOS ships the same toggle in `QueryParamsView` (`Common/UrlCodec.swift`'s `HakkaUrlCodec.decodeUrl`, mirroring core's fail-open semantics); Android ships it in `DetailActivity` via `UrlCodec.kt` (`decodeUrl`/`isUrlEncoded`, same fail-open semantics). Body search: web's `BodySearch` (`Detail.tsx`) and RN's `ContentTab`/`CodeBlock` ship inline search with next/prev + an n/m match counter; iOS mirrors it in `BodyContentCard` (`DetailBodyHelpers.swift`) via `MatchHighlightedBody`, an `AttributedString`-backed highlighter with the same active/dim match grammar; Android mirrors it in `DetailActivity` (debounced search bar, `‹ X/N ›` match-nav, span-highlighted focused match).

⁹ **Web** ships full client↔server trace correlation: the `hakka-next` full-stack case joins a browser request with the server hop it triggers into one timeline (verified — a `x-hakka-trace` id propagates client → server → upstream). **RN / iOS / Android** originate and stamp the `x-hakka-trace` header + `correlationId` on every outgoing request (iOS `RequestBuilder`, Android `HakkaInterceptor`, RN `correlationId` display). The **`hakka-node`** package (ADR 0001) reads that header on any Node backend (Fastify / Express / Hono / raw `http`), falls back to a W3C `traceparent`, and streams the server hop, so a native client's request joins its backend's capture into one causal chain, the same join `hakka-next` already does for the web (verified by `scripts/smoke-trace-correlation.mjs`). Native is trace-_joining_ when the backend runs `hakka-node`.

¹⁰ The `BodyDecoder` registry (gzip/deflate/SSE/protobuf-wire/gRPC-web) lives in `hakka-core` (`engine/decoders.ts`) and is invoked in the JS body renderers — RN (`ContentTab`) and web (`Detail`) call `bodyDecoders.decode(body, contentType, contentEncoding)` before display. iOS ports the same chain to Swift (`ios/Sources/Common/BodyDecoders`, wired into `DetailBodyHelpers`) and Android to Kotlin (`android/hakka-common`, wired into `DetailActivity`), each matching core's decoded-output format against the shared `decoders.test.ts` fixtures.

¹¹ `hakkaSpanProcessor()` (`packages/hakka-node/src/spanProcessor.ts`) attaches to an already-registered OTel `TracerProvider` (`attach()` is the SDK-1.x fallback; `hakkaSpanProcessor()` itself is the SDK-2.x-safe path, since 2.x removed post-registration `addSpanProcessor`) and surfaces Next.js's own request-tree spans (`BaseServer.handleRequest`, `AppRouteRouteHandlers.runHandler`, …) as `FrameworkSpan` records once `enableTraceSpans()` is on. `hakka-node`/`hakka-browser` only — no RN/iOS/Android OTel SDK integration exists, and core interceptors never emit `FrameworkSpan` themselves.

¹² `adoptOtelTraceId()` (`packages/hakka-node/src/trace.ts`) lets a root span's own OTel trace id become the request's `correlationId`, but only when no trace context exists yet — the pure SSR/document-navigation case where no `x-hakka-trace`/`traceparent` header was present. Called from `spanProcessor.ts`'s `onStart`. Web/`hakka-node` only; native platforms have no OTel span source to adopt an id from.

¹³ `TraceBadgeRow` (`packages/hakka-browser/src/ui/TraceBadgeRow.tsx`) renders a trace group's method/status/requestKind pills, fetch/operation counts, a cache summary line, and a "Slowest: `<label>` (`<duration>`)" callout computed from `TraceBadgeSummary`. Web only — no RN/iOS/Android trace-grouping UI exists to host it.

¹⁴ The same `TraceBadgeRow` renders a `.hakka-switch` toggle that flips a trace group's span list between only `'primary'`-classified spans and the full `'primary' | 'verbose'` set a `FrameworkSpan` carries (`spanProcessor.ts`'s `PRIMARY_SPAN_TYPES` classification). Web only.

¹⁵ `NetworkRequest.cacheStatus` (`packages/hakka-core/src/model/types.ts`) is never set by core interceptors — it's populated by `hakka-node`'s server capture (`next/serverCapture.ts`) reading a framework cache-status response header (Next.js `x-nextjs-cache` wins when present, else Vercel `x-vercel-cache`), then rendered as a `.hakka-rt-tag hakka-cache-<status>` pill in `RequestRow.tsx` and a `Cache` KVRow in `Detail.tsx`. Web/`hakka-node` only.

¹⁶ `FrameworkSpan.requestKind` (`'document' | 'rsc' | 'route-handler' | 'server-action'`) is classified per-trace by `classifyRequestKind()` in `spanProcessor.ts` from the `next.rsc` span attribute plus an inbound `server-action` header hint (`trace.ts`'s `requestKindHint`), then exposed as a segmented filter (`FilterBar.tsx`'s `requestKindFilter`) that narrows visible trace GROUPS by their root span's kind. Client-side only, shown while grouped by trace. Web only.

¹⁸ The web overlay wraps the inspector in a root error boundary (`CrashBoundary.tsx`, Solid's `<Errored>`): a crashed inspector renders a compact "Inspector crashed — reload" bar inside its own shadow root instead of freezing or unstyling the host page, and Reload tears down the entire crashed tree and mounts a fresh one. Captured traffic survives the reload — the store lives outside the UI tree (Worker/singleton). RN wraps the JS inspector root the same way (`hakka-react-native/src/ui/CrashBoundary.tsx`, a class component — React has no hooks-based error boundary): `HakkaInspector.tsx`'s `Wrapper` and `Standalone` both mount `InspectorUI` inside it, a caught crash swaps in a compact "Inspector crashed — reload" bar built from the shared design tokens, and Reload bumps a `generation` counter used as the wrapped children's `key`, which forces React to fully unmount the crashed tree and mount a fresh one rather than re-rendering in place. Captured traffic survives — `hakka-core`'s `Hakka` log store is a module-level singleton outside the React tree, untouched by the remount. iOS/Android native panels ride the host app's native exception model — a boundary of this kind is not offered.
¹⁹ Switching rows in the web Detail keeps the previous request's body visible (dimmed while `isPending`) while the next body hydrates asynchronously, instead of flashing an empty state (`Detail.tsx` async memo + `<Loading>`). iOS/Android read bodies in-process with no async gap, so there is nothing to revalidate (out of scope by design). RN fetches bodies over the bridge (async) — roadmap.
¹⁷ All four platforms capture WebSocket connections and frames: RN and web through core's JS interceptor (`capture/websocket.ts`), iOS through `WebSocketMonitor.swift`, Android through `HakkaWebSocketWrapper.kt`. The sub-protocol frame-decoder registry (MQTT / Socket.IO / STOMP / graphql-ws) is now implemented on all four: `engine/wsDecoders.ts` in core-TS, ported to Swift in `ios/Sources/Common/BodyDecoders/WsFrameDecoders+*.swift` and to Kotlin in `android/hakka-common/.../{Mqtt,SocketIo,Stomp,GraphqlWs}WsDecoder.kt`, each verified against the TypeScript fixtures. Native panels render the decoded kind and payload summary, falling back to raw frame text when no decoder matches. Server-side outbound WebSocket capture (`hakka-node`) is not offered on any platform.

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
