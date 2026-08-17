/**
 * A runnable check that a `CaptureSource` implementation honors the
 * lifecycle/emission/teardown contract documented on `CaptureSource` (see
 * `captureSource.ts`). A third party implementing the interface can run
 * `checkCaptureSourceConformance` against their own source the same way
 * `conformance.test.ts` runs it against the fakes defined there.
 *
 * @experimental See `captureSource.ts` — this harness exists ahead of any
 * real consumer.
 */

import type { FrameworkSpan, NetworkRequest } from '../model/types'
import type { CaptureSource, CaptureSourceContext } from './captureSource'

/**
 * How a conformance run drives the source under test. `createSource` gives
 * the harness a fresh, not-yet-started instance per sub-check, so a source
 * breaking on a second construction reads as a different failure than one
 * breaking on a second `start()` on the same instance. `triggerOnce` is the
 * part every real source needs its own implementation for — there's no
 * generic way to "cause a fetch call" or "cause a span to end".
 */
export interface CaptureSourceProbe {
  /** Construct a new, not-yet-started `CaptureSource` instance. */
  createSource(): CaptureSource
  /**
   * Fire ONE synthetic event through the currently-started `source` —
   * invoking a patched global, delivering a message, ending a span,
   * whatever the concrete source reacts to. Only ever called while a
   * source this probe created is started, and never called concurrently
   * with another in-flight `triggerOnce()` for the same source.
   */
  triggerOnce(source: CaptureSource): void | Promise<void>
}

/** One named assertion's outcome. */
export interface ConformanceCheck {
  readonly name: string
  readonly passed: boolean
  /** Present only when `passed` is false. */
  readonly detail?: string
}

/** The full result of a conformance run. */
export interface ConformanceReport {
  readonly passed: boolean
  readonly checks: readonly ConformanceCheck[]
}

/** In-memory sink + the `CaptureSourceContext` wired to record into it. */
function createRecordingContext(): {
  ctx: CaptureSourceContext
  records: NetworkRequest[]
  spans: FrameworkSpan[]
} {
  const records: NetworkRequest[] = []
  const spans: FrameworkSpan[] = []
  return {
    records,
    spans,
    ctx: {
      ingest: (request) => {
        records.push(request)
      },
      emitSpan: (span) => {
        spans.push(span)
      },
    },
  }
}

function totalEmitted(records: readonly NetworkRequest[], spans: readonly FrameworkSpan[]): number {
  return records.length + spans.length
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function runCheck(name: string, fn: () => Promise<void> | void): Promise<ConformanceCheck> {
  try {
    await fn()
    return { name, passed: true }
  } catch (error: unknown) {
    return { name, passed: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Run every conformance check against `probe` and return a report. Each
 * check builds its own fresh source + context, so one failure never
 * cascades into unrelated false failures.
 */
export async function checkCaptureSourceConformance(probe: CaptureSourceProbe): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = []

  checks.push(
    await runCheck('stop() before start() is a fail-open no-op', async () => {
      const source = probe.createSource()
      await source.stop() // must not throw
    }),
  )

  checks.push(
    await runCheck('start() is idempotent — a second call does not double-wire emission', async () => {
      const source = probe.createSource()
      const { ctx, records, spans } = createRecordingContext()
      await source.start(ctx)
      await source.start(ctx) // second call: must not throw, must not double-patch
      await probe.triggerOnce(source)
      const count = totalEmitted(records, spans)
      assert(count === 1, `expected exactly 1 emission after one triggerOnce(), got ${count}`)
      await source.stop()
    }),
  )

  checks.push(
    await runCheck('stop() is idempotent — a second call is a fail-open no-op', async () => {
      const source = probe.createSource()
      const { ctx } = createRecordingContext()
      await source.start(ctx)
      await source.stop()
      await source.stop() // second call: must not throw
    }),
  )

  checks.push(
    await runCheck('emission reaches the context sink', async () => {
      const source = probe.createSource()
      const { ctx, records, spans } = createRecordingContext()
      await source.start(ctx)
      await probe.triggerOnce(source)
      assert(totalEmitted(records, spans) >= 1, 'expected at least one ingest()/emitSpan() call after triggerOnce()')
      await source.stop()
    }),
  )

  checks.push(
    await runCheck('teardown emits nothing after stop()', async () => {
      const source = probe.createSource()
      const { ctx, records, spans } = createRecordingContext()
      await source.start(ctx)
      await source.stop()
      const before = totalEmitted(records, spans)
      await probe.triggerOnce(source) // best-effort; a stopped source may no-op entirely
      const after = totalEmitted(records, spans)
      assert(after === before, `expected no emission after stop(), but count went from ${before} to ${after}`)
    }),
  )

  checks.push(
    await runCheck('work in flight when stop() is called must not emit after it', async () => {
      // The harder half of the teardown guarantee (see captureSource.ts) —
      // detached async work resolving after stop() must not slip through.
      const source = probe.createSource()
      const { ctx, records, spans } = createRecordingContext()
      await source.start(ctx)
      const inFlight = Promise.resolve(probe.triggerOnce(source))
      await source.stop()
      // A synchronous source legitimately emitted DURING triggerOnce, before
      // stop() — the guarantee is only that nothing NEW lands afterwards.
      const atStop = totalEmitted(records, spans)
      await inFlight
      // Let any detached microtasks the trigger scheduled settle too.
      await Promise.resolve()
      const after = totalEmitted(records, spans)
      assert(after === atStop, `in-flight work emitted after stop() returned — count went from ${atStop} to ${after}`)
    }),
  )

  checks.push(
    await runCheck('a start() -> stop() -> start() cycle re-arms onto the NEW context', async () => {
      const source = probe.createSource()
      const first = createRecordingContext()
      const second = createRecordingContext()
      await source.start(first.ctx)
      await source.stop()
      // A fresh context per start(): a source that keeps forwarding to the
      // context captured on the FIRST start() would pass if both calls
      // shared one object — so they must not.
      await source.start(second.ctx)
      await probe.triggerOnce(source)
      assert(
        totalEmitted(second.records, second.spans) >= 1,
        'expected emission to resume after start() -> stop() -> start()',
      )
      assert(
        totalEmitted(first.records, first.spans) === 0,
        'restarted source emitted into the context from its FIRST start() — it must adopt the newest one',
      )
      await source.stop()
    }),
  )

  // Known limitation: `start()`/`stop()` rejection recovery ("a failure must
  // leave the source stoppable, never wedged half-started") is documented on
  // the contract but NOT covered here — `CaptureSourceProbe` has no hook to
  // force a failure. Do not read a passing report as covering it.

  return { passed: checks.every((c) => c.passed), checks }
}
