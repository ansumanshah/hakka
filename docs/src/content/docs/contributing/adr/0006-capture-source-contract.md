---
title: 'ADR 0006 — CaptureSource, the first contract off ADR 0009'
description: The CaptureSource interface — identity, lifecycle, emission, correlation, and teardown — mapped onto Hakka's nine existing capture mechanisms; two are migrated so far.
---

Status: Implemented · Date: 2026-08-15 · Implements [ADR 0009](/contributing/adr/0009-contracts-first-internals/)

> **Complete (2026-08-17).** All eight distinct mechanisms below now ship a
> `CaptureSource` wrapper, each verified by the conformance harness
> (`checkCaptureSourceConformance`) and each exported from its package's public
> barrel: fetch, XHR, WebSocket and console (`hakka-core`), Resource Timing
> (`hakka-browser`), node `http`/`https` and the OTel span bridge
> (`hakka-node`), and CDP (`hakka`). Mechanism 6, the browser Worker relay, is
> not a distinct source — it calls the same three interceptors inside a Worker
> scope — so it is covered by their wrappers rather than getting its own.
>
> The contract is **frozen**: eight implementations is well past ADR 0009's
> rule-of-three condition, so `@experimental` is gone from
> `captureSource.ts`/`conformance.ts` and any future member must be optional
> with a fail-open consumer.
>
> One defect surfaced during the migration and was fixed across every source,
> including the two that shipped first: lifecycle guards used a single
> `stopped` boolean, which a `start() → stop() → start()` sequence resets, so
> an emission still in flight from the first cycle could reach that cycle's
> stale context — a direct violation of the "no further emissions, including
> work already in flight" clause below. All sources now share
> `createCycleGuard()` (`contract/cycleGuard.ts`), which retires a cycle
> permanently.

This ADR shipped as a **design-doc-only slice**: the `CaptureSource`
TypeScript contract and a conformance harness, both `@experimental`, changing
no existing code path on landing. Migrating mechanisms onto the contract is
separate, opportunistic work (ADR 0009 condition 4), one source at a time,
each its own PR with its own bench-gate check — two are done, see the
progress note above.

## Context

ADR 0009 named `CaptureSource` as one of three axes getting formal,
third-party-capable plugin machinery, and set four conditions any contract
built for it must satisfy: performance budgets stay regression gates with
**no per-record dynamic dispatch on hot paths**, a contract ships as
**tests + docs or it doesn't merge**, no duplication of an existing shape,
and it stays `@experimental` until a **rule-of-three** freeze. This ADR is
that contract's first slice.

Hakka today has nine independent capture mechanisms, each hand-rolling its
own version of the same handful of concerns — idempotent start/stop,
fail-open error handling, teardown that undoes every side effect, and either
`NetworkRequest` or `FrameworkSpan` emission:

| #   | Mechanism                                           | File                                                                                           |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | `fetch` interceptor                                 | `packages/hakka-core/src/capture/fetch.ts`                                                     |
| 2   | XHR interceptor                                     | `packages/hakka-core/src/capture/xhr.ts`                                                       |
| 3   | WebSocket interceptor                               | `packages/hakka-core/src/capture/websocket.ts`                                                 |
| 4   | Console interceptor                                 | `packages/hakka-core/src/capture/console.ts` + `packages/hakka-browser/src/capture/console.ts` |
| 5   | Browser Resource Timing enrichment                  | `packages/hakka-browser/src/capture/resourceTiming.ts`                                         |
| 6   | Browser Worker relay (fetch/XHR/WS inside a Worker) | `packages/hakka-browser/src/workerCapture.ts`                                                  |
| 7   | Node `http`/`https` + `fetch` server capture        | `packages/hakka-node/src/httpInterceptor.ts` + `serverCapture.ts`                              |
| 8   | Node OTel span bridge                               | `packages/hakka-node/src/spanProcessor.ts`                                                     |
| 9   | CDP (DevTools Protocol) capture                     | `packages/hakka/src/cdp/capture.ts` + `attach.ts`                                              |

