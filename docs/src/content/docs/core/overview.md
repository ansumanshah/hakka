---
title: hakka-core
description: The platform-neutral engine that every Hakka target is built on.
---

`hakka-core` is the shared engine consumed by `hakka-react-native`, `hakka-browser`,
and `hakka-node`. It is ESM-only, framework-agnostic, and carries a single
runtime dependency (`fflate`, for compressed body and export handling). You
rarely install it directly — use the package that matches your platform instead.

## What it provides

- JS interceptors for `fetch`, `XMLHttpRequest`, and `WebSocket`
- A bounded ring-buffer store with age-based retention
- Mock, throttle, and breakpoint engines
- HAR, OpenTelemetry, Postman, and cURL export
- The cross-platform `ContractRecord` wire format
- A plugin system for adding capture sources, sinks, and UI panels

## The `Hakka` singleton

Every platform target re-exports the same `Hakka` singleton from `hakka-core`.

### `start(config?)`

Starts capture. Pass config here or call `configure()` first.

```ts
import { Hakka } from 'hakka-react-native' // or 'hakka-browser'

Hakka.start({
  mode: 'auto',
  maxRequests: 500,
  maxBodySize: 256 * 1024,
})
```

`start()` is idempotent — calling it twice is safe. If `enabled` is `false`,
`start()` returns immediately.

### Modes

| Mode               | Behaviour                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'auto'` (default) | Prefer native interceptors (OkHttp / URLProtocol) when available; fall back to JS monkey-patches.                                                                    |
| `'native'`         | Native interceptors only. Throws from `start()` if the TurboModule is not found.                                                                                     |
| `'js'`             | JS monkey-patches only (`fetch` / XHR / WebSocket). No native module needed.                                                                                         |
| `'store'`          | No interceptors installed. The engine aggregates requests fed externally via `ingest()` / `update()`. Used by `hakka-browser` to host the store inside a Web Worker. |

React Native restricts this shared engine to `native` capture and defaults to it.
The other modes above are shared-core APIs, not React Native SDK options.

### Lifecycle

```ts
Hakka.pause() // buffer incoming requests without dropping them
Hakka.resume() // flush the buffer and resume dispatch
Hakka.clear() // empty the ring buffer and persisted store
Hakka.stop() // tear down interceptors and plugins
```

### Inspector UI

```ts
Hakka.show({ as: 'bubble' }) // 'bubble' | 'sheet' | 'fullscreen' — returns Promise<boolean>
Hakka.hide()
```

`show()` resolves to `true` after native presentation and `false` when the native
module or native UI package (`HakkaUI` on iOS, `hakka-ui` on Android) is unavailable.
Native UI is unavailable in JS, store, or stopped capture modes. Callers that need
to surface "native UI unavailable" should check the result:

```ts
if (!(await Hakka.show({ as: 'bubble' }))) {
  // Native UI is unavailable; show an app-specific debug notice if needed.
}
```

`hide()` dismisses the native surface. The React Native package no longer ships
a JS-rendered inspector or `hakka-react-native/ui` entry point; hooks, monitors,
and other programmatic APIs remain available independently.

### Store access

```ts
Hakka.getLogs() // NetworkRequest[]
Hakka.getLog(id) // NetworkRequest | undefined
Hakka.getLogCount() // number
Hakka.getSnapshot() // Promise<NetworkRequest[]> — merges native buffer
Hakka.onRequest(listener) // subscribe; returns unsubscribe fn
```

### Manual ingest

```ts
// Push a request from an external capture source.
Hakka.ingest(request)

