---
title: Capture scope & limitations
description: What Hakka web captures, what it can't, and why — including Web Workers, Service Workers, and Partytown.
---

Hakka web captures by patching the network primitives **on the main thread**: `fetch`,
`XMLHttpRequest`, `WebSocket`, and `navigator.sendBeacon`, plus the Performance Timeline for
resource timing. Server-side traffic is captured separately by `hakka-node/next` and streamed into
the same overlay.

## Captured

- **`fetch` / `XHR` / `sendBeacon`** issued from the page's main thread (your app code and any
  third-party script that runs normally on the page).
- **WebSocket** connections and frames (text and binary; binary frames are captured as
  base64). The negotiated sub-protocol is recorded, and a pluggable **frame-decoder registry**
  decodes known protocols: **MQTT, socket.io, STOMP, and graphql-ws** ship built-in (packet
  type, topic/destination, payload), and you can register your own.
- **Resource Timing** (DNS/TCP/TLS/TTFB/download) for fetch/XHR via `PerformanceObserver`.
- **Server + edge** requests (Node `http`/`https` and `fetch`) via `hakka-node/next`, correlated
  with the client view over the dev bridge.

## Not captured (and why)

Hakka patches the **main-thread** globals. Code that makes network calls from a _different
JavaScript context_ uses that context's own globals, which Hakka never sees:

- **Web Workers** — by default a worker's `fetch`/`XHR`/`WebSocket` use the worker-global
  versions the main-thread patches don't see. You can opt in (see "Capturing worker traffic").
- **Service Workers** — fetches made _inside_ a service worker run in the SW context.
- **Partytown** — third-party scripts moved off the main thread with
  [Partytown](https://github.com/QwikDev/partytown) run inside a **Web Worker**. In **both**
  Partytown modes (Atomics and service-worker), the sandboxed script's `fetch`/`XHR`/
  `sendBeacon` call the _worker-global_ APIs directly — Partytown's main-thread proxy only
  forwards **DOM** operations, not the script's own network calls. `forward`-ed calls
  (`gtag(...)`, `dataLayer.push(...)`) execute in the worker too. So analytics/tag-manager
  traffic you've intentionally moved into Partytown is **invisible to Hakka** unless Partytown
  is configured to load the worker shim (its worker bundle is sealed, so this needs
  Partytown-side wiring; see below).
- **Browser-native subresource loads** (`<img>`, `<script>`, `<link>`) beyond the metadata the
  Performance Timeline exposes.

## Capturing worker traffic

For a Web Worker you control, opt in with the shim:

```ts
// inside your worker
import { captureInWorker } from 'hakka-browser/worker'
captureInWorker()
```

```ts
// main thread
start({ captureWorkers: true })
```

The shim patches the worker's own fetch/XHR/WebSocket and posts each record to the main
thread, where Hakka ingests it into the same store the overlay reads. For **Partytown** the
same shim works in principle, but its worker bundle is sealed, so you'd need to configure
Partytown to load it; until then, keep analytics/tags on the main thread while debugging.
Service Workers and native subresource loads remain out of scope.
