import type { CaptureSourceContext, CaptureSourceProbe, NetworkRequest } from 'hakka-core'
import { checkCaptureSourceConformance } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createResourceTimingCaptureSource } from '../resourceTiming'

/**
 * Minimal fake `PerformanceObserver` — `enableResourceTimingEnrichment` only
 * ever calls `new PerformanceObserver(callback)`, `.observe(options)`, and
 * `.disconnect()`, so that's all this reproduces. `dispatch` drives every
 * live instance's callback the same way the real Performance Timeline would
 * after a `buffered: true` `.observe()` call replays past entries.
 */
type FakeResourceEntry = Partial<PerformanceResourceTiming> & { name: string; initiatorType: string }

class FakePerformanceObserver {
  private static instances: FakePerformanceObserver[] = []
  private readonly callback: (list: { getEntries(): PerformanceEntry[] }) => void

  constructor(callback: (list: { getEntries(): PerformanceEntry[] }) => void) {
    this.callback = callback
    FakePerformanceObserver.instances.push(this)
  }

  observe(_options: unknown): void {}

  disconnect(): void {
    const idx = FakePerformanceObserver.instances.indexOf(this)
    if (idx >= 0) FakePerformanceObserver.instances.splice(idx, 1)
  }

  static dispatch(entry: FakeResourceEntry): void {
    for (const inst of FakePerformanceObserver.instances) {
      inst.callback({ getEntries: () => [entry as unknown as PerformanceEntry] })
    }
  }

  static get liveCount(): number {
    return FakePerformanceObserver.instances.length
  }

  static reset(): void {
    FakePerformanceObserver.instances = []
  }
}

/** A realistic entry whose derived patch is always non-empty (see `extractTiming`'s `set()` gate on `value > 0`). */
function fakeEntry(overrides: Partial<FakeResourceEntry> = {}): FakeResourceEntry {
  return {
    name: 'https://api.example.com/data',
    initiatorType: 'fetch',
    startTime: 10,
    domainLookupStart: 10,
    domainLookupEnd: 15,
    connectStart: 15,
    connectEnd: 25,
    secureConnectionStart: 20,
    requestStart: 25,
    responseStart: 40,
    responseEnd: 60,
    nextHopProtocol: 'h2',
    ...overrides,
  }
}

function installFakePerformanceGlobals(): void {
  FakePerformanceObserver.reset()
  ;(globalThis as Record<string, unknown>).PerformanceObserver = FakePerformanceObserver
  // Pinned to 0 so `timeOrigin + entry.startTime === entry.startTime` — keeps
  // every test's expected `entryEpochStart` equal to the fake entry's `startTime`.
  ;(globalThis as Record<string, unknown>).performance = { timeOrigin: 0 }
}

function makeRecord(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: `req-${Math.random().toString(36).slice(2)}`,
    url: 'https://api.example.com/data',
    method: 'GET',
    source: 'fetch',
    startTime: 10,
    ...overrides,
  }
}

/** In-memory `CaptureSourceContext` backing `ctx.update`/`ctx.getLogs` for real — not the conformance harness's ingest/emitSpan-only recorder, see the conformance describe block's doc for why. */
function createFakeEnrichmentContext(initialLogs: NetworkRequest[] = []): {
  ctx: CaptureSourceContext
  logs: NetworkRequest[]
  updateCalls: Array<Partial<NetworkRequest> & { id: string }>
} {
  const logs = [...initialLogs]
  const updateCalls: Array<Partial<NetworkRequest> & { id: string }> = []
  return {
    logs,
    updateCalls,
    ctx: {
      ingest: () => {},
      update: (partial) => {
        updateCalls.push(partial)
        const idx = logs.findIndex((r) => r.id === partial.id)
        if (idx < 0) return false
        // `Partial<NetworkRequest>` widens `url`/`method`/`startTime` to `| undefined`
        // in the spread merge even though `logs[idx]` always supplies them — cast
        // back to the known-complete shape.
        logs[idx] = { ...logs[idx], ...partial } as NetworkRequest
        return true
      },
      getLogs: () => logs,
    },
  }
}

