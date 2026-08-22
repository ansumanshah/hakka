# Hakka — Next.js full-stack inspector example

**Server and client API calls in one inspector — two one-line files, no separate process.**

The Next server's outbound fetches (Server Components, Route Handlers) are captured by
[`hakka-node/next`](../../packages/hakka-node) and streamed to a bridge hub that runs **inside the
Next dev server**. The browser overlay ([`hakka-browser`](../../packages/hakka-browser)) — also a bridge peer —
renders them tagged `server`, next to the browser's own client calls.

## Run it

```bash
npm install   # npm specifically: bun lays the file: deps out as per-file symlinks, and Turbopack rejects a symlinked package.json
npm run dev   # http://localhost:3000
```

That's it. No `hakka-bridge` process, no proxy, no CA cert.

## The demo page

Open http://localhost:3000 and something is already happening: the page's own Server
Component fetches `api.github.com` during render, so an entry is waiting in the overlay
before you click anything. Tap the round button bottom-right to open it (that's Step 0
on the page itself).

### Generate traffic

Eleven buttons, split into two groups.

**Core flow**, the shape you'll actually build:

| Button             | Call                 | Shows                                                                                                                               |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Fetch products     | `GET /api/products`  | Client calls a route handler, which makes its own upstream call: one click, two hops, tagged `client` then `server`.                |
| Fetch cached route | `GET /api/cached`    | A hand-stamped `x-vercel-cache` header cycling HIT, HIT, STALE, so the cache badge has something to show without real Vercel infra. |
| Run server action  | `pingServerAction()` | A Server Action with no route handler in between, tagged `server-action`, with its own outbound fetch.                              |

**Push it further**, the edges the core flow doesn't reach:

| Button           | Call                                     | Shows                                                                                |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Fail request     | `GET /api/demo/fail`                     | Always 500, the chili severity stripe.                                               |
| Not found        | `GET /api/demo/missing`                  | Always 404, the turmeric stripe.                                                     |
| Slow request     | `GET /api/demo/slow`                     | About 2.5 seconds. Open it while it runs and read the timing waterfall.              |
| POST with a body | `POST /api/demo/echo`                    | A small JSON payload, echoed back with a server timestamp.                           |
| Delete           | `DELETE /api/demo/echo`                  | Same URL as the POST above, a different method chip on the same row.                 |
| Large response   | `GET /api/demo/large`                    | About 100KB of JSON, 1,250 rows. Worth opening as a tree.                            |
| Burst            | 8 requests at once, `Promise.allSettled` | A mix of GET, POST, DELETE, a 404, and a 500, fired together. Good fodder for Stats. |
| Emit logs        | `console.log` / `warn` / `error`         | One line at each level so the Logs tab has real content to filter.                   |

### Work through the checklist

The page ends with an eight-step checklist. Each step uses something you just generated
and names the real affordance: open Filters, then Runtime, to isolate server from client
calls; run **Slow request** and read the timing waterfall; tap **Mock this** in the Detail
action bar and re-run the same button to see the mock take over; open **Rules > Throttle >
Slow 3G** and watch a duration climb; add a **Rules > Breakpoints** rule for `/api/demo`;
run **Emit logs** and check the **Logs** tab; finish by tapping **Copy as agent context** on
a request and pasting the bundle into an AI coding agent.

## The whole integration (two lines)

```ts
// instrumentation.ts        (server)
export { register } from 'hakka-node/next'
```

```ts
// instrumentation-client.ts (client, Next 15.3+)
import 'hakka-node/next/client'
```

Open http://localhost:3000, then the overlay via the round button (bottom-right). You'll see the **server**-rendered
GitHub fetch (`runtime: server`); click **Fetch products** and you'll see the browser's call to
`/api/products` (`runtime: client`) **and** that route handler's downstream call (`runtime: server`).
Use the **runtime filter** to isolate client / server / edge.

