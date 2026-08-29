# Framework servers example

`hakka-node`'s root export (`register`/`startCapture`) is framework-agnostic: it patches
`fetch`/`node:http` process-wide, so it works the same underneath any Node server. This example
proves that claim on four of them (Express, Fastify, Hono, and raw `node:http`) with no inspector
UI. Each demo prints every record it captures to stdout, so the proof is in the run output, not a
claim in a doc.

Every demo does the same three things:

1. Start a tiny upstream "API" (`shared/upstream.mjs`) and a framework server with one route,
   `GET /users/:id`, whose handler makes an outbound call to that upstream.
2. Send it a request carrying an `x-hakka-trace` header (`shared/client.mjs`), the header a
   browser running `hakka-browser`, or an already-traced upstream caller, would already send.
3. Check that the server's own outbound call was captured with the same `correlationId`. That's
   proof the trace actually joined the hop, not just documentation saying it should.

## What each demo demonstrates

| File           | Framework                      | Outbound capture surface   | Entry point used                   |
| -------------- | ------------------------------ | -------------------------- | ---------------------------------- |
| `raw-http.mjs` | none, plain `node:http`        | `captureHttp` (`http.get`) | `register({ force: true })`        |
| `express.mjs`  | Express 5                      | `captureFetch` (`fetch()`) | `startCapture()` / `stopCapture()` |
| `fastify.mjs`  | Fastify 5                      | `captureFetch` (`fetch()`) | `startCapture()` / `stopCapture()` |
| `hono.mjs`     | Hono (via `@hono/node-server`) | `captureFetch` (`fetch()`) | `startCapture()` / `stopCapture()` |

`raw-http.mjs` uses `register()`, the one-liner the root README leads with, with `force: true`.
`register()` only starts capture when `NODE_ENV === 'development'`, and a bare `node
raw-http.mjs` run sets neither. The other three use `startCapture()`/`stopCapture()` directly,
tied to the framework's own listen/close lifecycle. That's the pattern to reach for once a server
has real startup/shutdown hooks to hang capture off. Both entry points are the same underlying
capture; which one to use is about lifecycle, not capability.

`raw-http.mjs` also exercises `captureHttp` specifically (its outbound call is `http.get`), while
the three framework demos exercise `captureFetch` (their outbound call is `fetch()`). Between
them, both of `hakka-node`'s capture surfaces get proven, not just one.

## Run it

```sh
npm install   # see "Why npm, and why outside the workspace" below
npm run demo            # all four, one after another
npm run demo:raw-http   # or just one
npm run demo:express
npm run demo:fastify
npm run demo:hono
```

Each run prints something like:

```
express  (server on http://127.0.0.1:51133, upstream on http://127.0.0.1:51132)
-------------------------------------------------------------------------------
  client -> GET http://127.0.0.1:51133/users/1  (x-hakka-trace: 537d86e9-605a-45da-a59d-acf3b5de38d1)
  [express] GET http://127.0.0.1:51132/users/1 -> 200 (3ms)  correlationId=537d86e9-605a-45da-a59d-acf3b5de38d1
  [express] GET http://127.0.0.1:51133/users/1 -> 200 (13ms)
  trace check: PASS. The server's outbound call carried the same correlationId (537d86e9-605a-45da-a59d-acf3b5de38d1)
```

The first `[express]` line is the handler's outbound call to the upstream API, the one carrying
the trace. The second is the client's own request to the demo server, captured too (this process
patches `fetch` globally, and `shared/client.mjs`'s simulated client runs in the same process). It
has no `correlationId` because nothing set one before that call: it's the hop the trace
_originates_ on, not a joined one.

Exit code is non-zero if a trace check fails, so `npm run demo` (via `run-all.mjs`) also works as
a smoke test.

### Watch it in the inspector instead of stdout

Every demo's bridge streaming is off by default. Set `HAKKA_BRIDGE=1` to also stream into a live
Hakka inspector (embeds a hub on `ws://localhost:8989` in-process, same as the root README's
default):

```sh
HAKKA_BRIDGE=1 npm run demo:express
```

Open `hakka-browser`'s overlay (or the desktop app) pointed at the same port and the two captured
requests above show up there too, tagged `runtime: server`.

## Trace correlation (`x-hakka-trace`)

This is `hakka-node`'s headline capability. A request arrives carrying `x-hakka-trace: <id>`,
`startCapture()`/`register()` read it into an `AsyncLocalStorage` context before the handler runs
(`enableTracePropagation()` in `src/trace.ts`), and every `fetch`/`http` call the handler makes
while running inherits that same id as `correlationId`, automatically, with no per-call plumbing.
`shared/client.mjs`'s `callWithTrace()` sends the header the way an already-traced caller (a
browser running `hakka-browser`, or an upstream service) already would. `shared/runDemo.mjs` then
checks the outbound record's `correlationId` against the id that was sent, which is the actual
proof each demo prints as `trace check: PASS`.

Read `currentServerTraceId()` directly if a handler wants the id without waiting for a captured
record. `raw-http.mjs` does this to print the id server-side as soon as the request lands, before
the outbound call is even made.

## A `sink` quirk worth knowing: `fetch()` captures emit twice

`hakka-core`'s fetch interceptor emits a `fetch()` capture **twice** for the same request `id` by
design: once at headers-received time (`responseBody: null`), once more once the body finishes
downloading (see `packages/hakka-core/src/capture/fetch.ts`'s "two-phase emission" doc comment).
`node:http`/`https` captures (what `raw-http.mjs`'s outbound call uses) do not do this; one call,
one emission. Since three of these four demos make their outbound call with `fetch()`, a naive
`sink` that just `console.log`s every call would print each of those lines twice.

`shared/capture.mjs`'s `printRecord` handles this the way `hakka-node/prod.ts`'s own ring buffer
does: keep the latest record per `id` (for `findByTrace` to search), but only print the first
sighting. Any real `sink` that renders or forwards records elsewhere needs the same id-keyed
dedup/merge. It is not something specific to this example.

## Why npm, and why outside the workspace

None of the `hakka-*` packages are published to npm yet. This example depends on `hakka-node` via
a `file:` path (see `package.json`), with `hakka-core`/`hakka-bridge` (the packages `hakka-node`
itself depends on) pinned to the same directories via `overrides`. That's the identical pattern
`examples/next-fullstack` uses; see that example's `"//overrides"` note.

This directory is nested under `packages/hakka-node/examples/`, one level deeper than the root
workspace's `packages/*` glob matches, so it is **not** a workspace member. `npm install` here
resolves `hakka-node` the way a real external consumer would, not through hoisted monorepo
`node_modules`. Install with `npm`, not `bun`: `bun install` lays `file:` deps out as per-file
symlinks rather than a real copy. That's unrelated to this example's frameworks, but matches the
same caveat `examples/next-fullstack`'s README documents for Turbopack; `npm` is the safer default
for a `file:`-dependent example in general, not just that one.

Run `just build-core build-bridge build-node` from the repo root first if `packages/*/dist` isn't
built yet. `npm install`'s `file:` copy captures whatever is on disk at install time, dist
included.