(ADR 0009's own text lists "fetch/XHR/WS/ResourceTiming/http/undici/OTel-spans/CDP"
— eight names. Mechanism 6, the Worker relay, isn't a distinct ninth
_source_: `workerCapture.ts` calls the literal same `enableFetchInterceptor`/
`enableXHRInterceptor`/`enableWebSocketInterceptor` functions as mechanisms
1–3, just inside a Worker global scope with `postMessage` standing in for the
direct callback. It's included as its own row below because that
substitution is exactly the kind of "awkward fit" this ADR is asked to be
honest about — see the mapping table.)

Two structural facts about these nine drove the interface shape:

**Record emission already has one canonical entry point on RN/web.**
`HakkaFacade`'s `ingest(request: NetworkRequest)` — and the identical
`HakkaPluginContext.ingest` handed to plugins via `Hakka.use()` — is the
single place a `NetworkRequest` enters the store, with dedup, retention, and
listener/sink dispatch running once, in one place
(`packages/hakka-core/src/engine/HakkaFacade.ts:519,620`). Every built-in
interceptor already reaches it through the same `RequestListener` callback
parameter. `CaptureSource` doesn't need to invent a new ingest path — it
needs to hand a source that exact function.

**Span emission has no centralized entry point at all.** Unlike records,
hakka-core's RN/web engine has no built-in span store. Span persistence is
host-specific: the browser worker keeps its own `spansByTrace` `Map` and
`ingestSpan()` function (`packages/hakka-browser/src/worker/storeEngine.ts:50-67`);
`hakka-node`'s `enableTraceSpans()` hands a bare `sink: (span: FrameworkSpan)
=> void` callback to whatever the caller wired up — in practice
`bridge?.sendSpan(span)` (`packages/hakka-node/src/serverCapture.ts:193`).
This asymmetry is a real fact about the codebase, not an oversight to paper
over — the contract represents it honestly (`ctx.emitSpan` is optional; see
Emission below) rather than pretending hakka-core has a span store it
doesn't.

A third fact, not load-bearing for the shape but worth naming: Node's
`serverCapture.ts` is already a small ad-hoc "registry of sources" — it
composes fetch + http + undici-timing enrichment + trace propagation +
the OTel span bridge behind one options object and one `start()`/`stop()`
pair (`packages/hakka-node/src/serverCapture.ts:167-258`). That it already
works this way, unprompted, is evidence the `CaptureSource` shape below
isn't a foreign import — it's naming a pattern that already exists.

## Decision

Ship `CaptureSource` as an `@experimental` contract in
`packages/hakka-core/src/contract/captureSource.ts`, plus a conformance
harness in `packages/hakka-core/src/contract/conformance.ts` (tested against
a trivial in-memory fake in `conformance.test.ts`, per ADR 0009's
"contract = tests + docs" condition). The full interface, verbatim from that
file:

```ts
export interface CaptureSourceIdentity {
  readonly id: string
  readonly runtime: RequestRuntime
  readonly transport: string
}

export type CaptureCorrelation = 'none' | 'originates' | 'inherits' | 'adopts-foreign'

export interface CaptureSourceContext {
  ingest(request: NetworkRequest): void
  emitSpan?(span: FrameworkSpan): void
  update?(partial: Partial<NetworkRequest> & { id: string }): boolean
  getLogs?(): readonly NetworkRequest[]
}

