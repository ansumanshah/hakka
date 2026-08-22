# hakka-node

Framework-agnostic server-side network capture for Node backends — plain
`http`, Express, Fastify, Hono, or anything else running on Node. Instruments
`fetch` and Node `http`/`https`, and streams captures to the Hakka bridge hub
so the browser overlay shows server and client requests in one UI. No proxy,
no CA cert.

```ts
import { register } from 'hakka-node'

register()
```

`register()` is dev-only: it no-ops unless `NODE_ENV === 'development'` or you
pass `force: true`, so it's safe to leave in code that also runs in
production.

## Next.js (`hakka-node/next`)

See your server _and_ client API calls in one inspector — two one-line files,
no separate process. `hakka-node/next` is a thin, edge-safe wrapper around the
capture above, specific to Next's `instrumentation.ts`/`instrumentation-client.ts`
hooks; `hakka-node/next/server` and `hakka-node/next/client` are its Node- and
browser-runtime halves.

```bash
npm i -D hakka-node
npm i hakka-browser
```

```ts
// instrumentation.ts          (server: capture + embed the bridge hub in-process)
export { register } from 'hakka-node/next'
```

```ts
// instrumentation-client.ts   (client, Next 15.3+: start the overlay + connect)
import 'hakka-node/next/client'
```

Run `next dev`, open the overlay — server and client requests appear in one UI, tagged `server`/`client`. **No `hakka-bridge` process, no proxy, no CA cert.** Production builds are untouched.

> **`hakka-browser` is required if you use `hakka-node/next/client`.** This package's
> `peerDependenciesMeta` marks `hakka-browser` optional — that's for server-only backends that
> never import `hakka-node/next/client` at all (plain `hakka-node`/`hakka-node/next` capture with
> no overlay). It is **not** optional once you add the `instrumentation-client.ts` one-liner or
> the client-component pattern below: `import('hakka-browser')` in `client.ts` uses a literal
> specifier (required so bundlers can code-split it into its own chunk — see the comment in
> `src/next/client.ts`), and both Turbopack and webpack resolve literal dynamic-import specifiers
> at **build time**, not just at runtime. Omit `hakka-browser` and keep either overlay entry point
> wired up, and `next dev` 500s the whole route with `Module not found: Can't resolve 'hakka-browser'`
> (verified on Next 16.3.1 + Turbopack) — it does not degrade gracefully, despite
> the optional peer dependency. There is no bundler-level fix for this without giving up
> literal-specifier code-splitting (see [Peer-dependency mismatch](#peer-dependency-mismatch)
> below); if you don't want the overlay, don't import `hakka-node/next/client` — that's the actual
> opt-out.

### Next Request Insights (Server Component / Route Handler / Server Action spans)

`register()` turns on `traceSpans` by default in dev, but it only has spans to
bridge once _something_ registers an OTel `TracerProvider` — Next doesn't
register one for you. Bring your own via `@vercel/otel`, and pass hakka-node's
processor into it explicitly:

```bash
npm i @vercel/otel @opentelemetry/api
```

```ts
// instrumentation.ts
import { registerOTel } from '@vercel/otel'
import { hakkaSpanProcessor } from 'hakka-node'
import { register as hakkaRegister } from 'hakka-node/next'

export function register() {
  registerOTel({ serviceName: 'my-app', spanProcessors: [hakkaSpanProcessor()] })
  return hakkaRegister()
}
```

`spanProcessors: [hakkaSpanProcessor()]` is **required** on
`@opentelemetry/sdk-trace-base` 2.x (what current `@vercel/otel` versions
use) — that SDK generation removed `TracerProvider.addSpanProcessor`, so
processors can only be attached at construction time, never after. hakka-node
also tries a post-registration `addSpanProcessor` duck-type as an SDK-1.x
fallback, but it silently no-ops on 2.x, with no error to point at why spans
never show up — always pass `hakkaSpanProcessor()` explicitly for wiring
that's guaranteed to work on either SDK generation.

**Edge routes:** the static top-level `import { hakkaSpanProcessor } from 'hakka-node'` above is
fine for a Node-only app, but it pulls `hakka-node`'s Node-only internals (trace propagation's
`node:http`/`node:https` patch, `node:crypto`) into Next's Edge-instrumentation compile too if any
route in your app runs on the Edge runtime — Turbopack resolves it even from code that only
executes on the `nodejs` branch, producing "Node.js module ... not supported in the Edge Runtime"
warnings. If you have Edge routes, dynamically import `hakkaSpanProcessor` behind a
`process.env.NEXT_RUNTIME === 'nodejs'` guard instead — see
`examples/next-fullstack/instrumentation.ts` for the full reference wiring (also configures
`undiciTiming`).

### Overlay pattern: prefer a client component over `instrumentation-client.ts`

