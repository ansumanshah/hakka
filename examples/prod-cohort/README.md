# Production capture for a debug cohort (`hakka-node/prod`)

Everywhere else in Hakka, capture is dev's tool: everyone is captured, redaction is
denylist-based and off until you configure it, and the browser overlay reaches the
server over `ws://localhost:8989`. `hakka-node/prod` is a **separate, capture-only**
entry point for the opposite situation: a bug that only reproduces on real production
traffic, for one account or one region, that you need to inspect after the fact for a
small named cohort of users. See [ADR 0002](../../docs/src/content/docs/contributing/adr/0002-production-capture-cohort.md)
for the full design rationale; this example proves the ADR's stated safety properties
against a real (if tiny) HTTP app, not just documents them.

This is the **one surface in the whole repo where body redaction defaults to ON**.
Everywhere else, redacting a JSON body field is something you opt into, right when
you're reading your own laptop's traffic. Here the traffic belongs to real users, so
`hakka-node/prod` ships `PROD_DEFAULT_BODY_REDACT_FIELDS` and makes capturing bodies
verbatim the thing you have to ask for. That asymmetry is the whole point of this
example.

## What the demo proves

`demo.mjs` runs `app.mjs` (a plain `node:http` server, no framework, proving the same
"instruments any Node backend" claim the root README makes) through six checks, each
against a live HTTP response:

1. **A request without the cohort header is not captured.** `app.mjs` wraps every
   request in `runInTraceContext({ traceId, debug }, ...)`, `debug` decided by a literal
   `x-debug-cohort: 1` header (standing in for whatever real allowlist check, session
   lookup, feature flag, user id, a real deployment would use; `hakka-node/prod` does
   not ship that check, ADR 0002 is explicit that deciding cohort membership is the
   app's own job).
2. **A cohort request to a URL NOT on `captureUrls` is still not captured.** The other
   half of the AND-gate: `startProdCapture` requires BOTH the cohort flag AND a
   `captureUrls` match, so a cohort member's request to an unlisted URL is invisible
   too.
3. **Bodies come back redacted by default**, on both sides of the outbound hop: the
   app's own outbound REQUEST body (it POSTs a note containing a stray `password`
   field to an upstream "notes" service) and the upstream's RESPONSE body (which
   echoes the note back with an added `token` field). Non-sensitive fields (`note`)
   are left alone: this is targeted redaction, not a blanket wipe.
4. **The pull route rejects a missing or wrong bearer token**, and accepts the correct
   one. Two "wrong token" cases are checked deliberately: a different-length token
   (short-circuits before `timingSafeEqual` even runs) and a same-length wrong token
   (exercises the actual constant-time byte comparison). See `safeEqual` in
   `src/prod.ts`.
5. **(bonus) the `?user=` correlationId-prefix filter** on the pull route: `?user=alice`
   returns the captured record, `?user=bob` returns nothing.

## Run it

```sh
npm install   # see "Why npm, and why outside the workspace" below
npm run demo
```

Real output from a run against this repo:

```
prod-cohort demo  (app on http://127.0.0.1:62236, upstream on http://127.0.0.1:62235)
-------------------------------------------------------------------------------------
  pull token (demo-only, a real deployment reads this from a secret): 2985bbe0-4de7-45f7-a39e-7af0bb93f31d
  [PASS] non-cohort request (no x-debug-cohort header) is NOT captured  (0 record(s) captured so far)
  [PASS] cohort request to the ALLOWLISTED URL (/notes) IS captured  (1 record(s) captured so far)
  [PASS] cohort request to a URL NOT on captureUrls (/admin/secret) is still NOT captured: the AND-gate  (1 record(s) captured so far)
  [PASS] captured OUTBOUND REQUEST body redacts `password`  ({"note":"forgot my password","password":"[REDACTED]"})
  [PASS] captured OUTBOUND REQUEST body leaves `note` intact (not blanket redaction)  ({"note":"forgot my password","password":"[REDACTED]"})
  [PASS] captured upstream RESPONSE body redacts `token`  ({"id":"note-1","note":"forgot my password","password":"[REDACTED]","token":"[REDACTED]"})
  [PASS] captured upstream RESPONSE body redacts the echoed `password` too  ({"id":"note-1","note":"forgot my password","password":"[REDACTED]","token":"[REDACTED]"})
  [PASS] pull route 401s with NO Authorization header
  [PASS] pull route 401s with a wrong bearer token (different length)
  [PASS] pull route 401s with a wrong bearer token (same length, exercises the timingSafeEqual path)
  [PASS] pull route 200s with the correct bearer token
  [PASS] pulled records match the ring buffer: only the allowlisted + cohort call
  [PASS] ?user=alice returns the alice record
  [PASS] ?user=bob returns nothing: no bob records were ever captured

14 passed, 0 failed
```

Exit code is non-zero if any check fails, so `npm run demo` also works as a smoke test.

## Files

| File                      | What it shows                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| `app.mjs`                 | The demo "prod app": cohort gate, `startProdCapture`, the pull route       |
| `demo.mjs`                | The six checks above, run against `app.mjs`'s live HTTP server             |
| `shared/upstream.mjs`     | The "notes" API `app.mjs` calls outbound to (the thing that gets captured) |
| `shared/fetchRequest.mjs` | `node:http` to Fetch `Request`/`Response` adapter for the pull route       |
| `shared/print.mjs`        | PASS/FAIL check tracking, shared across all six assertions                 |

### The pull route needs no framework

`createPullHandler`'s contract is `(request: Request) => Promise<Response>`, the exact
shape a Next.js route handler exports directly (`export const GET = createPullHandler(...)`,
per the root README). This app has no framework, so `shared/fetchRequest.mjs` does by
hand what Next/Hono/Express would do for you: build a standard `Request` from the
incoming `IncomingMessage`, and write the standard `Response` back out. Node's global
`Request`/`Response`/`Headers` make this a dozen lines, not a dependency: proof that
the pull route really is framework-agnostic, not just documented as such.

### Why `startProdCapture` instead of `startCapture`

`hakka-node/prod` is a **different module**, not a flag on the dev entry. The live
bridge transport (the browser overlay's WebSocket hub) and everything that rides along
with it (mock/rewrite/breakpoint control frames) are absent from `hakka-node/prod`'s
import graph entirely, not merely disabled. `app.mjs` imports `runInTraceContext` from
plain `hakka-node` (the cohort-gating primitive lives in `trace.ts`, shared by both
entries) but `startProdCapture`/`createPullHandler` from `hakka-node/prod` specifically.

## Why npm, and why outside the workspace

None of the `hakka-*` packages are published to npm yet. This example depends on
`hakka-node` via a `file:` path (see `package.json`), with `hakka-core`/`hakka-bridge`
(the packages `hakka-node` itself depends on) pinned to the same directories via
`overrides`, the identical pattern `examples/framework-servers` and
`examples/next-fullstack` use.

This standalone example is intentionally outside the Bun workspace. `npm install` here resolves `hakka-node` the way a real external consumer would, not
through hoisted monorepo `node_modules`. Install with `npm`, not `bun`: `bun install`
lays `file:` deps out as per-file symlinks rather than a real copy. See
`examples/framework-servers`' README for the fuller explanation of this caveat.

Run `just build-core build-bridge build-node` from the repo root first if
`packages/*/dist` isn't built yet. `npm install`'s `file:` copy captures whatever is on
disk at install time, dist included.
