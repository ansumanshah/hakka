import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import type { CaptureSource, CaptureSourceContext } from '../captureSource'
import { checkCaptureSourceConformance, type CaptureSourceProbe } from '../conformance'

function fakeRecord(id: string): NetworkRequest {
  return {
    id,
    url: 'https://example.test/fake',
    method: 'GET',
    startTime: Date.now(),
    source: 'fetch',
  }
}

/**
 * A trivial in-memory `CaptureSource` — no real interception, just a
 * `notify()` hook a test can call while started to simulate one captured
 * event. A single "am I started" guard makes a second `start()`/`stop()` a
 * safe no-op.
 */
class WellBehavedFakeSource implements CaptureSource {
  readonly id = 'test.fake'
  readonly runtime = 'client' as const
  readonly transport = 'fake'
  readonly correlation = 'none' as const

  private ctx: CaptureSourceContext | null = null
  private counter = 0

  start(ctx: CaptureSourceContext): void {
    if (this.ctx) return // idempotent: already started
    this.ctx = ctx
  }

  stop(): void {
    this.ctx = null // idempotent: stop() with no active ctx is already a no-op
  }

  /** Simulate one captured request while started. No-ops once stopped. */
  notify(): void {
    this.ctx?.ingest(fakeRecord(`fake-${++this.counter}`))
  }
}

const wellBehavedProbe: CaptureSourceProbe = {
  createSource: () => new WellBehavedFakeSource(),
  triggerOnce: (source) => (source as WellBehavedFakeSource).notify(),
}

describe('checkCaptureSourceConformance — well-behaved fake', () => {
  test('passes every check', async () => {
    const report = await checkCaptureSourceConformance(wellBehavedProbe)
    const failures = report.checks.filter((c) => !c.passed)
    expect(failures).toEqual([])
    expect(report.passed).toBe(true)
  })
})

/**
 * Deliberately broken: `start()` has no idempotency guard, so every call
 * pushes another listener — a second `start()` followed by one `notify()`
 * emits twice. This exists to prove the harness actually catches the bug
 * it claims to catch, not just to exercise the happy path.
 */
class DoubleEmitOnDoubleStartSource implements CaptureSource {
  readonly id = 'test.broken-double-start'
  readonly runtime = 'client' as const
  readonly transport = 'fake'
  readonly correlation = 'none' as const

  private ctxs: CaptureSourceContext[] = []
  private counter = 0

  start(ctx: CaptureSourceContext): void {
    this.ctxs.push(ctx) // BUG: no idempotency guard
  }

  stop(): void {
    this.ctxs = []
  }

  notify(): void {
    for (const ctx of this.ctxs) ctx.ingest(fakeRecord(`broken-${++this.counter}`))
  }
}

describe('checkCaptureSourceConformance — catches a double-start bug', () => {
  test('flags the idempotency check and only that one', async () => {
    const probe: CaptureSourceProbe = {
      createSource: () => new DoubleEmitOnDoubleStartSource(),
      triggerOnce: (source) => (source as DoubleEmitOnDoubleStartSource).notify(),
    }
    const report = await checkCaptureSourceConformance(probe)
    expect(report.passed).toBe(false)
    const idempotencyCheck = report.checks.find((c) => c.name.startsWith('start() is idempotent'))
    expect(idempotencyCheck?.passed).toBe(false)
    // Checks unrelated to double-start (e.g. plain single-emission delivery) still pass.
    const emissionCheck = report.checks.find((c) => c.name === 'emission reaches the context sink')
    expect(emissionCheck?.passed).toBe(true)
  })
})

/**
 * Deliberately broken: `stop()` forgets to clear its reference to `ctx`, so
 * a `notify()` call after `stop()` still delivers — the "in-flight async
 * work ignores the stopped flag" bug class the teardown guarantee exists
 * to catch.
 */
class EmitsAfterStopSource implements CaptureSource {
  readonly id = 'test.broken-emits-after-stop'
  readonly runtime = 'client' as const
  readonly transport = 'fake'
  readonly correlation = 'none' as const

  private ctx: CaptureSourceContext | null = null
  private counter = 0

  start(ctx: CaptureSourceContext): void {
    this.ctx = ctx
  }

  stop(): void {
    // BUG: doesn't clear `this.ctx`.
  }

  notify(): void {
    this.ctx?.ingest(fakeRecord(`leak-${++this.counter}`))
  }
}

describe('checkCaptureSourceConformance — catches a post-stop leak', () => {
  test('flags the teardown check', async () => {
    const probe: CaptureSourceProbe = {
      createSource: () => new EmitsAfterStopSource(),
      triggerOnce: (source) => (source as EmitsAfterStopSource).notify(),
    }
    const report = await checkCaptureSourceConformance(probe)
    expect(report.passed).toBe(false)
    const teardownCheck = report.checks.find((c) => c.name === 'teardown emits nothing after stop()')
    expect(teardownCheck?.passed).toBe(false)
  })
})