export interface CaptureSource extends CaptureSourceIdentity {
  readonly correlation: CaptureCorrelation
  start(ctx: CaptureSourceContext): void | Promise<void>
  stop(): void | Promise<void>
}
```

(Doc comments on every member — including the full binding lifecycle
contract — live in the source file; they're not repeated here to avoid the
two drifting. Read `captureSource.ts` alongside this ADR.)

### Why this shape

**Identity** (`id`, `runtime`, `transport`) reuses `RequestRuntime` —
`'client' | 'server' | 'edge'`, the vocabulary ADR 0001 already stamps on
every `NetworkRequest` and `FrameworkSpan` — instead of inventing a parallel
one. `transport` is deliberately a _different, wider_ string than
`NetworkRequest`'s own `source: RequestType` field (`'fetch' | 'xhr' |
'websocket' | 'native' | 'http'`, `packages/hakka-core/src/model/types.ts:10`).
Conflating them would mean either widening `RequestType` for every new
source (a public-API change to an existing type, out of scope for a
docs-only slice) or lying about a source's `transport` to fit the existing
enum. `transport` is contract-level metadata for introspection — a future
registry or debug log — never written onto a record.

**Lifecycle** codifies a convention that already exists independently in
five different files, byte-for-byte the same idea each time: a module-level
"already patched" guard that makes a second `start()` (or `enable*`) call a
safe no-op, and a `stop()` that's equally safe to call before any `start()`
or a second time after one. `enableFetchInterceptor`/`enableXHRInterceptor`/
`enableWebSocketInterceptor` all open with `if (<flag>) return () =>
disable()`; `hakka-node`'s `startCapture` opens with `if (active) return
active`; `createCdpCapture` (`packages/hakka/src/cdp/capture.ts:82-101`)
uses explicit `started`/`stopped` booleans and documents `stop()` as "never
throws — a transport that's already closed is a normal way for `stop()` to
be called." `CaptureSource`'s lifecycle contract names this convention once,
instead of leaving every future source to rediscover it (or not) by reading
five files.

**Emission — no new hot-path indirection.** This is the load-bearing
decision and the one ADR 0009's conditions gate hardest. `ctx.ingest` has
the _identical_ signature to `RequestListener` — the type every
`enable*Interceptor` function already accepts
(`packages/hakka-core/src/model/types.ts:273`) — and on RN/web is backed by
the literal same function as `HakkaPluginContext.ingest`
(`packages/hakka-core/src/engine/plugins.ts:54`, wired to
`HakkaFacade#ingestRequest` at `HakkaFacade.ts:113`). A migrated source
receives this function ONCE, at `start()`, and calls it directly on every
capture — there is no `CaptureSource`-shaped method a host invokes per
record, no registry loop dispatching through an interface, no wrapper
closure allocated per call. The call a migrated `enableFetchInterceptor`
would make is `ctx.ingest(request)` — exactly the `onRequest(request)` call
it already makes today, same call site, same monomorphic V8 inline cache.
See "The hot path stays monomorphic" below for the enforcement plan.

`ctx.emitSpan` is optional for the reason given in Context: hakka-core's
engine has no span store, so a host without one (which is most of them,
today) simply never provides it, and a span source drops the span rather
than buffering it hoping a host shows up later — fail-open, not
fail-silent-forever. `ctx.update` and `ctx.getLogs` exist because one real
source (Resource Timing, row 5 below) needs them and they already exist as
`HakkaPluginContext.update`/a superset of what `Hakka.getLogsByUrl` does
internally — see that row's "awkward fit" note for what's _not_ fully
solved by adding them.

**Correlation declaration** turns four behaviors that are currently
implicit — discoverable only by reading each source's code — into one typed
field per source. `resolveOutgoingTrace()` (`packages/hakka-core/src/engine/trace.ts:77`)
is `'originates'`'s home; `currentTraceId()` read from
`AsyncLocalStorage` (`packages/hakka-node/src/trace.ts`) is `'inherits'`;
`adoptOtelTraceId()` (`packages/hakka-node/src/spanProcessor.ts:268`) is
`'adopts-foreign'`; the WebSocket interceptor, which never touches trace
headers at all, is the honest example of `'none'`.

