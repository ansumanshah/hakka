---
title: Comparison
description: How Hakka's web inspector compares to vConsole, eruda, Pulse, Chucker, Wormholy, and react-native-network-logger.
---

Hakka web is a **mobile-browser-first in-app network inspector** — the same job as
[vConsole](https://github.com/Tencent/vConsole) and [eruda](https://github.com/liriliri/eruda):
debug on a real phone browser where there are no DevTools. The difference is what runs
underneath. Hakka's store, search, retention, and export all run **off the main thread in a
Web Worker**, and the same capture contract powers the React Native, iOS, and Android SDKs —
so what you learn debugging the web works everywhere.

## Why Hakka

- **It barely touches your main thread.** Per-request capture overhead is **~9.6µs** vs
  **~46µs** for vConsole — over **4× lighter** (median of 3 idle-machine reps: 9.61µs vs 45.71µs) — because the store, dedup, filtering,
  and HAR/OTel/Postman serialization all run in a Worker, not on the UI thread. And that
  ~9.6µs buys strictly more capture: trace-header injection, timing phases, GraphQL and
  cache detection, redaction, bounded-memory body reads. See
  [Benchmarks](/reference/benchmarks/).
- **It debugs the whole request, not just the client.** Server-side capture (Node / Next.js)
  streams into the same overlay, so one timeline shows the server and client hops. WebSocket
  frames and GraphQL operations are first-class.
- **It can change traffic, not just watch it.** Mock / redirect / block rules, request- and
  response-phase **breakpoints** (pause and edit in flight), throttle profiles, and one-click
  replay.
- **It exports to real formats.** HAR, OpenTelemetry, Postman Collection, and shell-safe
  cURL — not a screenshot.
- **It isolates cleanly.** The UI renders in a Shadow-DOM custom element, lazy-loaded on
  first open, so it can't collide with your page's styles and costs nothing until used.

## Capability matrix

Legend: ● shipped · ◐ partial · ○ roadmap · — not offered · ⊘ out of scope.

The first three columns are the direct web in-app inspectors; the rest are best-in-class
native tools included for feature reference.

### Capture

| Capability                              | Hakka&nbsp;web | vConsole | eruda | Pulse | Chucker | Wormholy | rnnl |
| --------------------------------------- | :------------: | :------: | :---: | :---: | :-----: | :------: | :--: |
| fetch / XHR / sendBeacon                |       ●        |    ●     |   ◐   |   ●   |    ●    |    ●     |  ◐   |
| WebSocket frames (sent + received)      |       ●        |    ●     |   —   |   —   |    —    |    —     |  —   |
| Resource Timing (PerformanceObserver)   |       ●        |    ●     |   —   |   —   |    —    |    —     |  —   |
| GraphQL operation detection             |       ●        |    —     |   —   |   —   |    —    |    —     |  ●   |
| Server-side capture unified with client |       ●        |    —     |   —   |   ◐   |    —    |    —     |  —   |
| Trace correlation (client ↔ server)     |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |
| Header redaction (sensitive masking)    |       ●        |    —     |   —   |   ●   |    ●    |    —     |  —   |
| Pause / resume (buffer, don't drop)     |       ●        |    —     |   ◐   |   —   |    —    |    —     |  ●   |
| Body-size cap + truncation              |       ●        |    ◐     |   ◐   |   ●   |    ●    |    —     |  ◐   |
| Off-main-thread (Worker) store          |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |

vConsole's WebSocket-frame and Resource-Timing capture are on its unreleased `dev` branch
(3.16.0-alpha at the time of writing) — the latest published release (3.15.1) has neither.
Its columns reflect current source, per the methodology below.

### Inspect / detail

| Capability                             | Hakka&nbsp;web | vConsole | eruda | Pulse | Chucker | Wormholy | rnnl |
| -------------------------------------- | :------------: | :------: | :---: | :---: | :-----: | :------: | :--: |
| Timing waterfall (DNS/TCP/TLS/TTFB/dl) |       ●        |    —     |   —   |   ●   |    —    |    —     |  —   |
| JSON tree viewer                       |       ●        |    ◐     |   ●   |   ●   |    ●    |    —     |  ●   |
| Image inline preview                   |       ●        |    ◐     |   ●   |   ●   |    ●    |    —     |  —   |
| Body search (next/prev + highlight)    |       ●        |    —     |   —   |   ●   |    ●    |    ●     |  —   |
| Cookie inspector (per request)         |       ●        |    —     |   ◐   |   ●   |    —    |    —     |  —   |
| URL encode/decode toggle               |       ●        |    —     |   —   |   —   |    ●    |    —     |  —   |
| Replay request                         |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |

### List · search · filter

| Capability                                    | Hakka&nbsp;web | vConsole | eruda | Pulse | Chucker | Wormholy | rnnl |
| --------------------------------------------- | :------------: | :------: | :---: | :---: | :-----: | :------: | :--: |
| Virtualized / recycling list                  |       ●        |    ●     |   —   |   ●   |    ●    |    —     |  ◐   |
| Status-code chip filter                       |       ●        |    —     |   —   |   ●   |    —    |    ●     |  ◐   |
| Content-type / method filter                  |       ●        |    —     |   ◐   |   ●   |    —    |    —     |  ◐   |
| Text search                                   |       ●        |    —     |   ●   |   ●   |    ●    |    ●     |  ●   |
| Sort by time / duration / size / status       |       ●        |    —     |   ●   |   ●   |    —    |    —     |  ◐   |
| Group by host / status / method               |       ●        |    —     |   —   |   ●   |    —    |    —     |  —   |
| Advanced search (regex · scoped · AND/OR/NOT) |       ●        |    —     |   —   |   ●   |    —    |    —     |  —   |
| Duration / size range filter                  |       ●        |    —     |   —   |   ●   |    —    |    —     |  —   |
| Saved / recent filters                        |       ●        |    —     |   —   |   ●   |    —    |    ◐     |  —   |

### Debug · mock · throttle

| Capability                                    | Hakka&nbsp;web | vConsole | eruda | Pulse | Chucker | Wormholy | rnnl |
| --------------------------------------------- | :------------: | :------: | :---: | :---: | :-----: | :------: | :--: |
| Mock / canned response                        |       ●        |    —     |   —   |   ◐   |    —    |    —     |  —   |
| Redirect / map-local                          |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |
| Block request                                 |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |
| Request + response breakpoints (pause & edit) |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |
| Throttle profiles (3G/edge/offline)           |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |

### Export · share

| Capability                            | Hakka&nbsp;web | vConsole | eruda | Pulse | Chucker | Wormholy | rnnl |
| ------------------------------------- | :------------: | :------: | :---: | :---: | :-----: | :------: | :--: |
| Copy cURL                             |       ●        |    ◐     |   ●   |   ●   |    ●    |    ●     |  ●   |
| Copy as `fetch()` code                |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |
| HAR export                            |       ●        |    —     |   —   |   ●   |    ●    |    —     |  ●   |
| OpenTelemetry export                  |       ●        |    —     |   —   |   —   |    —    |    —     |  —   |
| Postman Collection export             |       ●        |    —     |   —   |   —   |    —    |    ●     |  —   |
| Filtered-subset / multi-select export |       ●        |    —     |   —   |   ●   |    ●    |    —     |  —   |

### Panels · platform · UX

| Capability                                 | Hakka&nbsp;web | vConsole | eruda | Pulse | Chucker | Wormholy | rnnl |
| ------------------------------------------ | :------------: | :------: | :---: | :---: | :-----: | :------: | :--: |
| Console / Storage / Info panels            |       ●        |    ●     |   ●   |   —   |    —    |    —     |  —   |
| Stats / analytics panel                    |       ●        |    —     |   —   |   ◐   |    —    |    ●     |  —   |
| Shadow-DOM isolation                       |       ●        |    —     |   ●   |   —   |    —    |    —     |  —   |
| Draggable entry button                     |       ●        |    ●     |   ●   |   —   |    —    |    —     |  —   |
| Dark / light theme                         |       ●        |    ●     |   ●   |   ●   |    ●    |    ●     |  ●   |
| Plugin system                              |       ●        |    ●     |   ●   |   —   |    ◐    |    —     |  —   |
| Cross-platform engine (RN / iOS / Android) |       ●        |    —     |   —   |   ●   |    —    |    —     |  ◐   |
| Elements/DOM · Sources · JS REPL panels    |       ⊘        |    ●     |   ●   |   —   |    —    |    —     |  —   |

## What Hakka deliberately leaves out

Hakka is a **network** inspector with a shared cross-platform core, not a DevTools clone.
Three things vConsole/eruda ship that Hakka intentionally does not:

- **Elements / DOM tree, computed styles, box model**
- **Sources viewer**
- **JS snippets / REPL**

These are browser-only and have no React Native / iOS / Android equivalent. Including them
would split the product's focus and break the "what you learn here works everywhere"
promise. For DOM and CSS debugging on a desktop browser, Chrome DevTools is already
excellent; Hakka's job is the request — server, client, sockets, and GraphQL — on every
platform.

## Reference tier

The matrix above is Hakka's direct competitive set — other **web in-app inspectors**.
The tools below solve adjacent problems: system-wide traffic proxies for apps you
don't own, test-mocking libraries, a state debugger, a DevTools plugin framework,
a remote-session tool, and an API client. None of them compete capability-for-
capability with an in-app inspector, so scoring them against the matrix above would
misrepresent both sides.

### System proxies: Proxyman, Charles, mitmproxy, HTTP Toolkit

All four are HTTP(S) debugging proxies: install a trusted root certificate, route
traffic through the proxy, and it decrypts, displays, and can rewrite anything that
passes through it — from any app on the machine or device, not only the one you
built.

- **Proxyman sees any app on the machine; Hakka only sees the one you instrument.**
  [Proxyman](https://proxyman.com) is the mobile-capture incumbent: a native
  macOS/Windows app with one-click interception, Map Local/Remote, breakpoints,
  scripting, and its own MCP server. That's the right tool for apps you don't own
  and can't add code to. Hakka's in-process capture has no proxy and no
  certificate to trust, so it keeps working on pinned connections a proxy
  structurally can't see (below), and it's safe to leave running in a release
  build because it only sees calls made through code you added. Proxyman also
  ships **[Atlantis](https://github.com/ProxymanApp/atlantis)**, a free
  iOS/Android SDK that captures in-process via method swizzling and streams to
  the desktop app over Bonjour — the same "SDK, not a wire tap" shape as Hakka,
  built by a proxy vendor as a tacit admission that MITM breaks on pinned
  traffic. No integration exists between the two today; Atlantis's wire protocol
  is MIT-licensed, so a Hakka-side adapter that accepts Atlantis frames is a
  studied idea, not a shipped one. Many developers reasonably run both — Proxyman
  for apps they don't control, Hakka for the one they're building.
- **Charles has the same reach as Proxyman, and none of its pinning workaround.**
  [Charles](https://www.charlesproxy.com) is one of the oldest cross-platform
  HTTP debugging proxies (Java, Windows/Mac/Linux, in continuous development
  since the mid-2000s) — the same throttling, breakpoints, and Map Remote
  toolkit as Proxyman, minus an Atlantis-style in-process bypass. The gap versus
  Hakka is the same as Proxyman's; it's sharper on pinned mobile traffic, since
  Charles has no SDK fallback at all.
- **mitmproxy trades the GUI for a scripting language.** [mitmproxy](https://mitmproxy.org)
  is open source and Python-hookable, with `mitmdump` for CLI/CI use ("tcpdump
  for HTTP") and `mitmweb` for a browser interface — the most programmable
  interception of the four. Same proxy-vs-SDK gap versus Hakka; using mitmproxy
  as an additional capture source for traffic Hakka doesn't instrument is a
  studied idea for later, not a shipped feature.
- **HTTP Toolkit is the only one of the four that's fully open source**, UI
  through proxy internals (its own Mockttp library), with one-click interception
  for browsers, most backend languages, Android, and Electron apps. [HTTP
  Toolkit](https://httptoolkit.com)'s gap versus Hakka is the same as the other
  three; separately, its docs and SEO investment is worth studying as a
  reference for making a dev tool findable.

:::note[Why proxies can't see pinned traffic]
A MITM proxy works by installing a root certificate the OS is told to trust,
then presenting its own certificate in place of the real server's — decrypting
and re-encrypting traffic in the middle. Certificate or public-key pinning makes
the app check the server's actual certificate (or its public key) against a
value baked in at build time, instead of trusting whatever the OS considers
valid. The proxy's substituted certificate fails that check, so the connection
is refused — trusting the root certificate doesn't help, because pinning
bypasses the OS trust store entirely.

Hakka never sits on the wire. It captures inside the app's own process — at the
`fetch` / `URLSession` / `OkHttp` call site on the client, or in the Node/Next.js
runtime on the server — before TLS negotiation happens on the client, or after
it's already been terminated on the server. There's no substituted certificate
for the app to reject, so pinning has no bearing on whether Hakka can see the
request.
:::

### Test mocking: MSW

MSW is the standard for test fixtures; Hakka is the standard for what actually
happened. **[Mock Service Worker](https://mswjs.io)** intercepts `fetch`/XHR in
the browser (via a real Service Worker) or Node's request internals, and returns
canned, hand-written responses — the same handler reused across unit,
integration, and E2E tests, no live server needed. Hakka's Mock rules are for
live, interactive debugging of a request actually in flight, not a hypothetical
one written ahead of time — a different problem, not a smaller version of the
same one. Interop is ● shipped: `buildMswHandlers` exports captured traffic
straight to an MSW handler file, and `parseMswHandlers` imports MSW handler
modules back as Hakka mock rules, so one fixture works in both places.

### State debugging: Reactotron

Reactotron sees your whole app's state; Hakka only sees its network calls — and
goes deeper on those than Reactotron's network log does. **[Reactotron](https://github.com/infinitered/reactotron)**
is Infinite Red's debugger for React/React Native: Redux/MobX-State-Tree state
trees, a "hot swap state" console, benchmarks, AsyncStorage inspection, and a
basic network log, all in one desktop app. Network capture is Hakka's entire
product rather than one panel among several — WebSocket frames, GraphQL
detection, trace correlation, mock/throttle/breakpoints, and HAR/OTel/Postman
export all go past what Reactotron ships. Reactotron's custom-commands idea is
already covered by Hakka's shipped plugin system and control channel.

### React Native DevTools plugin: Rozenite

Rozenite lives inside a window RN developers already have open; Hakka is a
standalone inspector that also happens to work outside React Native.
**[Rozenite](https://rozenite.dev)** is Callstack's plugin framework for React
Native DevTools — install a plugin and it appears as a panel in the Hermes
debugger's own DevTools window, no extra server or browser tab, and plugins are
stripped from production builds automatically. Hakka's overlay covers ground
Rozenite doesn't (web, iOS/Android native, standalone use), and it's a full
network inspector rather than a plugin host. A Rozenite plugin is ◐ shipped as
an experimental package: `hakka-rozenite` surfaces Hakka's request list, detail,
and filters as a React Native DevTools panel, fed by the existing bridge frames.
Response-override from inside the panel is the known remaining gap, and the
package stays marked experimental while Rozenite's plugin API — still new and
evolving — settles.

### Remote session sharing: PageSpy

PageSpy debugs a device you're not holding, over a server you run; Hakka debugs
the app in front of you, with no server at all. **[PageSpy](https://www.pagespy.org)**
wraps a page's console/network/storage calls and streams them to a self-hosted
server so someone else can watch a live session in a browser, a WeChat/Alipay
mini-program, or a HarmonyOS app they aren't holding — genuinely wider platform
reach than Hakka has. Hakka runs entirely in-process, and it can edit traffic
(mock/redirect/breakpoint), not just observe it. Remote session sharing is ○ on
the roadmap: Hakka's bridge hub, canonical frame format, desktop app, and MCP
surface already cover most of the plumbing PageSpy needs — this closes the last
gap rather than starting from zero.

### Declarative traffic rules: Requestly

Requestly's rules are shareable data; Hakka's most powerful rules are still
code. Requestly is best known for declarative HTTP rules — mock, redirect (Map
Local), block, and header/response modification by pattern — shipped as a
browser extension and desktop interceptor. (Its GitHub repo now hosts a newer
Postman-alternative API client; the original open-source interceptor moved to a
separate [`requestly/interceptor`](https://github.com/requestly/interceptor)
repo.) Hakka's mock, redirect (Map Remote), and block rules are already
declarative pattern-matches — no function required — and a Requestly-style
declarative form for header/query/status/body find-replace is ● shipped too:
a rule's `modify` block (`setRequestHeaders`/`removeRequestHeaders`,
`setQueryParams`/`removeQueryParams`, `status`, `replaceBody`) is plain data,
so a team's full rule set — mock, redirect, block, and modify — is one JSON
file it can commit to the repo, persisted and sent over the control channel
like any other rule. Only the separate `rewrite` mode's
`rewriteRequest`/`rewriteResponse` transforms stay plain functions, which is
why those specifically still can't be persisted or sent over the wire.
Requestly's API client and page-insert-script features are ⊘ out of scope for
Hakka.

### API client: Yaak

Yaak authors requests by hand; Hakka captures the ones your app already sent.
**[Yaak](https://yaak.app)** is an offline-first, Tauri + Rust + React API
client — a Postman/Insomnia alternative for composing and sending
REST/GraphQL/gRPC/WebSocket/SSE requests, with Git-syncable, file-based
workspaces. It's the right tool for building up collections, environments, and
history from scratch over a session; Hakka has no authoring surface today — it
only shows what actually happened, with the real headers, timing, and auth that
were actually sent. Interop already works, not just planned: Hakka's Postman
Collection and cURL exports both import into Yaak — and any Postman/Insomnia-
compatible client — so a captured request becomes a reusable, hand-editable one
in one step.

## Methodology

Capture-overhead numbers are reproducible with `bun run --cwd packages/hakka-bench bench` (median of
3 reps, 40,000 requests against an instant-resolving stub, fresh `fetch` patch per tool).
Feature columns are derived from each tool's current source and documentation. Corrections
welcome — open an issue.
