/**
 * Best-effort bridge from an already-registered OpenTelemetry `TracerProvider`
 * to Hakka's `FrameworkSpan` record — surfaces Next.js's own request-tree
 * spans in the inspector without hakka-node shipping any OTel SDK code.
 * Design, the two attach paths (`attach()`'s SDK-1.x duck-type fallback vs.
 * `hakkaSpanProcessor()`'s SDK-2.x constructor-time path), and the
 * `requestKind` classification rules: see [Request Insights](/nextjs/overview/#request-insights-span-waterfall).
 *
 * `@opentelemetry/api`/`@opentelemetry/sdk-trace-base` are never imported
 * statically or even as types (optional peer — a consumer who never calls
 * `enableTraceSpans()` pays zero cost). This module duck-types a minimal
 * structural subset of the SDK shapes instead and fails open throughout: no
 * `@opentelemetry/api` installed, no registered provider, a provider without
 * `addSpanProcessor`, or no capture session registered — all silently no-op.
 */
import type { Attributes, FrameworkSpan, RequestKind, RequestRuntime } from 'hakka-core'
// `hakka-core`'s package.json#exports has no subpath for `contract/*` yet — see `../tsconfig.json`'s `paths` entry.
import type { CaptureSource, CaptureSourceContext } from 'hakka-core'

import { adoptOtelTraceId, currentTraceContext } from './trace'

export interface SpanProcessorHandle {
  /** Stops further `sink`/`adoptOtelTraceId` calls. OTel has no `removeSpanProcessor`, so the processor object stays attached to its provider forever — this can only neuter it, not detach it. */
  teardown(): void
}

// ── Minimal structural duck-types for the OTel SDK shapes we read — never
// imported from `@opentelemetry/sdk-trace-base`, see the module doc. Read
// through an `unknown` cast at the boundary.

interface MinimalSpanContext {
  traceId: string
  spanId: string
}

interface MinimalReadableSpan {
  name: string
  spanContext(): MinimalSpanContext
  /** Current OTel SDK shape (span-context based parent reference). */
  parentSpanContext?: MinimalSpanContext
  /** Older OTel SDK shape — kept for compatibility with pre-parentSpanContext SDKs. */
  parentSpanId?: string
  attributes?: Record<string, unknown>
  /** OTel `HrTime`: `[seconds, nanoseconds]`. */
  startTime: [number, number]
  endTime: [number, number]
}

interface MinimalSpanProcessor {
  onStart(span: MinimalReadableSpan, parentContext?: unknown): void
  onEnd(span: MinimalReadableSpan): void
  shutdown(): Promise<void>
  forceFlush(): Promise<void>
}

/** Public alias for `hakkaSpanProcessor()`'s return type — not the real OTel `SpanProcessor`, just a compatible shape. */
export type HakkaSpanProcessor = MinimalSpanProcessor

interface MinimalTracerProvider {
  addSpanProcessor?: (processor: MinimalSpanProcessor) => void
  /**
   * `@opentelemetry/api`'s standard registration path never hands back the
   * concrete SDK provider — it wraps it in a `ProxyTracerProvider` exposing
   * only `getTracer`/`getDelegate`/`setDelegate`, not `addSpanProcessor`. So
   * `attach()` tries one `getDelegate()` unwrap and re-checks `addSpanProcessor`
   * on that before giving up.
   */
  getDelegate?: () => unknown
}

/**
 * Next's own `next.span_type` for the outbound fetch it instruments — this is
 * the EXACT same operation hakka-core's own fetch interceptor already
 * captures (with full headers/body/cache status). Emitting both a
 * `FrameworkSpan` and a `NetworkRequest` for it would draw one operation
 * twice, so it's dropped at the source and never reaches `sink`.
 */
const APP_RENDER_FETCH_SPAN_TYPE = 'AppRender.fetch'

