/**
 * Server-side trace propagation. Runs each incoming HTTP request that
 * carries a Hakka trace header inside an AsyncLocalStorage context, and
 * registers that store as hakka-core's trace provider — so the route handler
 * and every upstream `fetch`/`http` call it makes inherit the incoming
 * request's `correlationId`, linking the full stack. See
 * [Trace correlation](/node/overview/#trace-correlation) for the wire format.
 *
 * Dual header contract: prefers `x-hakka-trace`; falls back to W3C
 * `traceparent` (32-hex trace-id segment adopted directly as the
 * correlationId) so an already-OTel-instrumented upstream still links up.
 * Outgoing calls (`httpInterceptor.ts`) emit BOTH headers.
 *
 * Mechanism: patches `http`/`https` `Server.prototype.emit` so that when a
 * `'request'` fires, the incoming trace header is read and the rest wrapped
 * in `store.run(id, …)`. Node runtime only.
 *
 * `TRACEPARENT_HEADER`/`buildTraceparent` are re-exported from hakka-core's
 * platform-neutral `engine/traceparent` rather than implemented here — the
 * browser fetch interceptor needs the identical derivation for its own
 * outgoing `traceparent`, and one shared implementation is the only way to
 * guarantee the two never drift apart.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import nodeHttp from 'node:http'
import nodeHttps from 'node:https'

import { HAKKA_TRACE_HEADER, TRACEPARENT_HEADER, buildTraceparent, setTraceProvider } from 'hakka-core'

export { TRACEPARENT_HEADER, buildTraceparent }

/**
 * The per-request async context stored in `store` below. Carries a `debug`
 * cohort flag (ADR 0002) alongside `traceId` — `debug: true` marks a request
 * as part of the production debug cohort independent of its trace header, so
 * `cohortGate()` can turn capture on for exactly those requests.
 */
export interface TraceContext {
  traceId: string
  /** True when this request is part of the ADR 0002 production debug cohort. */
  debug?: boolean
  /**
   * Best-effort hint from inbound headers (RSC:1 / next-action), combined
   * with the root span's `next.rsc` attribute in `spanProcessor.ts`'s
   * `onEnd`. UNVERIFIED whether these headers survive to this read point.
   */
  requestKindHint?: 'rsc' | 'server-action'
}

const store = new AsyncLocalStorage<TraceContext>()

interface ServerProto {
  emit: (event: string, ...args: unknown[]) => boolean
}

let patched = false
const saved: Array<{ proto: ServerProto; fn: ServerProto['emit'] }> = []

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node
}

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

/**
 * Parse a W3C `traceparent` header value. Returns the 32-hex trace-id segment
 * (lowercased) when the header is well-formed and its version/ids are not the
 * reserved all-zero values, otherwise `undefined`.
 */
export function parseTraceparent(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = TRACEPARENT_RE.exec(value.trim())
  if (!match) return undefined
  const [, version, traceId, parentId] = match
  if (traceId === '0'.repeat(32) || parentId === '0'.repeat(16)) return undefined
  // version 'ff' is explicitly forbidden by the spec.
  if (version.toLowerCase() === 'ff') return undefined
  return traceId.toLowerCase()
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const raw = headers?.[name]
  return Array.isArray(raw) ? raw[0] : raw
}

/**
 * Resolve the correlation id an incoming request carries: prefer Hakka's own
 * `x-hakka-trace`; fall back to parsing `traceparent`.
 */
export function parseIncomingTraceId(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const own = headerValue(headers, HAKKA_TRACE_HEADER)
  if (own) return own
  return parseTraceparent(headerValue(headers, TRACEPARENT_HEADER))
}

/**
 * Best-effort `requestKind` hint from inbound headers: `next-action`
 * (server action) takes priority over `rsc: 1` (RSC data request) — both
 * read at the same point `parseIncomingTraceId` does. See `TraceContext.requestKindHint`'s
 * doc for the unverified-header-survival caveat.
 */
