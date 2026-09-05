# OTel span bridging (`hakkaSpanProcessor()` / `enableTraceSpans()`)

`packages/hakka-node/src/spanProcessor.ts` bridges an **already-registered** OpenTelemetry
`TracerProvider`'s spans into Hakka's `FrameworkSpan` record, surfacing a framework's own
request-tree spans (Next.js's Server Component / Route Handler / Server Action spans, in
the case the module doc is written against) in the inspector, without `hakka-node`
shipping any OTel SDK code itself. `@opentelemetry/api`/`@opentelemetry/sdk-trace-base`
are never imported statically, or even as types: the whole file duck-types a minimal
structural subset of the SDK's shapes instead, and fails open throughout.

There are **two ways** to attach, and which one actually works depends on which OTel SDK
generation is installed. This example proves the difference with two demos against a
real `@opentelemetry/sdk-trace-node` provider (2.x, the current release, see
`package.json`), not a mocked one:

| File                   | Attach path                                                      | Result on this SDK generation                                                     |
| ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `constructor-time.mjs` | `hakkaSpanProcessor()` passed to the provider's constructor      | **Spans delivered.** The recommended, SDK-2.x-safe path.                          |
| `attach-fallback.mjs`  | `enableTraceSpans()`'s old post-registration `attach()` fallback | **Zero spans delivered, silently.** The exact gotcha the root README warns about. |

## Why two paths exist at all

`@opentelemetry/sdk-trace-base` 2.x removed `TracerProvider.addSpanProcessor`:
processors can only be supplied at construction time now (`new NodeTracerProvider({ spanProcessors: [...] })`),
never attached afterward. Older SDKs (1.x) still exposed `addSpanProcessor` post-registration,
so `enableTraceSpans()` still tries that as a **best-effort fallback** (`attach()` in
`spanProcessor.ts`): a dynamic `import('@opentelemetry/api')`, a `getTracerProvider()` call,
one `ProxyTracerProvider.getDelegate()` unwrap, then a duck-typed `addSpanProcessor` probe.
On a 2.x provider that probe finds nothing, not an error, just nothing, because the
method genuinely does not exist on the class. `attach-fallback.mjs` reproduces exactly
that: it registers a real `NodeTracerProvider` with no `spanProcessors`, calls
`enableTraceSpans()` alone (the way someone who never read this gotcha would), and
asserts **zero** spans arrive. If that assertion ever starts failing, it means either
this example's OTel pin regained `addSpanProcessor` or `hakka-node`'s fallback logic
changed, either way, worth knowing.