/**
 * Next's documented `next.span_type` values emitted unconditionally (i.e.
 * without `NEXT_OTEL_VERBOSE`). Everything else Next emits only under that
 * flag is `'verbose'`. MUST be re-verified against the installed Next
 * version's actual span names at implementation time — Next's span
 * vocabulary is documented but not versioned/guaranteed stable.
 */
const PRIMARY_SPAN_TYPES = new Set([
  'BaseServer.handleRequest',
  'AppRender.getBodyResult',
  'AppRouteRouteHandlers.runHandler',
  'Render.getServerSideProps',
  'Render.getStaticProps',
  'Render.renderDocument',
  'ResolveMetadata.generateMetadata',
  'NextNodeServer.findPageComponents',
  'NextNodeServer.getLayoutOrPageModule',
  'NextNodeServer.startResponse',
])

const ROUTE_HANDLER_SPAN_TYPE = 'AppRouteRouteHandlers.runHandler'

/** OTel's reserved all-zero span id — the SDK's shorthand for "no parent". */
const ZERO_SPAN_ID = '0000000000000000'

function toMillis(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1e6
}

/** `undefined`/non-string/empty attribute values are dropped — `Attributes` (hakka-core) is `Record<string, string>`. */
function stringifyAttrs(raw: Record<string, unknown> | undefined): Attributes {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue
    out[key] = typeof value === 'string' ? value : String(value)
  }
  return out
}

function parentIdOf(span: MinimalReadableSpan): string | null {
  const parentId = span.parentSpanContext?.spanId ?? span.parentSpanId
  if (!parentId || parentId === ZERO_SPAN_ID) return null
  return parentId
}

// Per-trace set of `next.span_type` values seen so far, used ONLY to answer
// "did this trace contain a route-handler span" when classifying the root
// span's `requestKind`. Children end before their parent (standard span
// nesting), so by the time the root span's `onEnd` fires, every descendant
// has already recorded its type here. Cleared per-trace the moment its root
// span is classified — bounded by trace lifetime, not by an arbitrary cap —
// with a hard size cap as a backstop against a trace whose root never ends
// (e.g. a hung request) leaking memory forever.
const MAX_TRACKED_TRACES = 512
const spanTypesByTrace = new Map<string, Set<string>>()

function trackSpanType(traceId: string, spanType: string | undefined): void {
  if (!spanType) return
  let set = spanTypesByTrace.get(traceId)
  if (!set) {
    if (spanTypesByTrace.size >= MAX_TRACKED_TRACES) spanTypesByTrace.clear()
    set = new Set()
    spanTypesByTrace.set(traceId, set)
  }
  set.add(spanType)
}

/**
 * Derive `requestKind` for a root span (`parentId === null` only — non-root
 * spans never get a `requestKind`). Priority: an inbound-header hint
 * (`server-action`, from `trace.ts`'s `requestKindHint` — see its doc for the
 * unverified-header-survival caveat) beats the documented `next.rsc`
 * attribute, which beats nothing (attribute absent → `undefined`, not
 * guessed at).
 */
function classifyRequestKind(traceId: string, attrs: Attributes): RequestKind | undefined {
  const hint = currentTraceContext()?.requestKindHint
  if (hint === 'server-action') return 'server-action'

  const rsc = attrs['next.rsc']
  if (rsc === 'true') return 'rsc'
  if (rsc === 'false') {
    const sawRouteHandler = spanTypesByTrace.get(traceId)?.has(ROUTE_HANDLER_SPAN_TYPE) ?? false
    return sawRouteHandler ? 'route-handler' : 'document'
  }
  return undefined
}

interface AttachState {
  stopped: boolean
}

/**
 * Live sink+runtime registered by `enableTraceSpans()`. Read by
 * `hakkaSpanProcessor()` instances at CALL time, not construction time — a
 * processor is normally constructed and handed to the caller's SDK before
 * `enableTraceSpans()` ever runs, and is in place by the time real spans
 * arrive. `null` (no session started yet, or one just tore down) makes every
 * processor fail open and drop the span — never buffer, since a
 * pre-registration span replayed into a LATER session would carry stale
 * context.
 */