This example actually starts the overlay from a client component (`app/hakka-overlay.tsx`,
mounted in `app/layout.tsx`), **not** `instrumentation-client.ts` — see
[`packages/hakka-node/README.md`](../../packages/hakka-node/README.md#overlay-pattern-prefer-a-client-component-over-instrumentation-clientts)
for why: Next's `instrumentation-client.ts` pipeline runs before the app bundle's async-chunk
machinery is wired up, and `hakka-browser`'s overlay UI loads as an async chunk. The
client-component pattern is the reliable one:

```tsx
// app/hakka-overlay.tsx
'use client'
import { useEffect } from 'react'
import { startHakkaClient } from 'hakka-node/next/client'
export function HakkaOverlay() {
  useEffect(() => startHakkaClient(), [])
  return null
}
```

```tsx
// app/layout.tsx
import { HakkaOverlay } from './hakka-overlay'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HakkaOverlay />
      </body>
    </html>
  )
}
```

## Desktop mode: stream into Hakka for macOS

Everything above runs a bridge hub embedded in the Next dev server — the browser overlay is
the only viewer. If you have [Hakka for macOS](../../apps/hakka) open, you can stream this same
server + client traffic into its native traffic inspector instead, so Next server fetches sit
next to a mobile device's traffic in one window.

```bash
HAKKA_DESKTOP=1 npm run dev
```

This is the whole difference: `instrumentation.ts` passes `embedBridge: false` to
`hakkaRegister()` instead of the default `true`, so the dev server never hosts its own hub — it
connects purely as a client to whatever hub already owns `ws://localhost:8989`, which is the
desktop app's own hub, listening on that same default port. **The browser overlay needs no
change** — `app/hakka-overlay.tsx`'s `startHakkaClient()` also defaults to `ws://localhost:8989`,
so with nothing embedding a hub server-side, it connects straight to the desktop app's hub too,
as a second peer. Two peers, one hub, no relay mesh, no double-streaming.

**Resilience:** run `HAKKA_DESKTOP=1 npm run dev` with the desktop app _closed_ and the dev
server still starts clean — the bridge client (`hakka-node`'s `bridgeClient.ts`) auto-reconnects
with exponential backoff and queues captures (bounded) while offline, the same behavior it
already has for a late-starting embedded hub. Open the desktop app later and the queued traffic
flushes in.

**The mock loop works the other way too:** a mock rule created in the desktop app's Rules tab is
relayed to every connected peer as a `control` frame — including this dev server, which applies
it to the same `mockEngine` singleton the fetch interceptor already consults on every server-side
`fetch()` call. Create a mock for `/api/products` in the desktop app, click **Fetch products** on
this page again, and the server's own upstream call is served from the mock — not the real
network. This is the same control-command plumbing the browser overlay and the mobile SDKs
already use (`hakka-node`'s `bridgeClient.ts` is what's new: it used to be send-only).

**Device identity is honest, not pretty:** the desktop app's Devices sidebar shows this dev
server as an anonymous "Device N", same as any other peer — the wire protocol deliberately never
carries a device name (see `BridgeDeviceLabel.swift`'s doc comment and
[ADR 0011](../../docs/src/content/docs/contributing/adr/0011-additive-wire-evolution.md)), so
there's no honest "next-server (myapp)" label to show without a wire-contract change, which is
out of scope here. Per-request `runtime: server`/`client` tags (visible in the traffic list and
the runtime filter) are how you actually tell this dev server's traffic apart from a phone's in
the combined timeline today.

See [`packages/hakka-node/README.md#desktop-mode`](../../packages/hakka-node/README.md#desktop-mode)
for the underlying `embedBridge`/`bridgeUrl` options this env var wires up.

### `serverExternalPackages` + the `bufferutil` gotcha

**Webpack builds only — Turbopack (the default since Next 16) is unaffected.** This app runs
under Turbopack by default, so none of the failure mode below applies unless you've opted back
into webpack; it's documented here anyway so a future webpack user (or a plugin that forces the
webpack path) doesn't have to re-derive it.

`next.config.mjs` sets `serverExternalPackages: ['hakka-node', 'hakka-bridge', 'hakka-core', 'ws']`
to keep those packages out of the main server bundle. This matters because `ws` (used by the
embedded bridge hub/client) optionally speeds up frame masking with a native addon,
`bufferutil` — if it's not installed and `ws` gets bundled by webpack anyway, webpack stubs
the unresolvable `require('bufferutil')` to `{}` instead of letting it throw, and `ws` then
crashes every `send()` with `bufferUtil.mask is not a function`.

**`serverExternalPackages` doesn't cover `instrumentation.ts` itself** — Next compiles it (and
`instrumentation-client.ts`) through a separate webpack layer that doesn't consult that config,
so `ws` still gets bundled there (it's exactly where the embedded bridge lives). `hakka-node`
(including its `/next` entry) and `hakka-bridge` each work around this automatically
(`WS_NO_BUFFER_UTIL=1`, set before their first `ws` import) — see the hakka-node README for the
full explanation. You don't need to do anything for this; it's mentioned here so a future "the
overlay shows nothing" investigation doesn't have to re-derive it.

This is a **dev-time** tool. For production telemetry, use Hakka's OpenTelemetry export instead.

## Production: zero overhead

`next build && next start` (v16.3.1, Node 26.7, M4 Mac): overlay component ships but its
`import('hakka-browser')` call is dead-code-eliminated behind `NODE_ENV==='production'`, so the
browser never fetches it; `register()` returns before starting server capture or the embedded
bridge (nothing on :8989); prod HTML/stdout carry no Hakka runtime activity, only the page's own
"Hakka" branding text. `curl -w '%{time_total}'`, 600 requests to `/` per config, warmed up, run
in two interleaved 300-request blocks (A1/B1/A2/B2):

| Config                      | p50    | p95    | mean   |
| --------------------------- | ------ | ------ | ------ |
| hakka-node installed, no-op | 1.91ms | 3.05ms | 2.02ms |
| `HAKKA_DISABLE=1`           | 1.81ms | 2.84ms | 1.89ms |

Delta is within run-to-run noise (A1 vs A2 alone differ by more than A vs B do).

## Production cohort capture

Opt-in demo of [ADR 0002](../../docs/src/content/docs/contributing/adr/0002-production-capture-cohort.md)'s
`hakka-node/prod`: `HAKKA_PROD_CAPTURE=1` restricts capture to `jsonplaceholder.typicode.com`, gated per-request
by an `x-debug-cohort: 1` header (`app/api/products/route.ts` stands in for a real allowlist check), pulled via
a bearer-token route (`app/api/__hakka/pull/route.ts`). Unset, the example is untouched.

```bash
next build && HAKKA_PROD_CAPTURE=1 HAKKA_PULL_TOKEN=demo-secret next start
curl http://localhost:3000/api/products                                            # no header → not captured
curl -H "x-debug-cohort: 1" http://localhost:3000/api/products                     # cohort → captured
curl -H "Authorization: Bearer demo-secret" http://localhost:3000/api/__hakka/pull  # returns the cohort request(s)
```

A wrong/missing token 401s; without the flag, `/api/__hakka/pull` 404s and the cohort header is a no-op.
