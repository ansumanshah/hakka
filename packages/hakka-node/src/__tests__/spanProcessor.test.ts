import { describe, expect, test } from 'bun:test'

// `@opentelemetry/api` is a devDependency here (mirrors the existing
// `hakka-browser` optional-peer pattern) so the type-check + test suite can
// exercise `enableTraceSpans` against the real API package, the same way a
// consumer with it installed would. Shipped hakka-node code never imports it
// statically — only `spanProcessor.ts`'s dynamic `import()`.
import { trace as otelTrace } from '@opentelemetry/api'
import { deriveTraceId, type FrameworkSpan } from 'hakka-core'
import { checkCaptureSourceConformance, type CaptureSourceProbe } from 'hakka-core'

import { createOtelSpanCaptureSource, enableTraceSpans, hakkaSpanProcessor } from '../spanProcessor'
import { currentTraceContext, runInTraceContext } from '../trace'

/**
 * `attach()` inside `enableTraceSpans` is fire-and-forget (`void attach(...)`)
 * because it needs a dynamic `import('@opentelemetry/api')` — wait a macrotask
 * for that promise chain to settle before asserting on its effects.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

interface FakeSpanContext {
  traceId: string
  spanId: string
}

interface FakeProcessor {
  onStart(span: unknown): void
  onEnd(span: unknown): void
}

/** `[seconds, nanoseconds]` — OTel's `HrTime`, for an exact millisecond value. */
function msToHr(ms: number): [number, number] {
  return [Math.floor(ms / 1000), (ms % 1000) * 1e6]
}

function fakeSpan(over: {
  spanId: string
  traceId?: string
  parentSpanId?: string | null
  name?: string
  attributes?: Record<string, unknown>
  startMs?: number
  endMs?: number
}): unknown {
  const traceId = over.traceId ?? 't-default'
  return {
    name: over.name ?? 'span',
    spanContext: (): FakeSpanContext => ({ traceId, spanId: over.spanId }),
    parentSpanContext:
      over.parentSpanId == null ? undefined : ({ traceId, spanId: over.parentSpanId } satisfies FakeSpanContext),
    attributes: over.attributes ?? {},
    startTime: msToHr(over.startMs ?? 0),
    endTime: msToHr(over.endMs ?? 10),
  }
}

/** Registers `provider` as the delegate behind `@opentelemetry/api`'s global ProxyTracerProvider — see `spanProcessor.ts`'s `MinimalTracerProvider.getDelegate` doc for why a raw `addSpanProcessor` object must go through `setGlobalTracerProvider`, not be returned directly by `getTracerProvider()`. */
function registerFakeProvider(addSpanProcessor: (p: FakeProcessor) => void): void {
  otelTrace.setGlobalTracerProvider({
    getTracer: () => ({ startSpan: () => ({}) }),
    addSpanProcessor,
  } as never)
}