`hakkaSpanProcessor()` sidesteps the whole problem: it returns a processor-shaped object
immediately and reads whatever `enableTraceSpans()` registers **later**, at call time, so
it can be constructed and handed to the provider before `enableTraceSpans()` (or a
framework's own `register()` that calls it, like `hakka-node/next`) has even run yet.
`constructor-time.mjs` calls them in exactly that order to prove it.

## What `constructor-time.mjs` also proves, beyond the attach path

It builds a small request-tree with `next.span_type`/`next.rsc` attributes (the exact
attribute names Next.js's own spans carry, see `spanProcessor.ts`'s `PRIMARY_SPAN_TYPES`/
`APP_RENDER_FETCH_SPAN_TYPE`) against a real `node:http` server and a real client request,
then checks:

- **Verbosity classification**: a span whose `next.span_type` is in the documented
  "primary" allowlist (`AppRouteRouteHandlers.runHandler`, `BaseServer.handleRequest`, …)
  is tagged `primary`; a span with no matching type is tagged `verbose`.
- **The `AppRender.fetch` dedup rule**: a span tagged `next.span_type: 'AppRender.fetch'`
  is the exact same operation `hakka-core`'s own fetch interceptor would capture as a
  `NetworkRequest` (with full headers/body/cache status), so `handleSpanEnd` drops it at
  the source rather than double-reporting it. This demo creates one and shows it's the
  only span of the four created that never reaches the sink.
- **`requestKind` classification**: the root span (the only span with `parentId: null`)
  gets classified `route-handler` because its `next.rsc` attribute is `'false'` and a
  descendant span carried `next.span_type: 'AppRouteRouteHandlers.runHandler'`
  (`classifyRequestKind` in `spanProcessor.ts`).
- **`adoptOtelTraceId`**: with no `x-hakka-trace` header on the incoming request (the pure
  SSR/document-navigation case), `hakkaSpanProcessor().onStart` adopts the root span's own
  OTel trace id as `currentServerTraceId()`'s value. The demo reads that id from inside the
  request handler and checks it against the `FrameworkSpan.traceId` the sink actually
  received for the root span, proof the two are the same value, not just documented to be.

## Run it

```sh
npm install   # see "Why npm, and why outside the workspace" below
npm run demo                     # both demos, one after another
npm run demo:constructor-time    # or just one
npm run demo:attach-fallback
```

Real output from a run against this repo:

```
constructor-time  (hakkaSpanProcessor() wired via spanProcessors: [...] at construction)
----------------------------------------------------------------------------------------
  client -> GET http://127.0.0.1:62223/  -> 200
  [span] AppRouteRouteHandlers.runHandler  (child of fd77f1ffcb43b0cf, primary)
  [span] ResolveMetadata.generateMetadata  (child of fd77f1ffcb43b0cf, verbose)
  [span] BaseServer.handleRequest  (root, primary)  requestKind=route-handler
  [PASS] exactly 3 spans delivered to the sink (root + 2 children; AppRender.fetch dropped)  (got 3)
  [PASS] AppRender.fetch was NOT delivered (deduped against hakka-core's own fetch capture)
  [PASS] root span classified verbosity=primary (BaseServer.handleRequest is in PRIMARY_SPAN_TYPES)
  [PASS] root span classified requestKind=route-handler (next.rsc=false + a route-handler child was seen)  (route-handler)
  [PASS] AppRouteRouteHandlers.runHandler classified verbosity=primary
  [PASS] AppRouteRouteHandlers.runHandler is a CHILD of the root span
  [PASS] ResolveMetadata.generateMetadata classified verbosity=verbose (no next.span_type attr)
  [PASS] hakka's own trace correlation adopted the OTel-native trace id (no x-hakka-trace header was sent)  (adoptedTraceId=d41cac0ae48865585438e086a6d3b851  root.traceId=d41cac0ae48865585438e086a6d3b851)

8 passed, 0 failed

attach-fallback  (no hakkaSpanProcessor() at construction time: attach()'s SDK-1.x path only)
---------------------------------------------------------------------------------------------
  client -> GET http://127.0.0.1:62225/  -> 200
  [PASS] 0 spans delivered: attach()'s post-registration addSpanProcessor probe found nothing on this SDK-2.x provider, exactly as documented  (got 0)
  Always wire hakkaSpanProcessor() at construction time instead (see constructor-time.mjs).

1 passed, 0 failed
```

Exit code is non-zero if either demo's own checks fail, so `npm run demo` (via
`run-all.mjs`) also works as a smoke test.

## In a real app

Wire `hakkaSpanProcessor()` the same way against `@vercel/otel` (what the root README's
Next.js section documents):

```ts
// instrumentation.ts
import { registerOTel } from '@vercel/otel'
import { hakkaSpanProcessor } from 'hakka-node'
import { register as hakkaRegister } from 'hakka-node/next'

export function register() {
  registerOTel({ serviceName: 'my-app', spanProcessors: [hakkaSpanProcessor()] })
  return hakkaRegister() // calls enableTraceSpans() internally when traceSpans is on
}
```

Outside Next, call `enableTraceSpans(sink, runtime)` directly (as both demos here do).
`hakka-node/next`'s `register()` is a thin wrapper that calls it for you with
`traceSpans` defaulted to `true` in development.

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