describe('createResourceTimingCaptureSource', () => {
  const realPerformanceObserver = (globalThis as Record<string, unknown>).PerformanceObserver
  const realPerformance = (globalThis as Record<string, unknown>).performance

  beforeEach(() => {
    installFakePerformanceGlobals()
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).PerformanceObserver = realPerformanceObserver
    ;(globalThis as Record<string, unknown>).performance = realPerformance
  })

  describe('identity and correlation match ADR 0006 row 5', () => {
    it('declares hakka.resource-timing, client, resource-timing, none', () => {
      const source = createResourceTimingCaptureSource()
      expect(source.id).toBe('hakka.resource-timing')
      expect(source.runtime).toBe('client')
      expect(source.transport).toBe('resource-timing')
      expect(source.correlation).toBe('none')
    })
  })

  /**
   * `checkCaptureSourceConformance`'s built-in recording context only counts
   * `ctx.ingest`/`ctx.emitSpan` calls as "emission" (`conformance.ts`'s
   * `createRecordingContext` doesn't implement `update`/`getLogs` at all).
   * Row 5's whole "Awkward" callout is that this source emits via neither —
   * it only ever calls `ctx.update`, which the harness's recorder can't see.
   * So the checks that measure "did anything land in the sink" are
   * structurally unable to observe this source's real activity and fail —
   * not a bug in the wrapper, the exact gap ADR 0006's Consequences section
   * names for this row. The other four checks (idempotent stop, no post-stop
   * emission, no in-flight-after-stop emission) don't depend on that count
   * and hold for real. Mirrors `conformance.test.ts`'s own pattern of
   * asserting which specific checks a deliberately-non-conforming-shaped
   * source fails, rather than asserting blanket pass/fail.
   */
  describe('conformance harness — enrichment-only shape', () => {
    function createProbe(): CaptureSourceProbe {
      return {
        createSource: () => createResourceTimingCaptureSource(),
        triggerOnce: () => FakePerformanceObserver.dispatch(fakeEntry()),
      }
    }

    it('fails exactly the ingest/emitSpan-counting checks, passes the rest', async () => {
      const report = await checkCaptureSourceConformance(createProbe())
      const byName = new Map(report.checks.map((c) => [c.name, c.passed]))

      expect(byName.get('start() is idempotent — a second call does not double-wire emission')).toBe(false)
      expect(byName.get('emission reaches the context sink')).toBe(false)
      expect(byName.get('a start() -> stop() -> start() cycle re-arms onto the NEW context')).toBe(false)

      expect(byName.get('stop() before start() is a fail-open no-op')).toBe(true)
      expect(byName.get('stop() is idempotent — a second call is a fail-open no-op')).toBe(true)
      expect(byName.get('teardown emits nothing after stop()')).toBe(true)
      expect(byName.get('work in flight when stop() is called must not emit after it')).toBe(true)

      expect(report.passed).toBe(false)
    })
  })

  describe("enrichment matching (ADR 0006 row 5's ctx.update/getLogs path)", () => {
    it('enriches the matching fetch record via ctx.update', () => {
      const target = makeRecord()
      const { ctx, updateCalls, logs } = createFakeEnrichmentContext([target])
      const source = createResourceTimingCaptureSource()

      source.start(ctx)
      FakePerformanceObserver.dispatch(fakeEntry())

      expect(updateCalls).toHaveLength(1)
      expect(updateCalls[0]!.id).toBe(target.id)
      expect(updateCalls[0]!.dnsMs).toBe(5)
      expect(updateCalls[0]!.ttfbMs).toBe(15)
      expect(logs[0]!.timing).toBeDefined()

      source.stop()
    })

    it('skips a record that already has timing set', () => {
      const alreadyTimed = makeRecord({ timing: { ttfbMs: 1 } })
      const { ctx, updateCalls } = createFakeEnrichmentContext([alreadyTimed])
      const source = createResourceTimingCaptureSource()

      source.start(ctx)
      FakePerformanceObserver.dispatch(fakeEntry())

      expect(updateCalls).toHaveLength(0)
      source.stop()
    })

    it('skips a record whose source is not fetch/xhr', () => {
      const wsRecord = makeRecord({ source: 'websocket' })
      const { ctx, updateCalls } = createFakeEnrichmentContext([wsRecord])
      const source = createResourceTimingCaptureSource()

      source.start(ctx)
      FakePerformanceObserver.dispatch(fakeEntry())

      expect(updateCalls).toHaveLength(0)
      source.stop()
    })

    it('skips a record whose url does not match the entry', () => {
      const otherUrl = makeRecord({ url: 'https://api.example.com/other' })
      const { ctx, updateCalls } = createFakeEnrichmentContext([otherUrl])
      const source = createResourceTimingCaptureSource()

      source.start(ctx)
      FakePerformanceObserver.dispatch(fakeEntry())

      expect(updateCalls).toHaveLength(0)
      source.stop()
    })

    it('picks the closest untimed candidate by startTime when several share a url', () => {
      const far = makeRecord({ startTime: 1_000 })
      const near = makeRecord({ startTime: 11 }) // entry.startTime is 10 — off by 1
      const { ctx, updateCalls } = createFakeEnrichmentContext([far, near])
      const source = createResourceTimingCaptureSource()

      source.start(ctx)
      FakePerformanceObserver.dispatch(fakeEntry())

      expect(updateCalls).toHaveLength(1)
      expect(updateCalls[0]!.id).toBe(near.id)
      source.stop()
    })

    it('fails open — no throw, no-op — when the host context has no update/getLogs', () => {
      const source = createResourceTimingCaptureSource()
      const bareCtx: CaptureSourceContext = { ingest: () => {} }

      expect(() => {
        source.start(bareCtx)
        FakePerformanceObserver.dispatch(fakeEntry())
      }).not.toThrow()

      source.stop()
    })
  })

  describe('lifecycle', () => {
    it('start() is idempotent — a second call does not install a second observer', () => {
      const { ctx, updateCalls } = createFakeEnrichmentContext([makeRecord()])
      const source = createResourceTimingCaptureSource()

      source.start(ctx)
      source.start(ctx)
      expect(FakePerformanceObserver.liveCount).toBe(1)

      FakePerformanceObserver.dispatch(fakeEntry())
      expect(updateCalls).toHaveLength(1) // one observer, one enrichment — not two

      source.stop()
    })

    it('stop() disconnects the observer — no further enrichment after stop()', () => {
      const { ctx, updateCalls } = createFakeEnrichmentContext([makeRecord()])
      const source = createResourceTimingCaptureSource()

      source.start(ctx)
      source.stop()
      expect(FakePerformanceObserver.liveCount).toBe(0)

      FakePerformanceObserver.dispatch(fakeEntry())
      expect(updateCalls).toHaveLength(0)
    })

    it('stop() before any start() is a no-op', () => {
      const source = createResourceTimingCaptureSource()
      expect(() => source.stop()).not.toThrow()
    })

    it('a start() -> stop() -> start() cycle re-arms onto the newest context', () => {
      const first = createFakeEnrichmentContext([makeRecord()])
      const second = createFakeEnrichmentContext([makeRecord()])
      const source = createResourceTimingCaptureSource()

      source.start(first.ctx)
      source.stop()
      source.start(second.ctx)
      FakePerformanceObserver.dispatch(fakeEntry())

      expect(first.updateCalls).toHaveLength(0)
      expect(second.updateCalls).toHaveLength(1)

      source.stop()
    })
  })
})