// Merge timing or other fields into an existing record by id.
Hakka.update({ id, timing: { dnsMs: 12 } })
```

## `HakkaConfig` options

| Option           | Default                                                            | Description                                                                               |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `mode`           | `'auto'`                                                           | Capture mode (see above).                                                                 |
| `enabled`        | `true`                                                             | Kill switch. Set `false` to disable all capture without relinking.                        |
| `maxRequests`    | `500`                                                              | Ring-buffer capacity. Oldest entries are evicted when full.                               |
| `maxBodySize`    | `262144`                                                           | Body capture limit per request, in bytes (256 KB). Bodies larger than this are truncated. |
| `redactHeaders`  | `['authorization', 'proxy-authorization', 'cookie', 'set-cookie']` | Header names (lowercased) to blank out before storage.                                    |
| `ignoreHosts`    | `[]`                                                               | Hosts to skip. Supports wildcards: `'*.analytics.com'`.                                   |
| `ignorePatterns` | `[]`                                                               | URL patterns to skip. Supports wildcards.                                                 |
| `persist`        | `false`                                                            | Opt-in: persist captured requests across restarts via a `StorageAdapter`.                 |
| `maxAge`         | `86400`                                                            | Max age in seconds for persisted requests (24 h). Only applies when `persist` is enabled. |
| `shake`          | `true`                                                             | Shake to open inspector (React Native). Disable if your app has its own shake handler.    |

## Engines

Three optional engines extend capture. Register them with `Hakka.use(plugin)` —
each engine ships as a ready-made plugin.

| Engine             | Purpose                                                                   | Docs                                  |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------- |
| `mockEngine`       | Match requests by URL/method and return canned responses or rewrite them. | [Mocking](/features/mocking/)         |
| `ThrottleEngine`   | Simulate slow or offline conditions by adding latency.                    | [Mocking](/features/mocking/)         |
| `breakpointEngine` | Pause a request or response mid-flight, inspect and edit it, then resume. | [Breakpoints](/features/breakpoints/) |

## Plugin system

Plugins are how every platform extends the engine the same way.

```ts
import type { HakkaPlugin } from 'hakka-core'

const myPlugin: HakkaPlugin = {
  id: 'my-plugin',
  panels: [{ id: 'my-panel', title: 'My Panel', order: 10 }],
  setup(ctx) {
    // ctx.ingest, ctx.update, ctx.onRequest, ctx.getLogs, ctx.registerSink
    const unsub = ctx.onRequest((req) => console.log(req.url))
    return unsub // teardown called on Hakka.stop()
  },
}

Hakka.use(myPlugin)
Hakka.getPanels() // HakkaPanel[] — all panels across plugins, sorted by order
Hakka.getBodyRenderers() // HakkaBodyRenderer[]
Hakka.getContextMenuItems() // HakkaContextMenuItem[]
```

`use()` is idempotent. Calling it with the same plugin twice is a no-op.

## `StorageAdapter`

Implement `StorageAdapter` to persist the ring buffer across sessions.

```ts
interface StorageAdapter {
  save(records: NetworkRequest[]): void | Promise<void>
  load(): NetworkRequest[] | Promise<NetworkRequest[]>
  clear(): void | Promise<void>
}

Hakka.setStorageAdapter(adapter) // pass null to revert to in-memory-only
```

On `start()` the engine hydrates from `adapter.load()`. Writes are coalesced into
a single `save()` call per 50 ms burst to avoid O(n²) serialize cost.

## Export functions

All export functions operate on the current `Hakka.getLogs()` snapshot.

```ts
import { exportHarString } from 'hakka-core'
import { exportPostmanString } from 'hakka-core'
import { recordsToOtelJson } from 'hakka-core'
import { buildCurl } from 'hakka-core'
```

| Export                                    | Output                              |
| ----------------------------------------- | ----------------------------------- |
| `exportHarString(requests)`               | HAR 1.2 JSON string                 |
| `exportPostmanString(requests, options?)` | Postman Collection v2.1 JSON string |
| `recordsToOtelJson(records, options?)`    | OpenTelemetry JSON log export       |
| `buildCurl(request)`                      | cURL command string                 |

## Record contract

Every captured request is normalised to a `ContractRecord` before being passed
to sinks. The `RECORD_SCHEMA_VERSION` is `1`; `RECORD_SEMCONV_VERSION` is `'1.40.0'`
(OTel semantic conventions).

```ts
type RecordKind =
  | 'network.request'
  | 'metric.frame'
  | 'metric.memory'
  | 'metric.cpu'
  | 'metric.network_usage'
  | 'metric.js_thread'
  | 'breadcrumb'
  | 'trace'
  | 'health.report'
```

`NetworkRecord` (kind `'network.request'`) carries the full `NetworkRequest`
shape plus OTel attributes (`http.request.method`, `url.full`,
`http.response.status_code`, `hakka.source`, etc.).

Use `networkRequestToRecord(request, options?)` to convert a `NetworkRequest`
to a `ContractRecord` for delivery to a `RecordSink`.