describe('enableTraceSpans', () => {
  test('attaches to a registered provider via the ProxyTracerProvider delegate unwrap', async () => {
    let captured: FakeProcessor | undefined
    registerFakeProvider((p) => {
      captured = p
    })
    try {
      const handle = enableTraceSpans(() => {}, 'server')
      await flush()
      expect(captured).toBeDefined()
      handle.teardown()
    } finally {
      otelTrace.disable()
    }
  })

  test('sets NEXT_OTEL_VERBOSE=1 synchronously, before the dynamic import settles', async () => {
    // Must land before register()'s own promise resolves — attach()'s dynamic
    // `import('@opentelemetry/api')` is at least a microtask away, so asserting
    // this WITHOUT awaiting flush() proves the flag isn't racing Next's first
    // request the way it used to when the env var was set only after attach()
    // resolved (see spanProcessor.ts's enableTraceSpans doc).
    delete process.env.NEXT_OTEL_VERBOSE
    registerFakeProvider(() => {})
    try {
      enableTraceSpans(() => {}, 'server')
      expect(process.env.NEXT_OTEL_VERBOSE).toBe('1')
      await flush()
      expect(process.env.NEXT_OTEL_VERBOSE).toBe('1')
    } finally {
      otelTrace.disable()
      delete process.env.NEXT_OTEL_VERBOSE
    }
  })

  test('sets NEXT_OTEL_VERBOSE=1 even when no SDK provider is registered (opt-in gates on traceSpans, not on a found provider)', () => {
    otelTrace.disable() // default Noop/Proxy provider — no addSpanProcessor anywhere in the chain
    delete process.env.NEXT_OTEL_VERBOSE
    try {
      enableTraceSpans(() => {}, 'server')
      expect(process.env.NEXT_OTEL_VERBOSE).toBe('1')
    } finally {
      delete process.env.NEXT_OTEL_VERBOSE
    }
  })

  test('fails open (never throws) when no SDK provider is registered', async () => {
    otelTrace.disable() // reset to the default Noop/Proxy provider — no addSpanProcessor anywhere in the chain
    expect(() => enableTraceSpans(() => {}, 'server')).not.toThrow()
    await flush() // attach()'s fire-and-forget promise must settle without an unhandled rejection
  })

  test('root span onStart adopts its OTel trace id as the correlationId when no context exists yet', async () => {
    let captured: FakeProcessor | undefined
    registerFakeProvider((p) => {
      captured = p
    })
    try {
      enableTraceSpans(() => {}, 'server')
      await flush()
      expect(captured).toBeDefined()
      expect(currentTraceContext()).toBeUndefined()
      captured?.onStart(fakeSpan({ spanId: 'root', traceId: 'otel-trace-adopted' }))
      expect(currentTraceContext()).toEqual({ traceId: 'otel-trace-adopted' })
    } finally {
      otelTrace.disable()
    }
  })

  // Regression coverage for the client→server traceparent bug (see
  // `engine/traceparent.ts` in hakka-core, and `capture/fetch.ts`'s trace
  // correlation block): a browser fetch now sends BOTH `x-hakka-trace` (the
  // raw correlationId) and a `traceparent` whose trace-id segment is
  // `deriveTraceId(correlationId)`. A W3C-OTel-instrumented server (e.g.
  // Next.js) reads that incoming `traceparent` and CONTINUES the trace using
  // its trace-id verbatim, rather than minting an unrelated one — so the root
  // span's `spanContext().traceId` ends up equal to `deriveTraceId(correlationId)`.
  //
  // This test simulates that continuation (spanProcessor.ts doesn't parse
  // headers itself — trace.ts's ALS middleware and the real OTel SDK do —
  // so both sides of the invariant are set up explicitly here) and states
  // the NEW join invariant this fix establishes:
  //
  //   FrameworkSpan.traceId === deriveTraceId(NetworkRequest.correlationId)
  //
  // NOT the older, format-incompatible `traceId === correlationId` literal
  // equality (a raw correlationId and a 32-hex W3C trace-id are different
  // string shapes and can never be `===`-equal to each other directly).
  test('traceparent continuation invariant: FrameworkSpan.traceId equals deriveTraceId(the request correlationId)', async () => {
    const received: FrameworkSpan[] = []
    let captured: FakeProcessor | undefined
    registerFakeProvider((p) => {
      captured = p
    })
    try {
      enableTraceSpans((span) => received.push(span), 'server')
      await flush()
      expect(captured).toBeDefined()

      const correlationId = 'client-491a91c3-8b12-496a-94ab-d86bae71b8ed'
      // ALS context as `trace.ts`'s middleware would set it from an incoming
      // `x-hakka-trace` header (x-hakka-trace wins over traceparent — see
      // `parseIncomingTraceId` — so the ALS traceId is the RAW correlationId,
      // unmodified).
      runInTraceContext({ traceId: correlationId }, () => {
        // The span the real OTel SDK would emit after continuing the
        // incoming `traceparent` — its trace-id is the DERIVED hex, not the
        // raw correlationId.
        captured?.onEnd(fakeSpan({ spanId: 'root', traceId: deriveTraceId(correlationId), parentSpanId: null }))
      })

      expect(received).toHaveLength(1)
      const span = received[0]!
      expect(span.traceId).toBe(deriveTraceId(correlationId))
      // Sanity: proves the assertion above isn't vacuously true because the
      // two formats happened to coincide.
      expect(span.traceId).not.toBe(correlationId)
    } finally {
      otelTrace.disable()
    }
  })

  test('onEnd: classifies verbosity per the primary allowlist, drops AppRender.fetch, derives requestKind from next.rsc', async () => {
    const received: FrameworkSpan[] = []
    let captured: FakeProcessor | undefined
    registerFakeProvider((p) => {
      captured = p
    })
    try {
      enableTraceSpans((span) => received.push(span), 'server')
      await flush()
      expect(captured).toBeDefined()

      const traceId = 't-onend'
      captured?.onEnd(
        fakeSpan({
          spanId: 'child-primary',
          traceId,
          parentSpanId: 'root',
          attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler' },
        }),
      )
      captured?.onEnd(
        fakeSpan({
          spanId: 'child-verbose',
          traceId,
          parentSpanId: 'root',
          attributes: { 'next.span_type': 'some.undocumented.span' },
        }),
      )
      // Dropped at the source — hakka-core's own fetch interceptor already
      // captures this exact operation with full headers/body/cache status.
      captured?.onEnd(
        fakeSpan({
          spanId: 'child-fetch',
          traceId,
          parentSpanId: 'root',
          attributes: { 'next.span_type': 'AppRender.fetch' },
        }),
      )
      captured?.onEnd(
        fakeSpan({
          spanId: 'root',
          traceId,
          parentSpanId: null,
          attributes: { 'next.span_type': 'BaseServer.handleRequest', 'next.rsc': 'true' },
        }),
      )

      expect(received.map((s) => s.id)).toEqual(['child-primary', 'child-verbose', 'root'])
      expect(received.find((s) => s.id === 'child-primary')?.verbosity).toBe('primary')
      expect(received.find((s) => s.id === 'child-verbose')?.verbosity).toBe('verbose')
      expect(received.find((s) => s.id === 'child-primary')?.parentId).toBe('root')
      const root = received.find((s) => s.id === 'root')
      expect(root?.parentId).toBeNull()
      expect(root?.requestKind).toBe('rsc')
      // Trivial pass-through invariant: FrameworkSpan.traceId always mirrors
      // whatever `span.spanContext().traceId` the OTel SDK assigned — this
      // holds unconditionally, regardless of whether that trace-id happens to
      // relate to a Hakka correlationId at all (here it's an arbitrary fake
      // id). This is NOT the client↔span join invariant — see the
      // "traceparent continuation" test above (right after the
      // `adopts its OTel trace id` test) for that: the join needs
      // `deriveTraceId`, not raw equality, since a correlationId and a W3C
      // trace-id are different string formats.
      expect(root?.traceId).toBe(traceId)
    } finally {
      otelTrace.disable()
    }
  })

  test('root span classifies "route-handler" when next.rsc="false" and the trace contained a route-handler span', async () => {
    const received: FrameworkSpan[] = []
    let captured: FakeProcessor | undefined
    registerFakeProvider((p) => {
      captured = p
    })
    try {
      enableTraceSpans((span) => received.push(span), 'server')
      await flush()

      const traceId = 't-route-handler'
      captured?.onEnd(
        fakeSpan({
          spanId: 'handler',
          traceId,
          parentSpanId: 'root',
          attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler' },
        }),
      )
      captured?.onEnd(
        fakeSpan({
          spanId: 'root',
          traceId,
          parentSpanId: null,
          attributes: { 'next.span_type': 'BaseServer.handleRequest', 'next.rsc': 'false' },
        }),
      )

      expect(received.find((s) => s.id === 'root')?.requestKind).toBe('route-handler')
    } finally {
      otelTrace.disable()
    }
  })

  test('root span classifies "document" when next.rsc="false" and no route-handler span was seen', async () => {
    const received: FrameworkSpan[] = []
    let captured: FakeProcessor | undefined
    registerFakeProvider((p) => {
      captured = p
    })
    try {
      enableTraceSpans((span) => received.push(span), 'server')
      await flush()

      captured?.onEnd(
        fakeSpan({
          spanId: 'root',
          traceId: 't-document',
          parentSpanId: null,
          attributes: { 'next.span_type': 'BaseServer.handleRequest', 'next.rsc': 'false' },
        }),
      )

      expect(received.find((s) => s.id === 'root')?.requestKind).toBe('document')
    } finally {
      otelTrace.disable()
    }
  })

  test('a requestKindHint of "server-action" on the ambient trace context overrides next.rsc on the root span', async () => {
    const received: FrameworkSpan[] = []
    let captured: FakeProcessor | undefined
    registerFakeProvider((p) => {
      captured = p
    })
    try {
      enableTraceSpans((span) => received.push(span), 'server')
      await flush()

      runInTraceContext({ traceId: 't-server-action', requestKindHint: 'server-action' }, () => {
        captured?.onEnd(
          fakeSpan({
            spanId: 'root',
            traceId: 't-server-action',
            parentSpanId: null,
            attributes: { 'next.span_type': 'BaseServer.handleRequest', 'next.rsc': 'true' },
          }),
        )
      })

      expect(received[0]?.requestKind).toBe('server-action')
    } finally {
      otelTrace.disable()
    }
  })

  test('teardown() stops further sink calls and ALS stamping', async () => {
    const received: FrameworkSpan[] = []
    let captured: FakeProcessor | undefined
    registerFakeProvider((p) => {
      captured = p
    })
    try {
      const handle = enableTraceSpans((span) => received.push(span), 'server')
      await flush()
      handle.teardown()

      captured?.onStart(fakeSpan({ spanId: 'root', traceId: 't-after-teardown' }))
      expect(currentTraceContext()).toBeUndefined()

      captured?.onEnd(fakeSpan({ spanId: 'root', traceId: 't-after-teardown', parentSpanId: null, attributes: {} }))
      expect(received).toEqual([])
    } finally {
      otelTrace.disable()
    }
  })
})