**Error / fail-open semantics** are documented on `CaptureSource` itself
(not encoded as types — TypeScript can't express "never throws") and
enforced by the conformance harness's double-start/double-stop/post-stop
checks. The rule mirrors what every interceptor's `try { ... } catch { /*
never break the app */ }` blocks already do by hand throughout
`capture/fetch.ts` and `httpInterceptor.ts`: a capture-path failure drops
the one event and lets the real operation proceed untouched; only
`start()`/`stop()` may reject, and a rejection must leave the source
restartable, never wedged.

**Teardown guarantees** — restore every patched global, remove every
listener, clear every timer, and stop delivering to `ctx` even for
in-flight async work — are exactly what `createCdpCapture`'s `stopped` flag
and `hakka-node`'s `spanProcessor.ts` `state.stopped` flag already enforce
by hand. The contract names the pattern; it doesn't invent a new one.

### Mapping today's nine mechanisms onto the contract

| #   | Mechanism                                           | `runtime`                                                                                                                                 | `transport`                                               | `correlation`                                                                                                                                         | Emits via                                                                                   | Fit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `fetch` interceptor                                 | `client` (also reused server-side by `hakka-node`, tagged `runtime: 'server'` after the fact by `serverCapture.ts`'s `onRequest` wrapper) | `hakka.fetch`                                             | `originates`                                                                                                                                          | `ctx.ingest`                                                                                | **Clean.** `onRequest: RequestListener` already IS `ctx.ingest`; nothing to adapt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | XHR interceptor                                     | `client` (browser-only global)                                                                                                            | `hakka.xhr`                                               | `originates`                                                                                                                                          | `ctx.ingest`                                                                                | **Clean.** Same shape as fetch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | WebSocket interceptor                               | `client`                                                                                                                                  | `hakka.websocket`                                         | `none` — never calls `resolveOutgoingTrace`/injects a trace header today                                                                              | `ctx.ingest`, called repeatedly per connection (debounced, same `id` each time)             | **Clean**, and a good illustration that `ctx.ingest` already supports "many calls, one logical record" — `findDuplicateRequest`/`mergeDuplicateRequest` handle the merge downstream, so the source needs no extra machinery.                                                                                                                                                                                                                                                                                                                                                        |
| 4   | Console interceptor                                 | `client`/RN (core) — no Node console capture exists today                                                                                 | `hakka.console`                                           | `none`                                                                                                                                                | **Neither** — `ConsoleEntry` is not a `NetworkRequest` or `FrameworkSpan`                   | **Awkward.** Console entries are shaped like a `BreadcrumbRecord` (`model/contract.ts`'s `ContractRecord` union), not a `NetworkRequest`. `CaptureSourceContext` has no generic `emitRecord?(record: ContractRecord)` slot — deliberately not added here (scope: this slice is records + spans only, per the task brief). Today's `ConsoleInterceptor.onEntry`/`enableConsoleCapture` stay a wholly separate, unintegrated listener mechanism, outside `HakkaFacade`/`PluginRegistry` entirely. Flagged as a real gap for whoever designs the next contract slice, not solved here. |
| 5   | Browser Resource Timing enrichment                  | `client`                                                                                                                                  | `hakka.resource-timing`                                   | `none`                                                                                                                                                | **Neither new records nor spans** — calls `ctx.update`, an enrichment of an EXISTING record | **Awkward.** This is why `update`/`getLogs` exist on the context at all, but they only approximate what `storeEngine.applyResourceTiming` does today: an indexed `Hakka.getLogsByUrl(url)` lookup (`HakkaFacade.ts:509`) narrowed to `O(k)` matches for that URL, then the closest by `startTime`. `CaptureSourceContext.getLogs()` returns the flat, unindexed snapshot — a migrated Resource Timing source would either eat an `O(n)` filter per timing entry or the context would need a URL-scoped read method this slice doesn't add. Left as observed debt, not solved.       |
| 6   | Browser Worker relay (fetch/XHR/WS inside a Worker) | `client`                                                                                                                                  | same ids as rows 1–3 — not a distinct source, see Context | `originates` (inherited from the interceptors it wraps)                                                                                               | `ctx.ingest`, but see Fit                                                                   | **Awkward in a subtle way.** `workerCapture.ts`'s `post()` stands in for `ctx.ingest` inside the Worker's JS realm, then crosses to the main thread via `postMessage` — a fundamentally async, serialization-boundary hop, not a direct synchronous function call. The contract's `ctx.ingest(request): void` signature doesn't distinguish "cheap direct call" from "queued cross-thread message" — intentionally, a host is free to implement it however it needs to — but a reviewer relying on "`ctx.ingest` is always synchronous/free" would be wrong for this one.           |
| 7   | Node `http`/`https` + `fetch` server capture        | `server`                                                                                                                                  | `hakka.http`                                              | `inherits` — reads `currentTraceId()` from `AsyncLocalStorage`, injects `x-hakka-trace` + `traceparent` outbound, never originates                    | `ctx.ingest`                                                                                | **Clean.** `serverCapture.ts`'s composed `onRequest` closure (sink + bridge send, `serverCapture.ts:198-204`) already does everything a real `ctx.ingest` implementation would do internally — a migration hands a source that closure unchanged.                                                                                                                                                                                                                                                                                                                                   |
| 8   | Node OTel span bridge                               | `server`                                                                                                                                  | `hakka.otel-span`                                         | `adopts-foreign` — `adoptOtelTraceId()` bridges OTel's trace-id format into Hakka's ambient context rather than minting/inheriting a Hakka-native one | `ctx.emitSpan`                                                                              | **Cleanest fit of all nine** — this is the task's "first planned consumer." `enableTraceSpans(sink, runtime)`'s `sink: (span: FrameworkSpan) => void` parameter is already byte-for-byte `ctx.emitSpan`'s shape. Note: hakka-node has no local span store either (spans just forward to `bridge?.sendSpan`), so a migrated node host would wire `ctx.emitSpan = bridge.sendSpan` directly — again, no new indirection.                                                                                                                                                              |
| 9   | CDP capture                                         | `client` (attaches to a browser page)                                                                                                     | `hakka.cdp`                                               | `none` today — the mapper doesn't read/propagate trace headers from CDP's `Network.*` events, though a future version plausibly could                 | `ctx.ingest`                                                                                | **Clean, and the best exemplar of the async lifecycle rules.** `createCdpCapture` already has the exact `started`/`stopped` flag pair the contract's teardown guarantee describes, including the "in-flight async work must check `stopped`" case (`Network.getResponseBody`'s round-trip after `loadingFinished`, guarded by `stopped` at `capture.ts:59`).                                                                                                                                                                                                                        |

Three of nine are honestly awkward (console, resource timing, the worker
relay's realm boundary); six map cleanly with zero adaptation of the
existing call site. That ratio is the evidence this shape is real, not
aspirational — it was derived from reading all nine, not designed first and
checked second.

### The hot path stays monomorphic (ADR 0009's binding condition)

The ingest hot path is `HakkaFacade#ingestRequest` →
`RingBuffer.add`/`RingBuffer.update`, benchmarked today at 339 ns against a
700 ns regression ceiling (`packages/hakka-core/bench/RESULTS.md`,
`bun run --cwd packages/hakka-bench bench:check`). `CaptureSource` adds **zero** calls to this
path in this slice — the contract is types and a harness, imported by
nothing that runs. The commitment this ADR makes for every _future_
migration:

1. A migrated source's `ctx.ingest` call must be the plain function
   reference captured once in the source's own closure at `start()` —
   never a property lookup on a `CaptureSource`-typed value
   (`source.context.ingest(...)`), never a loop over a registry
   (`for (const source of sources) source.ingest(record)`), never a v-table
   dispatch through an interface method invoked per record. If a migration
   PR's diff touches `ingestRequest`, `RingBuffer.add`, or the
   `dispatchToListeners`/`dispatchToSinks` path at all, that's the signal
   review should reject it — this contract's whole point is that those
   functions don't change.
2. Every migration PR must run `bun run --cwd packages/hakka-bench bench:check` before and after
   and paste both tables. A regression on `RingBuffer.add`,
   `RingBuffer.update` (there's no dedicated bench entry for `update` yet —
   add one in the migration PR that first touches it), or any op the
   migrated source's own code path now shares must block merge, per ADR
   0003's "performance budgets are regression gates" condition verbatim.
3. This ADR does not add a new bench entry itself — there is no new runtime
   code to measure yet.

### Conformance harness

`checkCaptureSourceConformance` (`packages/hakka-core/src/contract/conformance.ts`)
takes a `CaptureSourceProbe` — a factory for a fresh, unstarted source plus a
`triggerOnce(source)` callback the implementor supplies (there's no generic
way to "cause a fetch call"; only the source's own author knows how to
simulate one event through it) — and runs six independent checks: `stop()`
before any `start()` is a no-op; a second `start()` doesn't double-wire
emission (checked by asserting exactly one emission after exactly one
`triggerOnce()`); a second `stop()` is a no-op; emission reaches the
context's `ingest`/`emitSpan`; nothing is emitted after `stop()`; and a
`start()` → `stop()` → `start()` cycle re-arms the source.

