---
title: hakka-node
description: Framework-agnostic server-side network capture for Node backends, with W3C traceparent-compatible trace correlation.
---

`hakka-node` instruments `fetch` and Node `http`/`https` in any Node backend — plain `http`,
Express, Fastify, Hono, or anything else running on Node — and streams captures to the Hakka
bridge hub so the browser overlay shows server and client requests in one UI. In-process
instrumentation: no proxy, no CA cert, nothing on the wire between your app and the network.

## Install

```bash
npm install hakka-node
```

## Setup

```ts
import { register } from 'hakka-node'

register()
```

`register()` is **dev-only**: it no-ops unless `NODE_ENV === 'development'` or you pass
`force: true`, so it's safe to leave in code that also runs in production. See
[Production safety](/guides/production-safety/).

For frameworks that need explicit start/stop control instead of the dev-only gate, call
`startCapture()`/`stopCapture()` directly — they always run when called, with no `NODE_ENV`
check.

```ts
import { startCapture, stopCapture } from 'hakka-node'

const capture = startCapture({ bridgeUrl: 'ws://localhost:8989' })
// later
capture.stop() // same as stopCapture()
```

Both `register()` and `startCapture()` are idempotent — a second call while capture is already
active returns the first call's handle.

## What it captures

- `globalThis.fetch` — full request + response body, up to `maxBodySize`.
- Node `http`/`https` `request`/`get` — covers `axios` (Node adapter), `got`, `node-fetch`, and
  any SDK built on `http.request`. Request metadata, the written request body, and response
  status/headers/timing are captured; the **response body is not** — attaching a `data`
  listener would flip a paused stream into flowing mode and corrupt the caller's read.
- Phase timing (`dnsMs`/`connectMs`/`tlsMs`) for `http`/`https` captures, read off the raw
  socket's `lookup`/`connect`/`secureConnect` events. A socket handed back from a keep-alive
  pool (already connected) reports these as `undefined` rather than fabricate near-zero numbers
  for phases that ran, if at all, on some earlier request.

## Options

```ts
register({
  bridgeUrl: 'ws://localhost:8989', // default
  runtime: 'server', // tag applied to every record
  captureFetch: true,
  captureHttp: true,
  bridge: true, // stream to the bridge hub
  embedBridge: true, // host the hub in this process
  maxBodySize: 262_144,
  redactHeaders: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'],
  sink: (req) => {
    /* feed an SSE endpoint, log, etc. */
  },
  force: false, // bypass the NODE_ENV==='development' gate
  undiciTiming: false,
})
```

