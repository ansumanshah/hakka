# Framework servers

Each demo starts an upstream API and an application server, sends a traced
request, and verifies that the outbound call carries the same `correlationId`.
Captured records print to stdout; no inspector is required.

| File           | Server                        | Outbound capture |
| -------------- | ----------------------------- | ---------------- |
| `raw-http.mjs` | `node:http`                   | `http.get`       |
| `express.mjs`  | Express 5                     | `fetch`          |
| `fastify.mjs`  | Fastify 5                     | `fetch`          |
| `hono.mjs`     | Hono with `@hono/node-server` | `fetch`          |
| `bun.mjs`      | Native `Bun.serve`            | `fetch`          |

## Run

```sh
npm install
npm run demo          # four Node examples
npm run demo:bun      # requires Bun
```

Individual Node examples use `demo:raw-http`, `demo:express`, `demo:fastify`,
and `demo:hono`. A successful run prints `trace check: PASS`; a failed trace
check sets a nonzero exit code.

The repository packages are not published yet. This standalone consumer uses
local `file:` dependencies and npm overrides; build Hakka's packages first.
It stays outside the root Bun workspace to exercise consumer resolution.

## Capture and tracing

`register({ force: true })` explicitly enables capture outside development.
The other demos use `startCapture()` and stop its handle during shutdown.
Node HTTP listeners inherit incoming trace headers automatically. The native
Bun handler supplies that context with `parseIncomingTraceId` and
`runInTraceContext`.

Fetch may emit again when body capture finishes. The shared sink upserts by ID
and prints each request once. HTTP capture emits response metadata without
reading the response body stream.

Bridge streaming is off by default. Set `HAKKA_BRIDGE=1` to embed a hub at
`ws://localhost:8989` and connect an inspector to it:

```sh
HAKKA_BRIDGE=1 npm run demo:bun
```