**Fixed as of this version.** Earlier releases shipped `"sideEffects": false` in this
package's `package.json`, which is correct for the rest of the package but wrong for
`hakka-node/next/client`: that entry's only purpose is the side effect of a bare import
(`import 'hakka-node/next/client'` auto-calls `startHakkaClient()`), and `sideEffects: false`
tells bundlers exactly the opposite — that an import with no consumed binding is safe to drop.
Under Next 16 + Turbopack this wasn't a delayed or flaky mount, it was total: the compiled
`instrumentation-client.ts` chunk shipped as an empty module, no `hakka-browser` chunk was ever
requested, and neither the success path nor the `.catch()` warning below ever ran — a
side-effect-only import, silently deleted. `package.json` now scopes `"sideEffects"` to the two
files that actually need it (`./dist/index.mjs`, `./dist/next/client.mjs`) instead of disabling
it wholesale, so the one-liner in the Next.js section above mounts the overlay reliably — this
was verified end-to-end against a clean `create-next-app` on Next 16.3.1 + Turbopack. As a
second line of defense, `startHakkaClient()` also now warns if
`import('hakka-browser')` hasn't settled within 4s (`settleTimeoutMs`), so a future load failure
of any kind — this one included — won't be silent again.

The client-component pattern below remains fully valid — it's the right call whenever you want
explicit control over _when_ the overlay mounts (behind an auth check, a feature flag, etc.) —
it's just no longer required to work around this bug:

```tsx
// app/hakka-overlay.tsx
'use client'
import { useEffect } from 'react'
import { startHakkaClient } from 'hakka-node/next/client'

export function HakkaOverlay() {
  useEffect(() => {
    startHakkaClient()
  }, [])
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

This is what `examples/next-fullstack` does — not because the one-liner is unreliable (it's
fixed, see above), but because a client component gives explicit control over mount timing. On
Next 15.3+, `instrumentation-client.ts` (`import 'hakka-node/next/client'`) is the simpler
default; reach for the pattern above only when you need that control, or if `settleTimeoutMs`'s
warning ever points you here for a different reason (a genuinely missing or failed
`hakka-browser` install — see below).

### Peer-dependency mismatch

`hakka-browser` is declared `peerDependenciesMeta: { optional: true }` — correct for the common
case of a server-only backend that never touches `hakka-node/next/client`. It does **not**
degrade gracefully when omitted while either overlay entry point (`instrumentation-client.ts` or
the client component above) is still wired up: `client.ts`'s `import('hakka-browser')` uses a
literal specifier on purpose, so bundlers can code-split `hakka-browser` into its own chunk when
it's present. That same literal specifier is what lets Turbopack (and webpack) resolve the
import at **build time** — when the package isn't on disk, that resolution fails as a compile
error, not a runtime one, and `next dev`/`next build` fail the whole route with `Module not
found: Can't resolve 'hakka-browser'` (confirmed on Next 16.3.1 + Turbopack, both dev 500 and
`next build` failure).

We looked for a bundler-level way to make this degrade instead of fail — a non-literal specifier
(rejected already, see the comment in `src/next/client.ts`: it breaks the working, common case,
since a bare specifier a bundler never resolves is also one no browser can resolve at runtime),
and a `webpackIgnore`-style magic comment (rejected too: skipping bundler resolution entirely
means `hakka-browser` never gets code-split even when it IS installed, so the working case breaks
the same way). Both trade the common case's reliability for the uncommon case's convenience — the
wrong trade for a devtool where "the overlay just works" is most of the value. So: **this is
documented, not patched.** If you don't want the overlay, don't import `hakka-node/next/client`
at all (from either entry point) — that's the real opt-out `peerDependenciesMeta` describes. If
you do want it, `hakka-browser` is a required install, full stop.

### Customizing

```ts
// instrumentation.ts
import { register as base } from 'hakka-node/next'
export const register = () =>
  base({
    runtime: 'server', // 'server' (default) | 'edge'
    captureHttp: true, // patch node http/https (axios, got…). No-op on edge.
    embedBridge: true, // run the hub in-process (default). false → `npx hakka-bridge`, OR desktop mode (see below).
    bridgeUrl: 'ws://localhost:8989',
  })
```

### `next.config.js`: `serverExternalPackages` (recommended)

**Webpack builds only — Turbopack (the default since Next 16) is unaffected** by everything in
this section: Turbopack doesn't bundle `ws`'s native-addon probe the way webpack does, so the
`bufferutil` stubbing failure mode below doesn't occur under it. Keep `serverExternalPackages`
set anyway (it's cheap, and still helps if your project or a plugin forces the webpack build
path), but don't spend time chasing this class of bug if you're on Turbopack — which is the
default for `next dev`/`next build` unless you've explicitly opted back into webpack.

