---
title: Bridge Hub
description: The WebSocket relay that connects captured frames between hakka-browser, hakka-node/next, hakka mcp, and any other peer in real time.
---

`hakka-bridge` is the local WebSocket hub that all Hakka peers connect to. Captured
frames flow in from producers (the browser overlay, the Next.js server runtime, a
React Native app) and are relayed to every other connected peer — the web overlay,
`hakka mcp`, or any custom viewer. Frames are also buffered so a late-joining peer
catches up on what it missed.

No cloud, no accounts. The hub binds to `localhost` by default.

## Quick start — CLI

```bash
npx hakka-bridge
```

Listens on `ws://localhost:8989`. To use a different port:

```bash
npx hakka-bridge --port 9000
HAKKA_BRIDGE_PORT=9000 npx hakka-bridge
```

Once the hub is running, open the **Settings** tab in the hakka-browser inspector and
enable **Connect to desktop**. Captured requests print to the terminal as they
arrive:

```
GET    200  https://api.example.com/users 142ms
POST   201  https://api.example.com/orders 318ms
```

## How frames flow

Each producer (hakka-browser, hakka-node/next) sends one JSON text frame per captured
request:

```json
{ "type": "request", "payload": { ...NetworkRequest } }
```

The hub parses every incoming frame, appends it to a bounded replay buffer
(default 1000 records, oldest dropped when full), and fans it out to every
**other** connected peer. Senders never receive their own frames echoed back.

A peer that connects after requests have already been captured receives the full
buffer immediately on connection, so a late-starting viewer (or `hakka mcp`)
sees the complete history.

## Embedded mode — hakka-node/next

`hakka-node/next`'s `startServerCapture` starts the bridge hub **in-process** by
default (`embedBridge: true`). You do not need a separate `hakka-bridge` process
when using hakka-node/next. If the port is already taken — by a standalone hub or
another dev worker — the embedded start is silently skipped and the server
connects to the existing hub instead.

Disable in-process embedding:

```ts
startServerCapture({ embedBridge: false })
```

See [Next.js overview](/nextjs/overview/) for full setup.

## Programmatic use — `startBridgeServer`

Embed the full WebSocket server in any Node process:

```ts
import { startBridgeServer } from 'hakka-bridge'

const server = await startBridgeServer({
  port: 8989, // default 8989
  maxRecords: 2000, // default 1000
  onRecord: (req, peers) => console.log(req.method, req.url, `(${peers} peers)`),
})

// Access the buffered records at any time
const history = server.hub.getRecords() // NetworkRequest[]

await server.close()
```

### `BridgeServerOptions`