| Option             | Type                             | Default                                                            | Description                                                                                                                                                                                                             |
| ------------------ | -------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`          | `'client' \| 'server' \| 'edge'` | `'server'`                                                         | Tag applied to every captured record.                                                                                                                                                                                   |
| `maxBodySize`      | `number`                         | `262144` (256 KB)                                                  | Max captured body size in bytes.                                                                                                                                                                                        |
| `redactHeaders`    | `string[]`                       | `['authorization', 'proxy-authorization', 'cookie', 'set-cookie']` | Sensitive header names to redact.                                                                                                                                                                                       |
| `captureFetch`     | `boolean`                        | `true`                                                             | Capture `fetch`.                                                                                                                                                                                                        |
| `captureHttp`      | `boolean`                        | `true`                                                             | Capture Node `http`/`https`.                                                                                                                                                                                            |
| `bridge`           | `boolean`                        | `true`                                                             | Stream captures to the bridge hub.                                                                                                                                                                                      |
| `embedBridge`      | `boolean`                        | `true`                                                             | Host the bridge hub in this process. Fire-and-forget — the client queues frames until the hub is ready. If the port is already taken (another worker, or a standalone hub), this silently connects to that one instead. |
| `bridgeUrl`        | `string`                         | `'ws://localhost:8989'`                                            | Bridge hub URL.                                                                                                                                                                                                         |
| `sink`             | `(req: NetworkRequest) => void`  | —                                                                  | Additional sink for every captured record (e.g. feed an SSE endpoint).                                                                                                                                                  |
| `ignorePatterns`   | `string[]`                       | —                                                                  | Full-URL `*`-glob patterns whose captures are dropped at emit time — they never reach the sink or the bridge. For CAPTURE-cost gating (skip the work entirely), use `shouldCapture`/`sampleRate` instead.               |
| `force`            | `boolean`                        | `false`                                                            | Only consulted by `register()` — forces capture to start even outside `NODE_ENV === 'development'`. `startCapture()` always runs regardless of this option.                                                             |
| `sampleRate`       | `number` (0..1)                  | —                                                                  | Fraction of requests to capture, decided per request via `Math.random() < sampleRate`. Composed with `shouldCapture` into one gate shared by both interceptors.                                                         |
| `shouldCapture`    | `() => boolean`                  | —                                                                  | Custom pre-capture gate (e.g. `cohortGate()` from the trace module). Runs first; a `false` return skips capture — and skips evaluating `sampleRate` — outright.                                                         |
| `killSwitchPollMs` | `number`                         | `30000`                                                            | How often (ms) the `HAKKA_DISABLE` kill switch polls the environment.                                                                                                                                                   |
| `undiciTiming`     | `boolean`                        | `false`                                                            | Best-effort `connectMs` enrichment for `fetch()` captures — see below. No-op on `hakka-node/prod`.                                                                                                                      |

When neither `shouldCapture` nor `sampleRate` is set, no gate function is created at all — a
zero-cost default with no gate call on the hot path.

**Kill switch:** setting `HAKKA_DISABLE` in the process environment stops the active capture on
the next poll tick, without a redeploy — a live escape hatch for ops or an incident responder.

## Trace correlation

hakka-node links a request across hops (client → server → upstream) using two headers, read and
written together:

- `x-hakka-trace` — Hakka's own opaque id.
- `traceparent` — the [W3C Trace Context](https://www.w3.org/TR/trace-context/) header, so a
  caller already instrumented with OpenTelemetry (or any other W3C-compatible tracer) still
  links up.

Incoming requests are read with `x-hakka-trace` preferred and `traceparent` as a fallback (the
32-hex trace-id segment is adopted directly as the Hakka correlation id). Outgoing
`fetch`/`http`/`https` calls made while handling a traced request emit **both** headers.
Mechanism: `enableTracePropagation()` patches `http`/`https` `Server.prototype.emit` so that
when a `'request'` event fires, the rest of the handler runs inside an `AsyncLocalStorage`
context carrying the resolved trace id — every `fetch`/`http` call the handler makes inherits
it. Node runtime only; a no-op when `runtime: 'edge'` is passed to `startCapture`/`register`.

See [Trace correlation spec](/spec/trace/) and
[Trace correlation (client ↔ server)](/concepts/trace-correlation/) for the wire format and
cross-platform behavior.

## Best-effort undici (`fetch()`) connect timing

`http`/`https`-module captures already report `dnsMs`/`connectMs`/`tlsMs` off the raw socket.
Node's built-in `fetch` doesn't expose that — it's undici under the hood, and the fetch
interceptor only ever sees the public `fetch(input, init)` call, not undici's internals. Passing
`undiciTiming: true` recovers a best-effort `connectMs` (DNS+TCP+TLS combined — undici's
diagnostics events don't expose enough to split those the way the `http`/`https` path does) for
`fetch()` records, sourced from `node:diagnostics_channel`. It's opt-in, adds zero overhead when
off (no subscriptions are created), and skips enrichment entirely rather than risk attributing
timing to the wrong record when it can't be sure which in-flight request an event belongs to.
Not available on `hakka-node/prod`.

**Node runtime only.** This reads from undici's `node:diagnostics_channel` events — Bun's
built-in `fetch()` is not undici and doesn't publish them, so `undiciTiming` silently enriches
nothing when the app runs under `bun` instead of `node`.

## How records reach the UI

By default `startCapture`/`register` open a WebSocket client to the bridge hub
(`ws://localhost:8989`) and send one JSON frame per captured request:
`{ type: 'request', payload: NetworkRequest }` — the same wire shape the browser overlay's
`desktopBridge` and `hakka/cdp` use, so one hub relays server, browser, and CDP captures to every
connected peer. With `embedBridge: true` (the default), this process **hosts** the hub itself —
no separate `hakka-bridge` process to run. The bridge client auto-reconnects with exponential
backoff and queues records (capped at 1000 records / 5 MB serialized) while offline, so a
late-starting hub still receives the early server traffic.

See [Bridge overview](/bridge/overview/) for how the hub relays and replays frames.

## Production capture for a debug cohort (`hakka-node/prod`)

Sometimes a bug only reproduces on real traffic — one account, one device, one region — and
waiting for a dev-time repro isn't an option. `hakka-node/prod` is a **separate, capture-only**
subpath export for exactly that: instrument a named cohort of users in production, buffer their
requests in memory, and pull them on demand.

