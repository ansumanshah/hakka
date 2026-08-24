---
title: WebSocket
description: Spec card — WebSocket frame capture, debouncing, and the sub-protocol frame-decoder pipeline (MQTT, Socket.IO, STOMP, graphql-ws).
---

## What it does

The WebSocket interceptor wraps the global `WebSocket` constructor to capture connection
lifecycle (open/close/error) and every sent/received frame as a `WsMessage`, debounced so a
chatty socket doesn't flood listeners. A separate `WsFrameDecoder` registry annotates recognized
sub-protocols (MQTT, Socket.IO, STOMP, graphql-ws) with structured summaries.

## Public API

```ts
import { enableWebSocketInterceptor } from 'hakka-core'
const disable = enableWebSocketInterceptor(onRequest)
```

Frame decoding:

```ts
import { wsFrameDecoders, decodeWsFrame } from 'hakka-core'
import type { WsFrameDecoder, WsFrameInfo } from 'hakka-core'

wsFrameDecoders.register({
  id: 'my-protocol',
  protocols: ['my-protocol-v1'], // omit to run as a universal fallback
  decode(frame, protocol) {
    /* return WsFrameInfo | null */
  },
})
decodeWsFrame(frame, protocol) // WsFrameInfo | null — first non-null decoder wins
```

Built-in decoders (registered on module load, most-specific first): `graphql-ws`, `stomp`,
`socket.io`, `mqtt`.

`WsMessage` shape (`packages/hakka-core/src/model/types.ts`):

```ts
interface WsMessage {
  timestamp: number
  direction: 'sent' | 'received'
  data: string | number // text frame → string; binary → base64 within the cap, else byte count
  size: number
  binary?: boolean
}
```

## Config keys + defaults

Not exposed via `HakkaConfig` — these are fixed constants in `capture/websocket.ts`:

| Constant              | Value   | Description                                                                |
| --------------------- | ------- | -------------------------------------------------------------------------- |
| `MAX_WS_MESSAGES`     | `100`   | Max frames captured per connection.                                        |
| `WS_DEBOUNCE_MS`      | `250`   | Debounce interval for `onRequest` emission on a chatty socket.             |
| `MAX_WS_BINARY_BYTES` | `32768` | Binary frames over this size keep only a byte count, not a base64 payload. |

## Platform matrix

WebSocket capture rides the same interceptor layer as HTTP capture — see SPEC §5 "Native
capture" / "JS capture" rows:

| Capability       | RN  | iOS | Android | Web | Mac app |
| ---------------- | --- | --- | ------- | --- | ------- |
| Native capture   | ●   | ●   | ●       | —   | —       |
| JS capture       | ●   | —   | —       | ●   | —       |
| WebSocket frames | ●   | ●   | ●       | ●   | ●       |

iOS ships `WebSocketMonitor.swift`; Android ships `HakkaWebSocketWrapper.kt`. The sub-protocol
frame-decoder registry (MQTT/Socket.IO/STOMP/graphql-ws) exists on all four platforms:
`engine/wsDecoders.ts` in core, `WsFrameDecoders+*.swift` on iOS, and `*WsDecoder.kt` on
Android, each ported against the TypeScript fixtures. Native panels render the decoded kind and
payload summary and fall back to raw frame text when no decoder matches. Server-side outbound
WebSocket capture (`hakka-node`) is not offered on any platform.

## Wire format

A WS connection emits as a `NetworkRequest` with `source: 'websocket'`, `status: 101` while
open, `messages: WsMessage[]`, and `wsProtocol` (the negotiated sub-protocol, empty until
`'open'` fires).

## Test anchors

- `packages/hakka-core/src/capture/__tests__/websocket.test.ts`
- `packages/hakka-core/src/engine/__tests__/wsDecoders.test.ts`
- `android/hakka-network/src/test/kotlin/com/noodleapps/hakka/HakkaWebSocketWrapperTest.kt`

## Limits & non-goals

- Binary frames over `MAX_WS_BINARY_BYTES` are sized but not previewable (no base64 payload).
- Frame decoders are read-only annotations — none of them can rewrite or block a WS frame (no
  breakpoint/mock equivalent for WebSocket traffic).
- No bandwidth or latency throttle applies to WebSocket frames — `ThrottleEngine` only wraps
  `fetch`.
