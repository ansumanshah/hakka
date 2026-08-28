---
title: CDP Capture
description: Chrome DevTools Protocol Network-domain capture for Hakka, over any transport shaped like a CDP session.
---

`hakka-cli/cdp` maps Chrome DevTools Protocol (CDP) `Network` domain events —
`Network.requestWillBeSent` / `responseReceived` / `loadingFinished` / `loadingFailed` /
`dataReceived` (plus the `*ExtraInfo` header events) — to canonical Hakka `NetworkRequest`
records, the same shape `hakka-core`'s fetch/XHR interceptors and `hakka-node`'s server capture
produce. One UI can show browser, Node, and CDP-driven traffic side by side.

`createCdpCapture` has no dependency on Playwright or Puppeteer. It accepts **any** transport
shaped like `CdpTransport`:

```ts
interface CdpTransport {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  on(event: string, listener: (params: unknown) => void): void
  off?(event: string, listener: (params: unknown) => void): void // optional
}
```

Playwright's `CDPSession`, Puppeteer's `CDPSession`, and a raw `ws` client that resolves `send()`
by matching CDP's `{id, result}` response frames to outstanding `{id, method, params}` calls all
satisfy this without an adapter.

## Install

```bash
npm install hakka
```

## Setup — Playwright

```ts
import { createCdpCapture } from 'hakka-cli/cdp'

const cdpSession = await page.context().newCDPSession(page)

const capture = createCdpCapture({
  transport: cdpSession,
  onRequest: (req) => console.log(req.method, req.status, req.url, `${req.duration}ms`),
})

await capture.start()
// ... drive the page ...
await capture.stop()
```

## Setup — Puppeteer

Puppeteer's `Page` and `CDPSession` satisfy `CdpTransport` the same way:

```ts
import { createCdpCapture } from 'hakka-cli/cdp'

const client = await page.createCDPSession()

const capture = createCdpCapture({
  transport: client,
  onRequest: (req) => console.log(req.method, req.status, req.url, `${req.duration}ms`),
})

await capture.start()
// ... drive the page ...
await capture.stop()
```

## Setup — raw `ws` transport

No browser-automation library at all — a WebSocket connected to a target's
`webSocketDebuggerUrl` (from Chrome's `/json` endpoint when launched with
`--remote-debugging-port`), implementing `CdpTransport` by matching `{id, result}` response
frames:

```ts
import { createCdpCapture, type CdpTransport } from 'hakka-cli/cdp'
import WebSocket from 'ws'

function createRawCdpTransport(webSocketDebuggerUrl: string): CdpTransport {
  const ws = new WebSocket(webSocketDebuggerUrl)
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  const listeners = new Map<string, Set<(params: unknown) => void>>()

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)!
      pending.delete(msg.id)
      msg.error ? reject(msg.error) : resolve(msg.result)
    } else if (msg.method) {
      listeners.get(msg.method)?.forEach((cb) => cb(msg.params))
    }
  })

  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener)
    },
  }
}

const capture = createCdpCapture({
  transport: createRawCdpTransport('ws://localhost:9222/devtools/page/<targetId>'),
  onRequest: (req) => console.log(req.method, req.status, req.url),
})
await capture.start()
```

## Emission model

Each request emits through `onRequest` at up to three points in its life, all sharing the same
`id`:

1. **Pending** — `requestWillBeSent` fires. No status yet.
2. **Updated** — `responseReceived` fires. Status and headers are known.
3. **Final** — `loadingFinished`/`loadingFailed` fires. Body, timing, and duration are attached.

This mirrors how `hakka-core`'s own fetch/XHR interceptors and `hakka-node`'s `http`/`https`
interceptor report a request — a consuming store is expected to dedupe/merge by `id`, not treat
every `onRequest` call as a new record. In practice a request can emit **more** than three times:
if a `*ExtraInfo` header event (`requestWillBeSentExtraInfo`/`responseReceivedExtraInfo`) arrives
_after_ its matching main event, the mapper merges the extra headers into the live entry and
re-emits — same `id`, so a dedupe-by-`id` consumer handles it either way.

## Redirects