This is intentionally **not** a flag on `register()`/`startCapture()` — it's a different module.
The live bridge transport (the browser overlay's WebSocket hub) and everything that rides along
with it (mock/rewrite/breakpoint control frames) are not merely disabled in prod mode, they are
**absent from `hakka-node/prod`'s import graph** — nothing in it reaches `hakka-bridge`/`ws`. A
bundler building just this entry point has nothing control-channel-shaped to ship.

### 1. Gate a cohort with middleware

Capture only turns on for requests running inside a `debug: true` trace context — this is the
**only** supported way to enable it:

```ts
import { runInTraceContext } from 'hakka-node'

app.use((req, res, next) => {
  const debug = isDebugCohortUser(req.user) // your own allowlist check
  runInTraceContext({ traceId: req.id, debug }, next)
})
```

### 2. Start capture with a required URL allowlist

```ts
import { startProdCapture } from 'hakka-node/prod'

const capture = startProdCapture({
  captureUrls: ['https://api.example.com/users/*', 'https://api.example.com/orders/*'],
  maxBodySize: 32 * 1024, // default — prod bodies are read at real traffic volume
  maxRecords: 200, // default ring-buffer size
})
```

`captureUrls` is required — `startProdCapture` **throws** without it (or with an empty array).
Prod bodies carry tokens and PII: "capture URLs I named" fails safe; "capture everything, then
redact known-bad headers" (dev's model) fails open. There is no capture-everything prod mode.

A request is captured only when **both** gates pass: it's running in a `debug: true` trace
context **and** its URL matches `captureUrls`.

### 3. Expose a same-origin, authed pull route

```ts
// Next.js route handler — app/api/__hakka/pull/route.ts
import { createPullHandler } from 'hakka-node/prod'

export const GET = createPullHandler({
  capture,
  token: process.env.HAKKA_PULL_TOKEN!, // compared with a constant-time equality check
})
```

```bash
curl -H "Authorization: Bearer $HAKKA_PULL_TOKEN" \
  "https://your-app.example.com/api/__hakka/pull?user=alice-session-"
```

401s without a valid bearer token. Supports `?since=<ms-timestamp>` (only records strictly newer
than it — pass the last-seen `startTime` to page forward) and `?user=<correlationId-prefix>`
filters. `JSON.stringify` happens inside the handler, at pull time — capture itself never
serializes.

### `ProdCaptureOptions`

| Option             | Type                            | Default                   | Description                                                                                            |
| ------------------ | ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `captureUrls`      | `string[]`                      | — (required)              | `*`-glob patterns matched against the full request URL. `startProdCapture` throws if missing or empty. |
| `maxBodySize`      | `number`                        | `32768` (32 KB)           | Max captured body size in bytes.                                                                       |
| `maxRecords`       | `number`                        | `200`                     | Ring buffer capacity (record count).                                                                   |
| `maxBufferBytes`   | `number`                        | unbounded                 | Optional byte ceiling for the ring buffer's retained bodies, on top of `maxRecords`.                   |
| `redactHeaders`    | `string[]`                      | hakka-core's default list | Sensitive header names to redact.                                                                      |
| `captureFetch`     | `boolean`                       | `true`                    | Capture `fetch`.                                                                                       |
| `captureHttp`      | `boolean`                       | `true`                    | Capture Node `http`/`https`.                                                                           |
| `runtime`          | `RequestRuntime`                | `'server'`                | Tag applied to every captured record.                                                                  |
| `sink`             | `(req: NetworkRequest) => void` | —                         | Additional sink for every record that passes the cohort + URL-allowlist gate.                          |
| `killSwitchPollMs` | `number`                        | `30000`                   | How often (ms) the `HAKKA_DISABLE` kill switch polls the environment.                                  |
| `shouldCapture`    | `() => boolean`                 | `cohortGate()`            | Override the cohort gate. Override only for tests or a custom cohort mechanism.                        |

`startProdCapture` is idempotent — a second call while a capture is already active returns the
**first** call's handle; the new options are ignored in that case. `stopProdCapture()` tears
everything down (interceptors, trace propagation, kill-switch timer). `HAKKA_DISABLE` in the
process env stops capture on the next poll tick, same as the dev entry point.

Keeps its own singleton, independent of `startCapture()`'s — the two are unrelated capture
pipelines by design. Running both `startCapture()` (dev) and `startProdCapture()` in the same
process is possible but untested/unsupported; pick one per deployment.

## Production safety

- **`register()`** is a no-op unless `NODE_ENV === 'development'` or `force: true` — safe to
  leave in code that also ships to production.
- **`startCapture()`/`stopCapture()`** have no such gate — they always run when called, so a
  caller wiring these directly (rather than `register()`) is responsible for its own environment
  check.
- **`hakka-node/prod`** has no `NODE_ENV` gate either — its safety model is different: capture is
  gated per-request by `runInTraceContext({ debug: true }, …)` (an explicit cohort allowlist you
  control) **and** a required `captureUrls` allowlist, and the module never imports the live
  bridge transport at all.

See [Production safety](/guides/production-safety/) for the guard rails across every Hakka
platform.

## See also

- [Bridge overview](/bridge/overview/) — how the hub relays and replays frames.
- [Trace correlation spec](/spec/trace/) — wire format and config.
- [Trace correlation (client ↔ server)](/concepts/trace-correlation/) — how a browser fetch links
  to the server work it triggers.
- [Next.js overview](/nextjs/overview/) — `hakka-node/next` wraps this same capture engine for the
  Next.js server runtime.
- [Production safety](/guides/production-safety/)