let registration: { sink: (span: FrameworkSpan) => void; runtime: RequestRuntime } | null = null

/**
 * True once a `hakkaSpanProcessor()` instance exists for the CURRENT
 * session. Guards `attach()` (the SDK-1.x fallback, which runs
 * unconditionally): if the caller already wired `hakkaSpanProcessor()` into
 * their SDK, `attach()` finding the same provider via `addSpanProcessor` and
 * installing a second processor would double-emit every span. Reset by
 * `enableTraceSpans()`'s `teardown()` (not a process-lifetime flag) so a
 * restarted capture session — the norm across `startCapture`/`stopCapture`
 * cycles and this file's own test suite — can re-evaluate the fallback.
 */
let hakkaSpanProcessorSeen = false

/** Shared with `attach()`'s duck-typed processor — see `handleSpanEnd`'s onStart analog inline in both. */
function safeOnStart(span: MinimalReadableSpan): void {
  try {
    adoptOtelTraceId(span.spanContext().traceId)
  } catch {
    /* best-effort — never let a span hook break request handling */
  }
}

/** Shared with `attach()`'s duck-typed processor. */
function safeOnEnd(span: MinimalReadableSpan, sink: (span: FrameworkSpan) => void, runtime: RequestRuntime): void {
  try {
    handleSpanEnd(span, sink, runtime)
  } catch {
    /* best-effort */
  }
}

/**
 * Construct a `SpanProcessor`-shaped object for the caller's own OTel SDK
 * constructor-time processor list (e.g. `registerOTel({ spanProcessors: [...] })`).
 * The only reliable attach path on `sdk-trace-base` 2.x (see the module doc);
 * safe on 1.x too. Forwards to whatever `enableTraceSpans()` last registered
 * and fails open before/after that registration's lifetime.
 */
export function hakkaSpanProcessor(): HakkaSpanProcessor {
  hakkaSpanProcessorSeen = true
  return {
    onStart(span) {
      if (!registration) return
      safeOnStart(span)
    },
    onEnd(span) {
      const reg = registration
      if (!reg) return
      safeOnEnd(span, reg.sink, reg.runtime)
    },
    async shutdown() {},
    async forceFlush() {},
  }
}

function handleSpanEnd(span: MinimalReadableSpan, sink: (span: FrameworkSpan) => void, runtime: RequestRuntime): void {
  const traceId = span.spanContext().traceId
  const attrs = stringifyAttrs(span.attributes)
  const spanType = attrs['next.span_type']
  const parentId = parentIdOf(span)

  trackSpanType(traceId, spanType)

  if (spanType === APP_RENDER_FETCH_SPAN_TYPE) return

  const verbosity: 'primary' | 'verbose' = spanType && PRIMARY_SPAN_TYPES.has(spanType) ? 'primary' : 'verbose'

  let requestKind: RequestKind | undefined
  if (parentId === null) {
    requestKind = classifyRequestKind(traceId, attrs)
    // The trace is complete (its root just ended) — stop tracking it.
    spanTypesByTrace.delete(traceId)
  }

  const frameworkSpan: FrameworkSpan = {
    id: span.spanContext().spanId,
    traceId,
    parentId,
    name: span.name,
    startTime: toMillis(span.startTime),
    endTime: toMillis(span.endTime),
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    verbosity,
    runtime,
    requestKind,
  }
  sink(frameworkSpan)
}