/**
 * `hakkaSpanProcessor()` sets a module-level, one-way `hakkaSpanProcessorSeen`
 * flag the moment it's called (see `spanProcessor.ts`'s doc) — `attach()`'s
 * SDK-1.x duck-type fallback checks it and no-ops once set, to avoid
 * double-emitting spans when both paths are wired to the same provider. That
 * flag has no reset, so this `describe` block MUST run after every test above
 * that exercises `attach()`'s own fallback processor via `registerFakeProvider`
 * — those assert on `captured` actually being populated, which stops being
 * true once `hakkaSpanProcessorSeen` flips. Bun's test runner executes `test`s
 * within a file sequentially in declaration order, so keeping this block last
 * is sufficient; do not reorder it above `describe('enableTraceSpans', …)`.
 */
describe('hakkaSpanProcessor', () => {
  test('forwards onStart/onEnd to the sink registered by a LATER enableTraceSpans() call', async () => {
    const received: FrameworkSpan[] = []
    // Constructed BEFORE enableTraceSpans() — mirrors real usage, where a
    // caller's `registerOTel({ spanProcessors: [hakkaSpanProcessor()] })`
    // runs before `hakkaRegister()`/`startServerCapture` reaches `traceSpans`.
    const processor = hakkaSpanProcessor()
    const handle = enableTraceSpans((span) => received.push(span), 'server')
    try {
      await flush()

      processor.onStart(fakeSpan({ spanId: 'root', traceId: 'otel-trace-adopted' }))
      expect(currentTraceContext()).toEqual({ traceId: 'otel-trace-adopted' })

      processor.onEnd(
        fakeSpan({
          spanId: 'root',
          traceId: 'otel-trace-adopted',
          parentSpanId: null,
          attributes: { 'next.span_type': 'BaseServer.handleRequest', 'next.rsc': 'false' },
        }),
      )
      expect(received.map((s) => s.id)).toEqual(['root'])
      expect(received[0]?.runtime).toBe('server')
    } finally {
      handle.teardown()
      otelTrace.disable()
    }
  })

  test('no-ops (never throws, never delivers) before any enableTraceSpans() registration exists', () => {
    const processor = hakkaSpanProcessor()
    try {
      expect(() => processor.onStart(fakeSpan({ spanId: 'root', traceId: 't-unregistered' }))).not.toThrow()
      expect(currentTraceContext()).toBeUndefined()
      expect(() => processor.onEnd(fakeSpan({ spanId: 'root', traceId: 't-unregistered' }))).not.toThrow()
    } finally {
      // hakkaSpanProcessor() flips the per-session hakkaSpanProcessorSeen
      // flag (see spanProcessor.ts), only cleared by enableTraceSpans()'s
      // teardown() — pair one here purely for cleanup, so this test doesn't
      // leak "seen" state into later tests/files that rely on attach()'s
      // SDK-1.x fallback actually attaching (see next/serverCapture.test.ts's
      // "traceSpans defaulting" suite, which runs in the same bun:test process).
      enableTraceSpans(() => {}, 'server').teardown()
    }
  })

  test("no-ops after enableTraceSpans()'s handle is torn down — fails open, does not buffer for a later registration", async () => {
    const received: FrameworkSpan[] = []
    const processor = hakkaSpanProcessor()
    const handle = enableTraceSpans((span) => received.push(span), 'server')
    await flush()
    handle.teardown()

    processor.onStart(fakeSpan({ spanId: 'root', traceId: 't-after-teardown' }))
    expect(currentTraceContext()).toBeUndefined()
    processor.onEnd(fakeSpan({ spanId: 'root', traceId: 't-after-teardown', parentSpanId: null, attributes: {} }))
    expect(received).toEqual([])
  })

  test("requestKind/verbosity classification matches attach()'s fallback path exactly", async () => {
    const received: FrameworkSpan[] = []
    const processor = hakkaSpanProcessor()
    const handle = enableTraceSpans((span) => received.push(span), 'server')
    try {
      await flush()

      const traceId = 't-hakka-processor-onend'
      processor.onEnd(
        fakeSpan({
          spanId: 'child-primary',
          traceId,
          parentSpanId: 'root',
          attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler' },
        }),
      )
      processor.onEnd(
        fakeSpan({
          spanId: 'child-verbose',
          traceId,
          parentSpanId: 'root',
          attributes: { 'next.span_type': 'some.undocumented.span' },
        }),
      )
      // Dropped at the source — same as the attach() path.
      processor.onEnd(
        fakeSpan({
          spanId: 'child-fetch',
          traceId,
          parentSpanId: 'root',
          attributes: { 'next.span_type': 'AppRender.fetch' },
        }),
      )
      processor.onEnd(
        fakeSpan({
          spanId: 'root',
          traceId,
          parentSpanId: null,
          attributes: { 'next.span_type': 'BaseServer.handleRequest', 'next.rsc': 'true' },
        }),
      )

      expect(received.map((s) => s.id)).toEqual(['child-primary', 'child-verbose', 'root'])
      expect(received.find((s) => s.id === 'child-primary')?.verbosity).toBe('primary')
      expect(received.find((s) => s.id === 'child-verbose')?.verbosity).toBe('verbose')
      const root = received.find((s) => s.id === 'root')
      expect(root?.parentId).toBeNull()
      expect(root?.requestKind).toBe('rsc')
    } finally {
      handle.teardown()
    }
  })

  test('does not double-emit when a hakkaSpanProcessor() instance AND an SDK-1.x provider are both present', async () => {
    const received: FrameworkSpan[] = []
    let fallbackAttached = false
    // A discoverable SDK-1.x provider — if attach()'s duck-type fallback
    // didn't check `hakkaSpanProcessorSeen`, it would find this and install
    // a SECOND processor running the identical onEnd logic.
    registerFakeProvider(() => {
      fallbackAttached = true
    })
    const processor = hakkaSpanProcessor()
    const handle = enableTraceSpans((span) => received.push(span), 'server')
    try {
      await flush()
      expect(fallbackAttached).toBe(false)

      processor.onEnd(
        fakeSpan({
          spanId: 'root',
          traceId: 't-no-double-emit',
          parentSpanId: null,
          attributes: { 'next.span_type': 'BaseServer.handleRequest', 'next.rsc': 'false' },
        }),
      )
      expect(received.map((s) => s.id)).toEqual(['root'])
    } finally {
      handle.teardown()
      otelTrace.disable()
    }
  })
})