| Option          | Type                       | Default       | Description                                                                                                                                                       |
| --------------- | -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`          | `number`                   | `8989`        | Port to bind. Pass `0` for an ephemeral port (useful in tests).                                                                                                   |
| `host`          | `string`                   | `'127.0.0.1'` | Bind address. Loopback-only by default; open to `'0.0.0.0'`/a LAN IP for on-device debugging (see [Zero-config LAN discovery](#zero-config-lan-discovery) below). |
| `maxRecords`    | `number`                   | `1000`        | Replay buffer cap. Oldest records are dropped when exceeded.                                                                                                      |
| `onRecord`      | `(req, peerCount) => void` | —             | Called for every ingested record.                                                                                                                                 |
| `advertise`     | `boolean`                  | `true`        | mDNS opt-out flag. Only takes effect when `host` is not loopback.                                                                                                 |
| `advertiseName` | `string`                   | hostname      | Instance name shown to LAN browsers.                                                                                                                              |

### `BridgeServer`

| Member            | Type                  | Description                                                               |
| ----------------- | --------------------- | ------------------------------------------------------------------------- |
| `port`            | `number`              | Actual bound port (resolved even when `0` was requested).                 |
| `hub`             | `BridgeHub`           | The backing buffer and fan-out hub.                                       |
| `mdnsAdvertising` | `boolean`             | Whether this server is actively advertising via mDNS.                     |
| `close()`         | `() => Promise<void>` | Terminates all connections, stops mDNS advertising, and stops the server. |

## Zero-config LAN discovery

Opening the hub up beyond loopback (`host: '0.0.0.0'` or a specific LAN IP) is how you let
a physical iOS/Android device on the same Wi-Fi reach it. Once open, `startBridgeServer`
also advertises itself via mDNS/Bonjour as `_hakka._tcp.local`, carrying the WebSocket
port — the Atlantis-style "no address to type" pitch: instead of copying an IP into
`HakkaConfig.bridgeURL` (iOS) or `HakkaInterceptor.Builder.bridgeUrl` (Android), the
native SDK can look for the hub itself.

- **iOS** browses via `NWBrowser` for `_hakka._tcp`. Opt in with
  `HakkaConfig(bridgeAutoDiscoveryEnabled: true)` (deliberately off by default — browsing
  triggers the OS Local Network permission prompt even for apps that never use the
  bridge), or call `HakkaInterceptor.shared.discoverBridge()` explicitly from a "Discover
  on LAN" action. Requires the host app declare `NSLocalNetworkUsageDescription` and
  `NSBonjourServices: ["_hakka._tcp"]` in its Info.plist.
- **Android** browses via `NsdManager` for `_hakka._tcp.` (`NsdBridgeHostBrowser` in the
  `hakka-ui` module — `hakka-network` itself stays plain-JVM with no Android SDK
  dependency). NSD is known to be flaky on some OEM devices, so a zero-result first
  attempt is retried once before giving up.

Both clients apply the same selection rule once discovery settles:

| Hosts found | Behavior                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0           | No-op — identical to today's behavior when `bridgeURL`/`bridgeUrl` is unset.                                                                                                               |
| 1           | Connects automatically.                                                                                                                                                                    |
| 2+          | Exposed as a list (never auto-connected) — iOS via `HakkaInterceptor.discoveredBridgeHosts` / the Settings "Discover on LAN" row; Android via `connectBridge(url)` once the app picks one. |

Opt out of advertising from the hub side with `advertise: false`, or the CLI's
`--no-mdns` flag / `HAKKA_NO_MDNS=1` env var:

```ts
await startBridgeServer({ host: '0.0.0.0', advertise: false })
```

**Security note**: advertising presence on the LAN does not change the bridge's trust
model from the [manually-typed `bridgeURL` case](#known-limitations) — it only makes the
_address_ easier to find. The advertised TXT/SRV records carry nothing but a service name
and port, and every frame that flows over the resulting WebSocket connection is the exact
same already-redacted payload the hub always relays: headers/bodies are redacted at the
source SDK before they ever reach the hub, not at the bridge. Anyone who can join your LAN
and reach the opened-up port could discover and connect the same way a manually-typed
`bridgeURL` would already allow — mDNS removes the "typing an IP" step, not the underlying
loopback-vs-LAN trust boundary. Keep `host` at its loopback default unless you specifically
need on-device debugging.

## Transport-agnostic core — `BridgeHub`

`BridgeHub` contains no network or Node API. Use it to wire the hub logic over
any transport (stdio, IPC, a test fixture):

```ts
import { BridgeHub } from 'hakka-bridge'

const hub = new BridgeHub({ maxRecords: 1000 })

// Subscribe to ingested records
const unsubscribe = hub.onRecord((req) => render(req))

// Feed raw frames in
const request = hub.ingest(rawTextFrame) // NetworkRequest | null

// Snapshot the buffer
const all = hub.getRecords() // NetworkRequest[], oldest first

hub.clear()
unsubscribe()
```

`ingest` returns `null` for malformed JSON or unrecognised frame shapes — the
hub never throws on hostile input.

## Read-only consumers

Some peers only read from the hub and never send. `hakka mcp` works this way:
it connects to `ws://localhost:8989`, receives every relayed and replayed frame,
and loads them into its in-memory store to answer AI tool queries. Because it
never sends, there are no echo loops.

See [MCP overview](/mcp/overview/) and [Web overlay](/web/overview/).

## Known limitations

- **Loopback by default, no TLS** — intended for local development; there is no peer
  authentication beyond the optional `token` above and no transport encryption. Opening
  `host` to the LAN (for on-device debugging, see
  [Zero-config LAN discovery](#zero-config-lan-discovery)) is supported, but only do it on
  a network you trust — anyone who can reach the port can read every captured
  request/response body once connected.
- **In-memory replay buffer** — records are not persisted to disk. Restarting
  the hub clears history.