`conformance.test.ts` runs this against three in-memory fakes, none of which
do real interception: a well-behaved one (asserted to pass every check), and
two deliberately broken ones — one that double-wires on a second `start()`,
one that keeps emitting after `stop()` because it forgets to clear its
context reference — each asserted to fail exactly the check that names its
bug. The broken fakes exist because a verifier that only ever sees passing
input hasn't proven it can fail; this one demonstrably can, on both bug
classes ADR 0009's condition calls out (idempotency, fail-open).

## Consequences

- The contract is exported from `hakka-core`'s module graph but deliberately
  has **no package-exports subpath yet** — external consumers cannot import it
  from the published package until the first real migrations validate the
  shape (rule of three). This is staging, not an oversight.

- Nine files keep working unchanged. This ADR is discoverable, reviewable
  design with zero blast radius.
- The next real step is a single-source migration — the OTel span bridge
  (row 8) is the strongest first candidate: cleanest fit, and the task brief
  independently names it "the first planned consumer." That migration is
  intentionally NOT part of this slice.
- Console (row 4) exposes a real gap this contract doesn't solve: a
  `ContractRecord`-shaped emission path for non-network capture kinds
  (breadcrumbs, metrics). Whoever designs that slice should read this ADR's
  row 4 note first rather than rediscovering the shape mismatch.
- Resource Timing (row 5) exposes that `CaptureSourceContext.getLogs()` is a
  weaker read primitive than the indexed lookup `storeEngine.applyResourceTiming`
  already has. Either accept the `O(n)` cost on migration or extend the
  context later — undecided, not blocking this slice.
- `CaptureSource` stays `@experimental` and unfrozen until its third real
  consumer, per ADR 0009. `knip.jsonc` carries a deliberate suppression for
  its currently-unconsumed exported types, with a comment explaining why and
  when to remove it.

## Alternatives considered

- **A single `emit(record: NetworkRequest | FrameworkSpan)` method** instead
  of separate `ingest`/`emitSpan` — rejected: it would force every source
  (and every host wiring a context) to runtime-discriminate a union on the
  hot path, which is exactly the per-call dispatch tax ADR 0009 forbids.
  Two plain, separately-optional function slots cost nothing extra to call
  and let a records-only source never touch the spans concept at all.
- **An `emits: readonly ('records' | 'spans')[]` identity field**, so a host
  could decide up front whether to bother wiring `emitSpan` — considered,
  deferred. Nothing consumes it yet (no registry exists to read it), and the
  task brief named exactly `id`/`runtime`/`transport` for identity. Revisit
  if/when a real registry needs to filter sources by emission kind.
- **Migrating Resource Timing or the OTel bridge in this same PR** to prove
  the contract end-to-end — rejected per this task's explicit scope: design
  doc plus a conformance-harness skeleton, no migrations, no changes to any
  existing code path.
- **Widening `NetworkRequest.source`/`RequestType`** to absorb `transport`
  so there's only one vocabulary — rejected: that's a change to an existing
  public type or in `model/types.ts`, out of scope here, and conflates a
  contract-level introspection label with a value written onto every stored
  record forever.