```js
/** @type {import('next').NextConfig} */
module.exports = {
  serverExternalPackages: ['hakka-node', 'hakka-bridge', 'hakka-core', 'ws'],
}
```

This keeps the package chain (and `ws`, which the embedded bridge client/server use) out of
the main server/route webpack bundle — smaller, faster server compiles, and avoids the
general class of bugs where bundling a package that does runtime `require()` probing (native
addons, optional deps) breaks it.

**Why `ws` specifically matters:** `ws` optionally speeds up frame masking with a native
addon, `bufferutil`, guarded by `try { require('bufferutil') } catch {}`. If `bufferutil`
isn't installed (the common case — it's optional) and `ws` gets bundled by webpack anyway,
webpack stubs the unresolvable `require('bufferutil')` to an empty module (`{}`) instead of
letting it throw. `ws`'s own catch never fires, so it calls `{}.mask(...)` and throws
`bufferUtil.mask is not a function` on every `send()` — the bridge client silently fails to
deliver every frame to the hub (no visible error; the overlay just never shows server
requests). `serverExternalPackages` prevents this for the main compile.

**It does NOT cover `instrumentation.ts`.** Next compiles `instrumentation.ts` (and
`instrumentation-client.ts`) through a separate, dedicated webpack layer that doesn't consult
`serverExternalPackages` — and that's exactly where the embedded bridge hub/client live (they're
started from `register()`). So `ws` still gets bundled — and stubbed — on that path even with
the config above. `hakka-node` (this package's own root entry, reached from `hakka-node/next`)
sets `process.env.WS_NO_BUFFER_UTIL = '1'` before its first `import 'ws'`, which makes `ws` skip
the native-addon probe entirely and use its pure-JS mask/unmask fallback — irrelevant perf-wise
at dev-inspector traffic volumes. This is automatic; you don't need to set it yourself. Keep
`serverExternalPackages` anyway for the smaller/faster main bundle — just don't expect it to be
sufficient on its own for this failure mode.

### Scope

- **Captures** HTTP(S) outbound: `fetch` (full bodies) and `http`/`https` (request metadata + body; response status/headers/timing — response bodies are skipped for stream-safety).
- **Edge runtime**: `fetch` only (no Node `http` module); pass `runtime: 'edge'`.
- **Not** non-HTTP traffic (Postgres/Prisma over TCP) — neither in-process capture nor a proxy sees those as requests.

## Trace correlation

hakka-node links a request across hops (client → server → upstream) using two
headers, read and written together:

- `x-hakka-trace` — Hakka's own opaque id.
- `traceparent` — the [W3C Trace Context](https://www.w3.org/TR/trace-context/)
  header, so a caller already instrumented with OpenTelemetry (or any other
  W3C-compatible tracer) still links up.

Incoming requests are read with `x-hakka-trace` preferred and `traceparent` as
a fallback. Outgoing `fetch`/`http`/`https` calls made while handling a traced
request emit **both** headers.

## Desktop mode

By default `register()`/`startCapture()` embed a bridge hub in this process — there's no
separate `hakka-bridge` to run. Pass `embedBridge: false` to skip that and stream into an
**already-running Hakka for macOS** instead, so a Next.js (or any Node backend's) server-side
traffic shows up next to a mobile device's in the desktop app's one traffic timeline:

```ts
register({ embedBridge: false }) // bridgeUrl defaults to ws://localhost:8989 — same port the desktop app's hub listens on
```

What this changes, and what it deliberately doesn't:

- **The dev server never blocks or crashes** if the desktop app isn't running.
  `bridgeClient.ts`'s reconnect logic — exponential backoff, bounded offline queue — is unchanged;
  `embedBridge: false` just means there's never a race to grab the port first. Open the desktop
  app later and queued captures flush in.
- **The browser overlay needs no code change.** `hakka-node/next/client`'s `startHakkaClient()`
  (and `hakka-browser`'s own `connect()`) default to the same `ws://localhost:8989`. With nothing
  embedding a hub in the dev server, that connects the overlay straight to the desktop app's hub
  as a second peer — the same one hub, two peers, not a relay mesh and not double-streaming. If
  you don't want the in-page overlay at all in this mode, just don't wire up
  `instrumentation-client.ts`/the client-component pattern; that's the real opt-out, same as
  always.
- **Mock rules created in the desktop app apply here too.** The bridge client also *receives*
  `{ type: 'control' }` frames from the hub — the same mock/breakpoint/throttle commands the
  browser overlay and mobile SDKs already apply — and drives them against this process's
  `mockEngine`/`breakpointEngine`/`ThrottleEngine`, which `enableFetchInterceptor` already
  consults on every server-side `fetch()`. A mock created in the desktop app's Rules tab
  intercepts a matching Server Component/Route Handler/Server Action fetch, not just the
  browser's own calls. Set `handleControl: false` to keep this process capture-only.
- **Device identity stays anonymous.** The bridge wire protocol carries no device name/app-id by
  design (see `BridgeDeviceLabel.swift`'s doc comment and
  [ADR 0011](https://github.com/ansumanshah/hakka/blob/main/docs/src/content/docs/contributing/adr/0011-additive-wire-evolution.md)) —
  the desktop app's Devices sidebar shows this dev server as "Device N", same as any other peer.
  Use the per-request `runtime: server`/`client` tag (and the runtime filter) to tell it apart
  from a phone's traffic in the combined timeline; that's a wire-contract change, not something
  this package can decide on its own.

See `examples/next-fullstack`'s README for a runnable walkthrough (`HAKKA_DESKTOP=1 npm run dev`).

## Options

```ts
register({
  bridgeUrl: 'ws://localhost:8989', // default
  runtime: 'server', // tag applied to every record
  captureFetch: true,
  captureHttp: true,
  bridge: true, // stream to the bridge hub
  embedBridge: true, // host the hub in this process — false for desktop mode, see above
  handleControl: true, // apply control frames (mock/breakpoint/throttle) received from the hub
  maxBodySize: 262_144,
  redactHeaders: ['authorization', 'cookie' /* … */],
  sink: (req) => {
    /* feed an SSE endpoint, log, etc. */
  },
  force: false, // bypass the NODE_ENV==='development' gate
  undiciTiming: false, // best-effort fetch() connect timing — see below
})
```

For frameworks that need explicit start/stop control (rather than the
dev-only `register()` gate), use `startCapture()`/`stopCapture()` directly —
they always run when called.

## Best-effort undici (`fetch()`) connect timing

`http`/`https`-module captures already report `dnsMs`/`connectMs`/`tlsMs` off
the raw socket. Node's built-in `fetch` doesn't expose that — it's undici
under the hood, and the fetch interceptor only ever sees the public
`fetch(input, init)` call, not undici's internals. Passing
`undiciTiming: true` recovers a best-effort `connectMs` (DNS+TCP+TLS combined —
undici's diagnostics events don't expose enough to split those the way the
`http`/`https` path does) for `fetch()` records, sourced from
`node:diagnostics_channel`. It's opt-in, adds zero overhead when off, and
skips enrichment entirely rather than risk attributing timing to the wrong
record when it can't be sure which in-flight request an event belongs to (see
`undiciTiming.ts` for the correlation strategy). Not available on
`hakka-node/prod` (below).

**Node runtime only.** This reads from undici's `node:diagnostics_channel`
events — Bun's built-in `fetch()` is not undici and doesn't publish them, so
`undiciTiming` silently enriches nothing (fails open, same as everywhere else
in this package) when the app runs under `bun` instead of `node`.

## Production capture for a debug cohort (`hakka-node/prod`)

Sometimes a bug only reproduces on real traffic — one account, one device, one
region — and waiting for a dev-time repro isn't an option. `hakka-node/prod`
is a **separate, capture-only** entry point for exactly that: instrument a
named cohort of users in production, buffer their requests in memory, and
pull them on demand. See
[ADR 0002](https://hakka.noodleapps.com/contributing/adr/0002-production-capture-cohort/)
for the full design rationale.

This is intentionally **not** a flag on `register()`/`startCapture()` — it's a
different module. The live bridge transport (the browser overlay's WebSocket
hub) and everything that rides along with it (mock/rewrite/breakpoint control
frames) are not merely disabled in prod mode, they are **absent from
`hakka-node/prod`'s import graph** — nothing in it reaches `hakka-bridge`/`ws`.
A bundler building just this entry point has nothing control-channel-shaped to
ship.

### 1. Gate a cohort with middleware

Capture only turns on for requests running inside a `debug: true` trace
context — this is the **only** supported way to enable it:

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

`captureUrls` is required — `startProdCapture` **throws** without it (or with
an empty array). Prod bodies carry tokens and PII: "capture URLs I named"
fails safe; "capture everything, then redact known-bad headers" (dev's model)
fails open. There is no capture-everything prod mode.

A request is captured only when BOTH gates pass: it's running in a
`debug: true` trace context **and** its URL matches `captureUrls`.

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

401s without a valid bearer token. Supports `?since=<ms-timestamp>` (only
records strictly newer than it — pass the last-seen `startTime` to page
forward) and `?user=<correlationId-prefix>` filters. `JSON.stringify` happens
inside the handler, at pull time — capture itself never serializes.

Ring buffer default: 200 records, no byte ceiling (tune both via
`maxRecords`/`maxBufferBytes`). `stopProdCapture()` tears everything down
(interceptors, trace propagation, kill-switch timer); `HAKKA_DISABLE` in the
process env stops capture on the next poll tick, same as the dev entry.