A redirect chain (same CDP `requestId`, several `requestWillBeSent` events) is split into one
finalized `NetworkRequest` per hop — each hop keeps its own status/headers, and every hop after
the first carries `redirectCount`, `redirectChain` (prior hops' `id`s), and `redirectUrls` (prior
hops' URLs). The public `id` for hop _N_ (N > 1) is `${cdpRequestId}#${N}`; hop 1 keeps the bare
CDP `requestId`.

## Options

```ts
createCdpCapture({
  transport,
  onRequest,
  captureBody: true, // fetch the decoded response body via Network.getResponseBody
  maxBodySize: 100 * 1024, // applied to non-base64 (text) bodies only
  redactHeaders: ['authorization', 'cookie' /* … */], // defaults to hakka-core's DEFAULT_SENSITIVE_HEADERS
  runtime: 'client', // tag applied to every emitted record
})
```

| Option          | Type                            | Default                                    | Description                                                                                                                                                           |
| --------------- | ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport`     | `CdpTransport`                  | — (required)                               | Any object shaped like `{ send, on, off? }`.                                                                                                                          |
| `onRequest`     | `(req: NetworkRequest) => void` | — (required)                               | Called at each emission point described above.                                                                                                                        |
| `captureBody`   | `boolean`                       | `true`                                     | Fetch the decoded response body via `Network.getResponseBody` at `loadingFinished`. `false` skips the round-trip entirely — status/headers/timing are still captured. |
| `maxBodySize`   | `number`                        | `102400` (100 KB)                          | Cap applied to **non-base64** (text) bodies only.                                                                                                                     |
| `redactHeaders` | `string[]`                      | `hakka-core`'s `DEFAULT_SENSITIVE_HEADERS` | Header names/globs to redact (case-insensitive, `*`-glob-capable).                                                                                                    |
| `runtime`       | `RequestRuntime`                | `'client'`                                 | Tag applied to every emitted record — CDP `Network` events describe page-driven traffic, same bucket as browser fetch/XHR captures.                                   |

Binary responses (`base64Encoded: true` from CDP) are kept **whole** with `encoding: 'base64'`
rather than truncated — re-truncating an already-decoded binary payload would make it
undecodable. When a base64 body's _estimated decoded size_ exceeds `maxBodySize`, the payload is
dropped entirely (not truncated mid-base64) and the record is flagged
`responseBodyTruncated: true` with `responseBodySize` set to the estimate.

`start()`/`stop()` are both idempotent, and `stop()` never throws — even if the transport is
already closed (`Network.disable` rejecting is swallowed) — since a transport closing out from
under a capture is a normal way for `stop()` to get called.

## Streaming to a bridge hub

```ts
import { createCdpCapture, bridge } from 'hakka-cli/cdp'

const capture = createCdpCapture({
  transport: cdpSession,
  onRequest: bridge().send, // ws://localhost:8989 by default
})
```

`bridge(url)` opens a WebSocket client to a `hakka-bridge` hub and sends the same
one-frame-per-request envelope (`{ type: 'request', payload: NetworkRequest }`) that
`hakka-node`'s bridge client and the browser overlay's `desktopBridge` use — so a `hakka-bridge`
hub (or the browser overlay's "Connect to desktop" toggle) renders CDP captures alongside
everything else. The client auto-reconnects with exponential backoff and queues frames (capped
at 1000 records / 5 MB serialized) while offline. `createCdpBridgeClient(options)` is the
underlying factory if you need the `connected` status or a non-default `url`/`onStatus`.

See [Bridge overview](/bridge/overview/) for how the hub relays and replays frames.

## Production safety

`hakka-cli/cdp` has **no built-in dev/production gate** — no `NODE_ENV` check, no `force` flag. It's
driven entirely by when you call `capture.start()`/`capture.stop()`, which is the caller's
responsibility. This is by design: `hakka-cli/cdp` is meant for driver code — test harnesses,
browser-automation scripts, an Electron main process — not something embedded in application
runtime code the way `hakka-node`'s `register()` is. If you wire it into a long-running service,
gate the `start()` call yourself the same way you'd gate any other debug-only instrumentation.

CDP-sourced records also carry no `correlationId` — trace correlation (linking a request across
client/server hops) is a `hakka-node`/`hakka-browser` concept that doesn't apply to CDP
captures.

## See also

- [Bridge overview](/bridge/overview/) — how the hub relays and replays frames.
- [hakka-node overview](/node/overview/) — the server-side counterpart with the same
  `{ type: 'request', payload }` bridge envelope.
- [Capture spec](/spec/capture/) — the `NetworkRequest` shape and body-decoding pipeline.
