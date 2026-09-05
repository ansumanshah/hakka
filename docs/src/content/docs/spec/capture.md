---
title: Capture
description: Spec card — the interceptor layer that turns fetch/XHR/native traffic and console output into ContractRecords.
---

## What it does

Capture intercepts `fetch`, `XMLHttpRequest`, `WebSocket`, and `console.*` calls (or, on
iOS/Android, native `URLProtocol`/OkHttp traffic) and normalizes each into a `NetworkRequest`.
Every captured request runs through mock/breakpoint/throttle checks, redaction, and body-size
capping before it reaches the ring buffer and any registered sink.

## Public API

```ts
import {
  enableFetchInterceptor,
  enableXHRInterceptor,
  enableWebSocketInterceptor,
  ConsoleInterceptor,
} from 'hakka-core'

const disable = enableFetchInterceptor(onRequest, maxBodySize, redactHeaders)
const disableXhr = enableXHRInterceptor(onRequest, maxBodySize, redactHeaders)
const disableWs = enableWebSocketInterceptor(onRequest)

ConsoleInterceptor.enable()
ConsoleInterceptor.disable()
```

Each `enableXInterceptor` returns a teardown function. The shared core wires these
up for JS capture. React Native uses native capture exclusively and does not
install them. Direct interceptor use is for custom hosts only.

Body decoding pipeline (`BodyDecoder`, SPEC §5 row "BodyDecoder"):

```ts
import { bodyDecoders, decodeSse, decodeProtobuf, decodeGrpcWeb } from 'hakka-core'

bodyDecoders.register({ id: 'my-decoder', decode: (body, contentType, contentEncoding) => string | null })
bodyDecoders.decode(body, contentType, contentEncoding) // first non-null decoder wins; passthrough is last resort
```

Built-in decoders (registered on module load): `gzip`, `deflate`, `protobuf`, `sse`, `grpc-web`.

## Config keys + defaults

Shared-core defaults (`packages/hakka-core/src/model/types.ts` and `HakkaFacade`):
React Native overrides `mode` to native-only.

| Key                              | Default                                                            | Description                                                                                   |
| -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `mode`                           | `'auto'`                                                           | `'auto'` \| `'native'` \| `'js'` \| `'store'` — see [Core overview](/core/overview/).         |
| `maxRequests`                    | `500`                                                              | Ring-buffer capacity.                                                                         |
| `maxBodySize`                    | `262144` (256 KB)                                                  | Per-request/response body capture cap; bodies over this are truncated.                        |
| `maxBufferBytes`                 | `16 * 1024 * 1024` (16 MiB)                                        | Byte ceiling for retained bodies across the whole buffer — see [Retention](/spec/retention/). |
| `redactHeaders`                  | `['authorization', 'proxy-authorization', 'cookie', 'set-cookie']` | See [Redaction](/spec/redaction/).                                                            |
| `ignoreHosts` / `ignorePatterns` | `[]`                                                               | Skip capture entirely for matching hosts/URLs (wildcard-capable).                             |
| `enabled`                        | `true`                                                             | Kill switch.                                                                                  |

Note: `limitBodySize`'s own default (`DEFAULT_MAX_BODY_SIZE`, `utils/bodySizeLimit.ts`) is
100 KB — a standalone utility default, distinct from the engine's `maxBodySize` config default
of 256 KB that the interceptors actually use.

## Platform matrix

| Capability     | RN  | iOS | Android | Web | Mac app |
| -------------- | --- | --- | ------- | --- | ------- |
| Native capture | ●   | ●   | ●       | —   | —       |
| JS capture     | —   | —   | —       | ●   | —       |
| BodyDecoder    | ●   | ●   | ●       | ●   | ◐       |

RN's `'auto'` mode prefers the native `HakkaMonitor` TurboModule and falls back to JS
monkey-patches; Web and Next.js are JS-capture only. iOS/Android BodyDecoder is a Swift/Kotlin
port matched against core's `decoders.test.ts` fixtures (SPEC §5 footnote 10).

SPEC §5 row "Cache-status tags" (footnote 15), `hakka-node` only:

| Capability        | RN  | iOS | Android | Web | Mac app |
| ----------------- | --- | --- | ------- | --- | ------- |
| Cache-status tags | —   | —   | —       | ●   | —       |

`NetworkRequest.cacheStatus` is never set by the core fetch/XHR interceptors themselves — it's
populated after capture by `hakka-node`'s server capture (`next/serverCapture.ts`), which reads a
framework cache-status response header (Next.js `x-nextjs-cache` wins when present, else Vercel
`x-vercel-cache`). `hakka-browser` renders the tag (`RequestRow.tsx`'s `.hakka-rt-tag
hakka-cache-<status>` pill, `Detail.tsx`'s `Cache` KVRow); no RN/iOS/Android interceptor reads or
surfaces a framework cache-status header today.

## Wire format

Captured requests are normalized to `ContractRecord` (kind `'network.request'`) via
`networkRequestToRecord()` before reaching a `RecordSink` — see
[Core overview](/core/overview/#record-contract) for the shape.

## Test anchors

- `packages/hakka-core/src/capture/__tests__/fetchBasics.test.ts`
- `packages/hakka-core/src/capture/__tests__/fetchSafety.test.ts`
- `packages/hakka-core/src/capture/__tests__/maxBodySize.test.ts`
- `packages/hakka-core/src/capture/__tests__/xhr.test.ts`
- `packages/hakka-core/src/capture/__tests__/rewrite.test.ts`
- `packages/hakka-core/src/capture/__tests__/readCappedBody.test.ts`
- `packages/hakka-core/src/capture/__tests__/sseCapture.test.ts`
- `packages/hakka-core/src/capture/__tests__/console.test.ts`
- `packages/hakka-core/src/capture/__tests__/bodyCapture.test.ts`
- `packages/hakka-core/src/engine/__tests__/decoders.test.ts`

## Limits & non-goals

- The fetch interceptor fails open: any internal error (redaction, mock matching, header
  copies) sends the app's original request through uncaptured rather than break it.
- `application/wasm` responses are never cloned for capture (breaks
  `WebAssembly.instantiateStreaming`) — recorded headers-only.
- SSE (`text/event-stream`) bodies are captured incrementally up to `maxBodySize`, then the
  record stops growing; the stream itself is never cut off for the app.
- No production cohort/sampling gate is part of the public config surface today — an internal
  `shouldCapture` hook exists on the fetch interceptor but is not wired to `HakkaConfig`.