async function attach(sink: (span: FrameworkSpan) => void, runtime: RequestRuntime, state: AttachState): Promise<void> {
  // A `hakkaSpanProcessor()` instance already exists in this process — the
  // caller wired it into their SDK's constructor-time processor list, which
  // covers both SDK generations. Installing this fallback's OWN processor on
  // top would double-emit every span it also sees (SDK-1.x providers still
  // expose `addSpanProcessor`, so this path would otherwise succeed right
  // alongside the constructor-time one) — see `hakkaSpanProcessorSeen`'s doc.
  if (hakkaSpanProcessorSeen) return
  try {
    // Dynamic import only — see the module doc's optional-peer contract.
    const otelApi = await import('@opentelemetry/api')
    const rawProvider = otelApi.trace.getTracerProvider() as unknown as MinimalTracerProvider
    // See MinimalTracerProvider.getDelegate's doc: the raw result is almost
    // always a ProxyTracerProvider, so try one unwrap before giving up.
    const delegate =
      typeof rawProvider.addSpanProcessor !== 'function' && typeof rawProvider.getDelegate === 'function'
        ? (rawProvider.getDelegate() as unknown as MinimalTracerProvider)
        : null
    const provider = typeof rawProvider.addSpanProcessor === 'function' ? rawProvider : delegate
    if (!provider || typeof provider.addSpanProcessor !== 'function') return // no SDK provider registered — fail open

    const processor: MinimalSpanProcessor = {
      onStart(span) {
        if (state.stopped) return
        safeOnStart(span)
      },
      onEnd(span) {
        if (state.stopped) return
        safeOnEnd(span, sink, runtime)
      },
      async shutdown() {},
      async forceFlush() {},
    }
    provider.addSpanProcessor(processor)
  } catch {
    // `@opentelemetry/api` not installed, or getTracerProvider() threw — fail open.
  }
}

/**
 * Start bridging OTel spans into `FrameworkSpan` records delivered to `sink`:
 * registers `{ sink, runtime }` at module scope (what `hakkaSpanProcessor()`
 * instances forward to) and fires the SDK-1.x `attach()` fallback,
 * fire-and-forget. Safe to call even when `@opentelemetry/api` isn't
 * installed or no provider is registered yet.
 */
export function enableTraceSpans(sink: (span: FrameworkSpan) => void, runtime: RequestRuntime): SpanProcessorHandle {
  // Next only emits its full (non-"primary") span set under this flag, and
  // reads it as early as its own request-tree spans start — must be set
  // SYNCHRONOUSLY here, before attach()'s dynamic import settles. Setting it
  // only after the import loses the race against Next's first request and
  // silently suppresses every verbose span with no error to point at why.
  process.env.NEXT_OTEL_VERBOSE ??= '1'

  registration = { sink, runtime }

  const state: AttachState = { stopped: false }
  void attach(sink, runtime, state)
  return {
    teardown() {
      state.stopped = true
      registration = null
      hakkaSpanProcessorSeen = false
    },
  }
}

/**
 * `CaptureSource` (ADR 0006) wrapper around `enableTraceSpans()` — the
 * contract's first real consumer. Wraps rather than replaces the state
 * machine above so it's reused byte-for-byte; `enableTraceSpans()` itself has
 * no idempotent-start guard (a second call would double-fire `attach()`), so
 * that guarantee lives here, in `instanceHandle`, per `CaptureSource`'s
 * lifecycle contract.
 */
export function createOtelSpanCaptureSource(runtime: RequestRuntime): CaptureSource {
  let instanceHandle: SpanProcessorHandle | null = null
  return {
    id: 'hakka.otel-span',
    runtime,
    transport: 'otel',
    correlation: 'adopts-foreign',
    start(ctx: CaptureSourceContext) {
      if (instanceHandle) return // already started — idempotent per the CaptureSource contract
      // `ctx.emitSpan` is optional on the contract (fail-open: no span store
      // means drop the span, never throw/buffer) — `?.` captures that exactly.
      instanceHandle = enableTraceSpans((span) => ctx.emitSpan?.(span), runtime)
    },
    stop() {
      if (!instanceHandle) return // never started, or already stopped — idempotent per the contract
      instanceHandle.teardown()
      instanceHandle = null
    },
  }
}