export function parseRequestKindHint(
  headers: Record<string, string | string[] | undefined> | undefined,
): 'rsc' | 'server-action' | undefined {
  if (headerValue(headers, 'next-action')) return 'server-action'
  if (headerValue(headers, 'rsc') === '1') return 'rsc'
  return undefined
}

/**
 * Start reading incoming trace headers (`x-hakka-trace`, falling back to
 * `traceparent`) into an async context and expose it to hakka-core captures.
 * Idempotent; returns a teardown. No-op off Node.
 */
export function enableTracePropagation(): () => void {
  setTraceProvider(() => store.getStore()?.traceId)
  if (patched || !isNodeRuntime()) return () => disableTracePropagation()
  patched = true

  for (const mod of [nodeHttp, nodeHttps]) {
    const proto = mod.Server.prototype as unknown as ServerProto
    const orig = proto.emit
    saved.push({ proto, fn: orig })
    proto.emit = function (this: unknown, event: string, ...args: unknown[]): boolean {
      if (event === 'request') {
        // This wraps Node's own Server.prototype.emit for EVERY incoming
        // request, so it is the most dangerous place in the package to throw
        // from — one bad header would break the app's request handling, not
        // just its capture. Every other capture path guards its prologue this
        // way ("a listener must never break the request"); this one did not.
        let context: { traceId: string; requestKindHint?: ReturnType<typeof parseRequestKindHint> } | null = null
        try {
          const req = args[0] as { headers?: Record<string, string | string[] | undefined> } | undefined
          const id = parseIncomingTraceId(req?.headers)
          if (id) context = { traceId: id, requestKindHint: parseRequestKindHint(req?.headers) }
        } catch {
          context = null
        }
        if (context) return store.run(context, () => orig.apply(this, [event, ...args]))
      }
      return orig.apply(this, [event, ...args])
    }
  }

  return () => disableTracePropagation()
}

/** Restore the original server emit and clear the trace provider. */
export function disableTracePropagation(): void {
  setTraceProvider(null)
  for (const { proto, fn } of saved) proto.emit = fn
  saved.length = 0
  patched = false
}

/** The trace id of the request currently being handled, if any. */
export function currentServerTraceId(): string | undefined {
  return store.getStore()?.traceId
}

/** The full trace context (id + cohort `debug` flag) for the request currently being handled, if any. */
export function currentTraceContext(): TraceContext | undefined {
  return store.getStore()
}

/**
 * Run `fn` inside a trace context, independent of any incoming request
 * header — the ADR 0002 hook for app middleware: call unconditionally for
 * allowlisted users, and `ctx.debug: true` makes `cohortGate()` return `true`
 * for everything inside `fn`. Nests correctly with the ALS context
 * `enableTracePropagation` sets up from an incoming header (innermost
 * `run()` wins, standard `AsyncLocalStorage` behavior).
 */
export function runInTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return store.run(ctx, fn)
}

/**
 * Adopt `otelTraceId` as this request's `correlationId`, but ONLY if no trace
 * context exists yet — the pure SSR/document-navigation case where no
 * `x-hakka-trace`/`traceparent` header was present (see `spanProcessor.ts`'s
 * `onStart`). No-op when a context already exists — never overwrites an
 * already-working header-derived correlationId.
 *
 * Uses `.enterWith` (not `.run`): the caller is a SpanProcessor's synchronous
 * `onStart` hook with no callback to wrap; this mutates the CURRENT
 * execution's context in place, which `enterWith` does and `run` cannot
 * (there is nothing to pass as `run`'s second argument here).
 */
export function adoptOtelTraceId(otelTraceId: string): void {
  if (store.getStore()) return
  store.enterWith({ traceId: otelTraceId })
}

/**
 * A `shouldCapture` gate (see `serverCapture.ts`'s `shouldCapture`/`sampleRate`
 * composition) that captures exactly the requests running inside a
 * `debug: true` trace context — the ADR 0002 cohort mechanism. Compose with a
 * sampling rate, or pass directly as `shouldCapture` to capture the cohort
 * unconditionally.
 */
export function cohortGate(): () => boolean {
  return () => currentTraceContext()?.debug === true
}
