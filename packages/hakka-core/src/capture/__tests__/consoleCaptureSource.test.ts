import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { checkCaptureSourceConformance, type CaptureSourceProbe } from '../../contract/conformance'
import { ConsoleInterceptor, createConsoleCaptureSource } from '../console'

/**
 * Deliberately a SEPARATE file from `console.test.ts` — same reason
 * `websocketCaptureSource.test.ts` is split from `websocket.test.ts`:
 * `ConsoleInterceptor` is a module-level singleton, and interleaving this
 * file's `createConsoleCaptureSource()`-driven enable/disable cycles with
 * `console.test.ts`'s direct `ConsoleInterceptor.enable()` calls in one file
 * would make a failure ambiguous about which layer broke.
 */

// Save originals + silence output during tests — same hygiene as console.test.ts.
const originals = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
}

beforeEach(() => {
  for (const k of Object.keys(originals) as Array<keyof typeof originals>) {
    console[k] = () => {}
  }
})

afterEach(() => {
  ConsoleInterceptor.disable()
  for (const k of Object.keys(originals) as Array<keyof typeof originals>) {
    console[k] = originals[k]
  }
})

function createConsoleProbe(): CaptureSourceProbe {
  return {
    createSource() {
      return createConsoleCaptureSource()
    },
    triggerOnce() {
      console.log('conformance-ping')
    },
  }
}

/**
 * ADR 0006 row 4: `createConsoleCaptureSource` never calls `ctx.ingest`/
 * `ctx.emitSpan` — there is no honest `NetworkRequest`/`FrameworkSpan` shape
 * for a console entry, and the contract deliberately has no `emitRecord?()`
 * slot (see console.ts's doc comment on the factory). So unlike
 * `websocketCaptureSource.test.ts`/`spanProcessor.test.ts`, this suite does
 * NOT assert `report.passed`. It asserts each of the 7 checks individually:
 * the four pure lifecycle/teardown checks (no emission required) must pass;
 * the three that assert an emission COUNT are structurally impossible for an
 * emission-less source to pass, and are asserted to fail for that documented
 * reason rather than silently ignored.
 */
describe('createConsoleCaptureSource — CaptureSource conformance', () => {
  test('conformance report: lifecycle checks pass, emission-count checks fail', async () => {
    const report = await checkCaptureSourceConformance(createConsoleProbe())
    const byName = new Map(report.checks.map((c) => [c.name, c.passed]))

    expect(report.checks).toHaveLength(7)

    const mustPass = [
      'stop() before start() is a fail-open no-op',
      'stop() is idempotent — a second call is a fail-open no-op',
      'teardown emits nothing after stop()',
      'work in flight when stop() is called must not emit after it',
    ]
    for (const name of mustPass) {
      expect(byName.get(name)).toBe(true)
    }

    const mustFail = [
      'start() is idempotent — a second call does not double-wire emission',
      'emission reaches the context sink',
      'a start() -> stop() -> start() cycle re-arms onto the NEW context',
    ]
    for (const name of mustFail) {
      expect(byName.get(name)).toBe(false)
    }

    expect(report.passed).toBe(false)
  })

  test('identity and correlation match ADR 0006 row 4', () => {
    const source = createConsoleCaptureSource()
    expect(source.id).toBe('hakka.console')
    expect(source.runtime).toBe('client')
    expect(source.transport).toBe('console')
    expect(source.correlation).toBe('none')
  })
})

describe('createConsoleCaptureSource — lifecycle wraps ConsoleInterceptor', () => {
  test('start() enables ConsoleInterceptor; stop() disables it', async () => {
    const source = createConsoleCaptureSource()
    expect(ConsoleInterceptor.isEnabled).toBe(false)

    await source.start({ ingest() {} })
    expect(ConsoleInterceptor.isEnabled).toBe(true)

    await source.stop()
    expect(ConsoleInterceptor.isEnabled).toBe(false)
  })

  test('a second start() does not throw and stays enabled', async () => {
    const source = createConsoleCaptureSource()
    await source.start({ ingest() {} })
    await source.start({ ingest() {} }) // second call: must not throw, must not re-patch
    expect(ConsoleInterceptor.isEnabled).toBe(true)
    await source.stop()
  })

  test('stop() before start() does not disable an interceptor a different caller enabled', async () => {
    ConsoleInterceptor.enable() // simulate an unrelated caller already using the shared singleton
    const source = createConsoleCaptureSource()

    await source.stop() // no-op per the contract — this instance never started

    expect(ConsoleInterceptor.isEnabled).toBe(true)
  })

  test('ctx.ingest and ctx.emitSpan are never called, even while console methods fire repeatedly', async () => {
    const records: unknown[] = []
    const spans: unknown[] = []
    const source = createConsoleCaptureSource()

    await source.start({
      ingest: (r) => records.push(r),
      emitSpan: (s) => spans.push(s),
    })
    console.log('one')
    console.warn('two')
    console.error('three')
    await source.stop()

    expect(records).toHaveLength(0)
    expect(spans).toHaveLength(0)
  })
})
