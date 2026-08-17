---
title: Trace correlation (client ↔ server)
description: Link a browser fetch to the Next.js server work it triggers — one logical request's full stack in a single trace.
---

Hakka can link the hops of one logical request — a browser `fetch`, the server route
that handled it, and the upstream calls that route made — under a shared `correlationId`,
so the overlay shows the **full stack of one request** in a single trace.

## How it works

1. **Client originates.** With trace enabled, the browser generates a trace id and sends it
   on the `x-hakka-trace` header for same-origin requests (plus any origins you allow). The
   client record is tagged with that id.
2. **Server inherits.** `hakka-node/next` reads the incoming header into a Node
   [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html) context (by hooking
   `http.Server`'s request emit — the APM-standard technique). The route handler and every
   `fetch`/`http` call it makes during that request **inherit the same id**.
3. **Forwarded onward.** Server-side upstream calls re-send the header, so multi-hop traces
   (service → service) keep linking.

The shared `correlationId` flows over the dev bridge into the same store the overlay reads —
no extra wiring, no proxy.

## Enable it

**Client** — opt in when you start the overlay (off by default so the header never leaks):

```ts
import { start } from 'hakka-browser'

start({
  trace: true, // same-origin only
  // or: trace: { propagateOrigins: ['https://api.example.com'] }
})
```

**Server** — `hakka-node/next` turns it on automatically; the standard one-liner is all you need:

```ts
// instrumentation.ts
export { register } from 'hakka-node/next'
```

## See the trace

In the overlay's Network panel, set **Group by → Trace**. Each trace becomes a group
containing its client and server hops (server rows carry a `SERVER`/`EDGE` runtime badge);
everything else falls under **No trace**. A request's **Detail → Overview** shows its
`Trace` id.

## Scope

- **Node runtime.** Correlation uses Node `AsyncLocalStorage` + the `http.Server` hook. The
  **Edge** runtime has no node http server, so edge route work isn't linked (the client and
  any Node hops still are).
- **Opt-in header.** The `x-hakka-trace` header is only sent when you enable trace, and only
  same-origin unless you allowlist an origin — it won't leak the id to third parties.
- The id is a debug correlation token, not a security/auth identifier.