/**
 * Runs ADR 0006's conformance harness (`checkCaptureSourceConformance`)
 * against the REAL `createOtelSpanCaptureSource` wrapper, not a fake — proof
 * that the contract's first migration actually honors the lifecycle contract
 * it claims to, not just that its own hand-rolled tests happen to pass.
 *
 * Reuses this file's existing `fakeSpan`/`registerFakeProvider`/`flush`
 * helpers (per the task brief) rather than inventing new ones: the probe's
 * `triggerOnce` is exactly "register a fake SDK-1.x provider, let `attach()`'s
 * dynamic import settle, then end one fake span through the processor it
 * captured" — the same shape every test above already exercises by hand.
 *
 * Placement: LAST in the file, same reason `describe('hakkaSpanProcessor', …)`
 * above is — `hakkaSpanProcessorSeen`'s one-way flag (see spanProcessor.ts)
 * must be false on entry for `attach()`'s fallback to actually attach, and
 * every test above that flips it also pairs a `teardown()` that resets it, so
 * running after them is safe. Bun runs `describe` blocks within a file
 * sequentially in declaration order.
 *
 * `otelTrace.disable()` at the TOP of `createSource()` (not just in a
 * `finally`) matters here in a way it doesn't for the hand-written tests
 * above: `checkCaptureSourceConformance` calls `probe.createSource()` fresh
 * for EVERY one of its 7 checks, several of which never reach a `finally`
 * that would otherwise clean up (`stop()` before `start()`, the idempotent-
 * `stop()` check) — without an unconditional reset, a provider registered by
 * an earlier check would still be live for a later one, since
 * `trace.setGlobalTracerProvider` silently no-ops on a second registration
 * without an intervening `disable()`.
 */
describe('createOtelSpanCaptureSource — CaptureSource conformance', () => {
  function createOtelSpanProbe(): CaptureSourceProbe {
    let captured: { onEnd(span: unknown): void } | undefined
    return {
      createSource() {
        otelTrace.disable() // clean slate — see the describe-block doc above
        captured = undefined
        registerFakeProvider((p) => {
          captured = p
        })
        return createOtelSpanCaptureSource('server')
      },
      async triggerOnce() {
        // attach()'s dynamic `import('@opentelemetry/api')` is at least a
        // macrotask away (see this file's own `flush()` doc) — wait for it so
        // `captured` is populated before ending a span through it.
        await flush()
        captured?.onEnd(
          fakeSpan({ spanId: `conformance-${Math.random()}`, traceId: 't-conformance', parentSpanId: null }),
        )
      },
    }
  }

  test('all 7 lifecycle checks pass against the real wrapper', async () => {
    const report = await checkCaptureSourceConformance(createOtelSpanProbe())
    try {
      expect(
        report.checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
      ).toEqual(report.checks.map((c) => `PASS: ${c.name}`))
      expect(report.passed).toBe(true)
    } finally {
      otelTrace.disable()
    }
  })
})
