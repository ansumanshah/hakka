---
title: Capture inside a React Native WebView
description: Run hakka-browser inside react-native-webview, bridged to the same hub as your RN app, so WebView traffic stops being a blind spot.
---

Every RN network tool — Hakka included, in `native`/`auto` mode — sees native and JS-layer
traffic. None of them see requests made **inside** a `react-native-webview`: that content
runs in its own WebKit/Chromium process with its own `fetch`/`XHR`, invisible to RN's
network layer entirely.

`hakka-browser` is a self-contained browser bundle. Load it inside the WebView's page and point
its desktop-bridge client at the same hub your RN app connects to. Both peers land in one
stream — the desktop app (or `hakka mcp`) sees WebView and RN requests interleaved, correctly
ordered, no blind spot.

A working example screen lives at
`examples/react-native-example/WebViewCaptureScreen.tsx`. This
page is the same recipe, start to finish.

## 1. Install `react-native-webview`

In your **app**, not in a Hakka package:

```bash
bun add react-native-webview
```

## 2. Build hakka-browser and copy the IIFE bundle

```bash
bun run --cwd packages/hakka-browser build          # produces packages/hakka-browser/dist/hakka-browser.global.js
```

`hakka-browser.global.js` is a self-contained IIFE — it inlines the capture engine, the Solid UI
(lazy-chunked), and the inline-blob store Worker. Copy it into your app so it can be injected
into the WebView's page. Don't `require()` the `.js` file directly from RN code: it's a
browser-only bundle that touches `window`/`document` at module scope, and Metro would try to
bundle-and-run it inside the RN JS engine (Hermes) if you imported it as a normal module,
which throws immediately.

The example app's `scripts/copy-hakka-browser.js` does the safe version of this: it copies the
raw file for inspection, and also writes a `{ "code": "<escaped source>" }` JSON wrapper next
to it, so Metro/TypeScript import it as **data** (`resolveJsonModule`) instead of source:

```bash
bun run --cwd examples/react-native-example copy:hakka-browser
```

Re-run this after every `packages/hakka-browser` build. The output (`assets/hakka-browser.global.js`,
`assets/hakka-browser.global.json`) is gitignored in the example — regenerate it, don't commit a
stale copy.

## 3. Build the local WebView page

```ts
import hakkaWebBundle from './assets/hakka-browser.global.json'

const html = `<!doctype html>
<html>
  <body>
    <script>${hakkaWebBundle.code}</script>
    <script>
      Hakka.start({ overlay: false })
      Hakka.connect('ws://${bridgeHost}:8989')
      // fire your fetches, or let the page's own code make them
    </script>
  </body>
</html>`
```

Render it with `source={{ html, baseUrl: 'http://localhost/' }}` — see the caveat below on
why `baseUrl` matters.

## 4. Start the bridge hub

```bash
npx hakka-bridge
```

Both peers now target `ws://<host>:8989`:

- The RN app connects however it already does (`Hakka.start()` + the Settings panel's
  "Connect to desktop" toggle, or `hakkaBridge.connect()` directly) — see
  [Bridge overview](/bridge/overview/).
- The WebView's `hakka-browser` instance calls `Hakka.connect('ws://<host>:8989')` as shown above.

## 5. Verify — the falsifiable proof

Don't take a screenshot as proof that this works. The example screen posts a structured
result back to RN and renders it as text:

```ts
// inside the WebView page
window.ReactNativeWebView.postMessage(JSON.stringify({ usingWorker: probeWorkerSupport(), captureCount: logs.length }))
```

```tsx
// in RN
<WebView onMessage={(e) => setResult(JSON.parse(e.nativeEvent.data))} />
```

`captureCount` comes straight from `await Hakka.getLogs()` — the real capture store, not a
guess. `usingWorker` needs one caveat: `StoreClient.usingWorker` is a private field inside
`hakka-browser`'s worker client (`packages/hakka-browser/src/worker/storeClient.ts`) and is not part of the
public API — this recipe doesn't patch SDK source to expose it. The example instead runs an
**independent probe** that mirrors the exact condition `createStoreClient()` uses internally
(`Worker` global present, and a blob-URL `Worker` actually constructs without throwing):

```ts
function probeWorkerSupport() {
  if (typeof Worker === 'undefined') return false
  try {
    const url = URL.createObjectURL(new Blob(['self.close()'], { type: 'application/javascript' }))
    const w = new Worker(url)
    w.terminate()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}
```

