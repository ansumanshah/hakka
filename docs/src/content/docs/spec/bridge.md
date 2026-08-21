---
title: Bridge
description: Spec card — the localhost WebSocket hub (hakka-bridge) that relays captured-request and control frames between every connected Hakka peer.
---

## What it does

`hakka-bridge` runs a loopback-only WebSocket server (`ws://localhost:8989` by default) that
buffers captured requests and fans them out to every other connected peer, so the web overlay,
`hakka-node/next`'s server capture, RN, iOS, Android, and `hakka mcp` can all stream to (or read from)
one live session. New peers replay the buffer on connect; senders never receive their own frames
echoed back.

## Public API

```ts
import { startBridgeServer } from 'hakka-bridge'
import type { BridgeServerOptions, BridgeServer } from 'hakka-bridge'

const server = await startBridgeServer({ host?, port?, maxRecords?, allowedOrigins?, token?, onRecord? })
server.port // actual bound port
server.hub // BridgeHub
await server.close()
```

```ts
import { BridgeHub } from 'hakka-bridge'
import type { BridgeHubOptions, IngestResult, RecordListener } from 'hakka-bridge'

const hub = new BridgeHub({ maxRecords? })
hub.ingest(rawTextFrame) // IngestResult — { kind: 'request', request } | { kind: 'control' } | null
hub.getRecords() // NetworkRequest[], oldest first
hub.onRecord(listener) // () => void
hub.clear()
hub.size
```

`parseBridgeMessage(raw)` (`packages/hakka-bridge/src/protocol.ts`) is the shared frame parser — returns
`null` on malformed JSON or an unrecognized `type`, never throws.

## Config keys + defaults

| Option           | Default                               | Description                                                                           |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `host`           | `'127.0.0.1'` (`DEFAULT_BRIDGE_HOST`) | Bind interface — loopback-only unless explicitly opened up.                           |
| `port`           | `8989` (`DEFAULT_BRIDGE_PORT`)        | Listen port. `0` for an ephemeral port (tests).                                       |
| `maxRecords`     | `1000`                                | Replay buffer cap (oldest dropped when exceeded).                                     |
| `allowedOrigins` | `[]`                                  | Extra browser `Origin` values accepted beyond localhost/127.0.0.1/`[::1]`.            |
| `token`          | unset                                 | Shared secret required as `?token=` on the connection URL; compared in constant time. |

## Platform matrix

SPEC §5 row "Bridge to hub" (footnote 8):

| Capability    | RN  | iOS | Android | Web | Mac app |
| ------------- | --- | --- | ------- | --- | ------- |
| Bridge to hub | ●   | ●   | ●       | ●   | ●       |

All three native platforms stream canonical `{ type: 'request', payload }` frames to the hub: RN
via `HakkaBridge` (WebSocket client, TS), iOS via `HakkaBridgeClient` (Swift,
`URLSessionWebSocketTask`), Android via `BridgeSink` (Kotlin, OkHttp). `hakka-node/next`'s
`startServerCapture` embeds the hub in-process by default (`embedBridge: true`), silently
skipping the embedded start if the port is already taken by another instance.

## Wire format

One JSON text frame per message:

```json
{ "type": "request", "payload": { "...": "NetworkRequest" } }
{ "type": "control", "payload": { "...": "ControlCommand (validated by the receiver, not the hub)" } }
```

Dedup is by `NetworkRequest.id`: a second emit (e.g. body arriving) or a full-store replay on
reconnect **replaces** the buffered entry in place rather than appending a duplicate.

## Test anchors

- `packages/hakka-bridge/src/hub.test.ts`
- `packages/hakka-bridge/src/server.test.ts`
- `packages/hakka-bridge/src/wsCompat.test.ts`
- `scripts/smoke-bridge-replay.mjs`

## Limits & non-goals

- localhost-only by design — no peer authentication or TLS beyond the optional `token` and
  origin allowlist; do not expose the hub port to an untrusted network.
- The replay buffer is in-memory only — restarting the hub clears history.
- The hub validates frame _shape_ (`type`/`payload` presence) but does not deep-validate a
  `control` payload — that's the receiving peer's job via `hakka-core`'s `parseControlCommand`
  (see [Control channel](/spec/control-channel/)).
