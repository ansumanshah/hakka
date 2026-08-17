# hakka-bridge

The desktop-side receiver for [`hakka-browser`](../hakka-browser)'s WebSocket bridge. Run it in
a terminal and every request captured by a `hakka-browser` overlay streams to you,
live — no browser DevTools tab required.

```bash
npx hakka-bridge            # listen on ws://localhost:8989
npx hakka-bridge --port 9000
HAKKA_BRIDGE_PORT=9000 npx hakka-bridge
```

Then, in the page running `hakka-browser`, open the inspector's **Settings** tab and
turn on **Connect to desktop** (default URL `ws://localhost:8989`). Each request
prints as it happens:

```
GET    200  https://api.example.com/users 142ms
POST   201  https://api.example.com/orders 318ms
```

## How it works

The `hakka-browser` client sends one JSON frame per request —
`{ type: "request", payload: NetworkRequest }`. The bridge buffers them and
**relays each frame to every other connected peer**, so several viewers (or a
future desktop UI) can subscribe to one app's stream. New peers receive a replay
of the buffer on connect.

## Programmatic use

```ts
import { startBridgeServer } from 'hakka-bridge'

const server = await startBridgeServer({
  port: 8989,
  maxRecords: 2000,
  onRecord: (req, peers) => console.log(req.method, req.url, `(${peers} peers)`),
})

server.hub.getRecords() // buffered NetworkRequest[]
await server.close()
```

`BridgeHub` is transport-agnostic (no network or Node API) if you want to wire
your own transport:

```ts
import { BridgeHub } from 'hakka-bridge'

const hub = new BridgeHub({ maxRecords: 1000 })
hub.onRecord((req) => render(req))
hub.ingest(rawFrame) // returns the decoded NetworkRequest, or null if malformed
```

## License

MIT. See [LICENSE](./LICENSE).
