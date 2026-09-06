# hakka-node

Capture outbound `fetch` and `node:http`/`node:https` traffic in Node or Bun
applications. Stream it to the Hakka inspector or supply a local sink.

```sh
npm install hakka-node
```

```ts
import { register } from 'hakka-node'

register()
```

`register()` starts in development, or with `force: true`. For explicit lifecycle
control, use `startCapture()` and call the returned handle's `stop()`.

[Node/Bun guide and options](https://hakka.noodleapps.com/node/overview/)
· [Runnable framework examples](../../examples/framework-servers/)

## Bun

Run the same package with Bun. Outbound fetch, HTTP capture, bodies, redaction,
and HAR export work on Bun 1.4.2. Native `Bun.serve` handlers need explicit
`runInTraceContext` wiring for incoming trace headers; undici connection timing
is unavailable for Bun's fetch. See the [Bun example](../../examples/framework-servers/bun.mjs).

## Next.js (`hakka-node/next`)

Install `hakka-browser` when using the client overlay:

```sh
npm install hakka-node hakka-browser
```

```ts
// instrumentation.ts
export { register } from 'hakka-node/next'
```

```ts
// instrumentation-client.ts (Next 15.3+)
import 'hakka-node/next/client'
```

The server embeds a bridge hub. The client overlay connects to it.
[Next.js setup, Edge handling, and options](https://hakka.noodleapps.com/nextjs/overview/).

### Next Request Insights (Server Component / Route Handler / Server Action spans)

Register OTel before Hakka and pass `hakkaSpanProcessor()` at provider construction.
Keep Node-only imports behind `NEXT_RUNTIME === 'nodejs'`.
[Span setup](https://hakka.noodleapps.com/nextjs/overview/#request-insights-span-waterfall).

### Overlay pattern: prefer a client component over `instrumentation-client.ts`

A client component can call `startHakkaClient()` from an effect and return its cleanup.
[Client component example](https://hakka.noodleapps.com/nextjs/overview/#older-next-no-instrumentation-clientts).

### Peer-dependency mismatch

`hakka-browser` is optional for server-only capture. Bundlers require it whenever
`hakka-node/next/client` is imported, even though it is an optional peer.

### Customizing

[Next.js options](https://hakka.noodleapps.com/nextjs/overview/#options).

### `next.config.js`: `serverExternalPackages` (recommended)

Externalize `hakka-node`, `hakka-bridge`, `hakka-core`, and `ws` for webpack builds.
[Bundling notes](https://hakka.noodleapps.com/nextjs/overview/#server-bundling).

### Scope

Fetch includes response bodies. HTTP/HTTPS captures request bodies and response
metadata/timing without reading response streams. Edge capture covers fetch only.
Raw database sockets are outside this package's HTTP capture scope.

## Trace correlation

[Trace headers and async context](https://hakka.noodleapps.com/node/overview/#trace-correlation).

## Desktop mode

Use `register({ embedBridge: false })` to connect to a running desktop hub.
The default URL is `ws://localhost:8989`.

## Options

[Capture, filtering, sampling, and bridge options](https://hakka.noodleapps.com/node/overview/#options).

## Best-effort undici (`fetch()`) connect timing

`undiciTiming: true` adds best-effort connection timing in Node. Reused sockets
and ambiguous concurrent matches stay unenriched.

## Production capture for a debug cohort (`hakka-node/prod`)

Use a required URL allowlist, explicit consent/cohort gating, and an authenticated
same-origin pull route. [Production setup](https://hakka.noodleapps.com/node/overview/#production-capture-for-a-debug-cohort-hakka-nodeprod).
