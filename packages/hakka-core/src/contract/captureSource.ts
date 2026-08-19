/**
 * `CaptureSource` — the contract for a plugin-style capture producer (ADR
 * 0003, ADR 0006). Doc comments here are the authoritative spec;
 * `conformance.ts` checks any implementation against them.
 *
 * Frozen as of 2026-08-17: eight sources implement it (fetch, XHR, WebSocket,
 * console, Resource Timing, node http/https, OTel spans, CDP), well past ADR
 * 0003's rule-of-three condition, so the shape is settled and additions must
 * be optional with fail-open consumers. Types only, zero runtime code; must
 * never be imported from a hot path.
 */

import type { FrameworkSpan, NetworkRequest, RequestRuntime } from '../model/types'

/**
 * Identity fields a host (or a registry, or debug tooling) uses to describe
 * a source without running it. `transport` is introspection-only metadata,
 * deliberately wider than and never written onto `NetworkRequest.source`
 * (see ADR 0006).
 */
export interface CaptureSourceIdentity {
  /** Stable, unique, namespaced id (e.g. `'hakka.fetch'`, `'acme.grpc-web'`) so a third-party source can coexist with built-ins. */
  readonly id: string
  /** Where this source's code executes. */
  readonly runtime: RequestRuntime
  /** Free-form transport/protocol label — not written onto any record. */
  readonly transport: string
}

/**
 * How a source relates to cross-target trace correlation (ADR 0001) —
 * declared once per source, not per record.
 *
 * - `'none'` — no concept of a shared trace id (console).
 * - `'originates'` — mints a new id for traffic it initiates (client
 *   fetch/XHR, via `resolveOutgoingTrace`).
 * - `'inherits'` — reads an ambient id it didn't create (Node http/fetch,
 *   via `currentTraceId()` / AsyncLocalStorage).
 * - `'adopts-foreign'` — bridges a different trace-id system into Hakka's
 *   own (the OTel span source, via `adoptOtelTraceId`).
 */
export type CaptureCorrelation = 'none' | 'originates' | 'inherits' | 'adopts-foreign'

/**
 * Capabilities a `CaptureSource` receives at `start()`, built once by the
 * host and handed in as plain function references — not re-created or
 * re-dispatched per record, which is what keeps ingestion monomorphic (ADR
 * 0006). Mirrors `HakkaPluginContext.ingest`/`update`.
 */
export interface CaptureSourceContext {
  /**
   * Push one captured request into the store — same dedup/retention/dispatch
   * path as a built-in interceptor. Never throws and has no return value; a
   * source that can't construct a valid `NetworkRequest` should drop the
   * event, not call this with a partial one.
   */
  ingest(request: NetworkRequest): void
  /**
   * Push one framework span. Optional — hakka-core has no built-in span
   * store, so a host with nowhere to put spans omits this. A source MUST
   * treat its absence as fail-open: drop the span, never throw or buffer it
   * hoping a host shows up later.
   */
  emitSpan?(span: FrameworkSpan): void
  /**
   * Merge a partial update into an already-ingested record by id. Optional —
   * only an enrichment-style source (timing, retry correlation) needs it, not
   * one that only originates new records. Returns `false` when no record
   * with that id exists — not an error, just already evicted.
   */
  update?(partial: Partial<NetworkRequest> & { id: string }): boolean
  /**
   * Read-only snapshot access for a source correlating an incoming signal
   * against already-ingested records (e.g. Resource Timing matching a
   * `PerformanceResourceTiming` entry by url + start-time proximity).
   * Optional and NOT a hot path — call at most once per external signal,
   * never once per stored record. Only ordering guarantee: most recent
   * capture last.
   */
  getLogs?(): readonly NetworkRequest[]
}

/**
 * A capture source: observes traffic (or framework spans) and pushes it
 * into the store through `CaptureSourceContext` — the `CaptureSource` axis
 * from ADR 0003.
 *
 * Lifecycle contract (binding — `conformance.ts`'s harness checks all of
 * this against any implementation):
 *
 * - `start()` while ALREADY started is a no-op: must not throw, must not
 *   install a second copy of whatever it patches/subscribes to, and must
 *   not deliver a subsequent event to `ctx` more than once.
 * - `stop()` before any `start()`, or after a `stop()` that already ran, is
 *   also a no-op: must not throw.
 * - A `start()` → `stop()` → `start()` cycle must fully re-arm the source.
 *   Not the same guarantee as concurrent instances — a source is a
 *   process/module-level singleton by convention.
 * - Every capture-path error (malformed header, unserializable body, a
 *   throwing matcher) fails OPEN: the observed operation proceeds
 *   untouched, the source just drops that one event. `start()`/`stop()`
 *   themselves MAY reject, but that failure must leave the source
 *   stoppable/restartable, never wedged half-started.
 * - After `stop()` resolves, no further `ctx.ingest`/`ctx.emitSpan` call
 *   may occur for that instance — including for work already in flight
 *   when `stop()` was called. Check a local "stopped" flag before the
 *   final `ctx` call.
 * - Teardown must undo every side effect of `start()` — restore patched
 *   globals, remove every listener, clear every timer.
 */
export interface CaptureSource extends CaptureSourceIdentity {
  /** How this source relates to cross-target trace correlation (ADR 0001). */
  readonly correlation: CaptureCorrelation
  /**
   * Start capturing. Idempotent per the lifecycle contract above. May be
   * synchronous (a monkey-patch source like fetch/XHR/WebSocket) or async (a
   * CDP source awaiting `Network.enable`, an OTel bridge probing for a
   * registered `TracerProvider`).
   */
  start(ctx: CaptureSourceContext): void | Promise<void>
  /**
   * Stop capturing and undo every side effect of `start()`. Idempotent and
   * fail-open per the lifecycle contract above — never throws, even when
   * called before `start()` or a second time after an earlier `stop()`.
   */
  stop(): void | Promise<void>
}