Same failure mode a restrictive `worker-src` CSP would trigger against hakka-browser's own
inline-blob Worker — an honest proxy for which backend is active, not a claim of reading the
private flag.

## Unified timeline

Both `hakka-browser` (in the WebView) and `hakka-react-native` (in the RN app) send the same wire
format — one JSON frame per captured request — to whichever peers are connected. The hub
(`hakka-bridge`) buffers and fans frames out to every other connected peer, so a desktop
viewer or `hakka mcp` sees one interleaved, chronologically-correct stream: a WebView `fetch`
next to the RN `fetch` that triggered opening the WebView, next to the server-side request it
in turn caused (if `hakka-node/next` is instrumented on the backend). No manual correlation, no
separate log to cross-reference — see [Bridge overview](/bridge/overview/) for the frame
format and [Trace correlation](/concepts/trace-correlation/) for linking client → server work.

## ATS / cleartext / local-networking caveats

`hakka-bridge` binds `127.0.0.1` only by default (`packages/hakka-bridge/src/server.ts`,
`DEFAULT_BRIDGE_HOST`). What reaches it depends on where the RN app runs:

| Target                  | Bridge host to use                                                 | Native config needed                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS Simulator           | `localhost`                                                        | None — the simulator shares the host Mac's loopback interface.                                                                                                                   |
| Android Emulator        | `10.0.2.2` (or `localhost` with `adb reverse tcp:8989 tcp:8989`)   | Debug builds need `usesCleartextTraffic="true"` (RN's default debug manifest already sets this).                                                                                 |
| iOS physical device     | your Mac's LAN IP (`ipconfig getifaddr en0`)                       | `NSAllowsLocalNetworking: true` in `Info.plist` for non-TLS traffic to LAN IPs; may also trigger the iOS 14+ Local Network permission prompt (`NSLocalNetworkUsageDescription`). |
| Android physical device | your machine's LAN IP, or `adb reverse tcp:8989 tcp:8989` over USB | Cleartext must be allowed for that host (debug `usesCleartextTraffic`, or a Network Security Config entry in release).                                                           |

For LAN-IP access (either physical-device row), the hub itself must also opt in — the
`npx hakka-bridge` CLI has **no `--host` flag** and always binds loopback-only. Use the
programmatic API instead:

```ts
import { startBridgeServer } from 'hakka-bridge'

await startBridgeServer({ host: '0.0.0.0' }) // LAN-reachable — trusted networks only
```

Do this only on a network you trust: once the hub accepts non-loopback connections, anyone
who can reach the port can read every captured request/response body (see the trust-model
note in `packages/hakka-bridge/src/server.ts`).

The example app's native shells already carry the simulator/emulator-level exceptions above
(`Info.plist` sets `NSAllowsLocalNetworking`, the debug `AndroidManifest.xml` sets
`usesCleartextTraffic`) — no changes needed to run the recipe on a simulator or emulator.

### Why `baseUrl: 'http://localhost/'`

`hakka-bridge` only accepts WebSocket `Origin` headers of `localhost`/`127.0.0.1`/`[::1]` (or
an explicit `allowedOrigins` entry) — see `isOriginAllowed` in `packages/hakka-bridge/src/server.ts`.
A bare `source={{ html }}` load (no `baseUrl`) gets an opaque origin in most WebView
implementations, which fails that check and the WS handshake is rejected with code `1008`.
Setting `baseUrl: 'http://localhost/'` gives the page a real `http://localhost` origin that
passes the check — no network request is made to that URL, it only anchors the document's
origin.

## CSP note

If your real app wraps this page in a stricter CSP than the example (e.g. a
`<meta http-equiv="Content-Security-Policy">` tag), make sure `worker-src` allows `blob:` —
that's what hakka-browser's inline store Worker needs to construct. If it's blocked, hakka-browser
falls back to running the same store in-process on the main thread automatically —
feature-identical, just without the Worker's off-main-thread benefit. `usingWorker` (or the
probe above) is how you'd notice the fallback happened.

## Limitations

- `usingWorker` in the postMessage payload is a same-technique **probe**, not a read of
  hakka-browser's private `StoreClient.usingWorker` field — see the verification section above.
- The bridge hub is loopback-only by default and has no TLS or per-peer auth beyond origin
  checks and an optional shared token — it's a local dev tool, not something to expose beyond
  a trusted network.
- `npx hakka-bridge` (the CLI) cannot bind a non-loopback host — use `startBridgeServer`
  directly if you need `0.0.0.0`/a LAN address for physical-device testing.
