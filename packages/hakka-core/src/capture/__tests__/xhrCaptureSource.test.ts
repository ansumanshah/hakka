import { beforeEach, describe, expect, test } from 'bun:test'

import { checkCaptureSourceConformance, type CaptureSourceProbe } from '../../contract/conformance'
import { breakpointEngine } from '../../engine/BreakpointEngine'
import { mockEngine } from '../../engine/MockEngine'
import { ThrottleEngine } from '../../engine/ThrottleEngine'
import { createXHRCaptureSource } from '../xhr'

/**
 * Deliberately a SEPARATE file from `xhr.test.ts`, not a `describe` block appended to it —
 * mirroring `websocketCaptureSource.test.ts`'s own doc for why. `xhr.test.ts`'s tests each call
 * `enableXHRInterceptor` (and `dispose()`) directly per-`it`, so nothing there pre-arms the
 * module-level idempotent-start guard ahead of a test here — but `MockEngine`/`BreakpointEngine`/
 * `ThrottleEngine` ARE process-wide singletons `xhr.ts`'s send() path reads unconditionally
 * (unlike the WebSocket interceptor, which touches none of them), so this file resets all three
 * itself instead of trusting another file's `afterEach` to have run first.
 */

// Minimal fake XMLHttpRequest — bun:test has no XMLHttpRequest global. Deliberately smaller than
// xhr.test.ts's FakeXHR (that file's class is private/unexported, per the doc above): only the
// members enableXHRInterceptor's default (non-throttled, non-blocked, non-mocked) send() path
// touches are implemented.
class FakeXHR {
  readyState = 0
  status = 0
  responseType = ''
  responseText = ''
  response: unknown = undefined

  private _listeners: Map<string, Array<(e: Event) => void>> = new Map()

  open(_method: string, _url: string): void {}

  setRequestHeader(_key: string, _value: string): void {}

  getAllResponseHeaders(): string {
    return ''
  }

  addEventListener(type: string, handler: (e: Event) => void, _useCapture?: boolean): void {
    const list = this._listeners.get(type) ?? []
    list.push(handler)
    this._listeners.set(type, list)
  }

  dispatchEvent(event: Event): boolean {
    for (const h of this._listeners.get(event.type) ?? []) h.call(this, event)
    return true
  }

  send(_data?: unknown): void {
    // Real XHR resolves async even for a same-tick mock backend — mirrors xhr.test.ts's FakeXHR.
    setTimeout(() => {
      this.readyState = 4
      this.status = 200
      this.responseText = '{"ok":true}'
      this.response = this.responseText
      this.dispatchEvent(new Event('loadend'))
    }, 0)
  }
}

/** Fresh subclass per install — same reasoning as websocketCaptureSource.test.ts's
 * `installFakeWebSocketGlobal`: each conformance check calls `createSource()` once, and a fresh
 * prototype per call keeps `enableXHRInterceptor`'s captured `orig*`/`saved*` references from one
 * check's source bleeding into another's. */
function installFakeXHRGlobal(): void {
  ;(globalThis as Record<string, unknown>).XMLHttpRequest = class extends FakeXHR {}
}

/** Construct through whatever `globalThis.XMLHttpRequest` currently is — the patched interceptor
 * prototype while a source is started, the plain fake once it's torn down. */
function connect(): FakeXHR {
  return new (globalThis.XMLHttpRequest as unknown as new () => FakeXHR)()
}

/** One macrotask tick. `FakeXHR.send()` schedules its own `setTimeout(0)` for `loadend` BEFORE
 * this one is scheduled (it runs synchronously inside `triggerOnce`, ahead of this `await`), so
 * by same-delay timer FIFO order the `loadend` event has always already fired once this
 * resolves — see the "work in flight" doc below for why that ordering is what lets the harness's
 * hardest check prove something real. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Unlike websocket's `dispatchFakeEvent` (synchronous), `FakeXHR.send()`'s response always lands
 * on a macrotask — so `triggerOnce` opens+sends synchronously (queuing that macrotask) and only
 * THEN awaits `flush()`. In the harness's "work in flight when stop() is called" check, this
 * means the synchronous open()/send() portion completes (and the response macrotask is queued)
 * before `source.stop()` runs; `stop()` itself is synchronous, so it can never race past that
 * queued macrotask — `stopped` is guaranteed `true` before `loadend` fires, proving the wrapper's
 * flag suppresses delivery rather than the event simply never having fired.
 */
function createXHRProbe(): CaptureSourceProbe {
  return {
    createSource() {
      installFakeXHRGlobal()
      return createXHRCaptureSource({ maxBodySize: 262_144, redactHeaders: [] })
    },
    async triggerOnce() {
      const xhr = connect()
      xhr.open('GET', 'https://api.example.com/conformance')
      xhr.send()
      await flush()
    },
  }
}

describe('createXHRCaptureSource — CaptureSource conformance', () => {
  beforeEach(() => {
    mockEngine.clearRules()
    breakpointEngine.resumeAll()
    breakpointEngine.clearBreakpoints()
    ThrottleEngine.setProfile('none')
  })

  test('all 7 lifecycle checks pass against the real wrapper', async () => {
    const report = await checkCaptureSourceConformance(createXHRProbe())
    expect(
      report.checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
    ).toEqual(report.checks.map((c) => `PASS: ${c.name}`))
    expect(report.passed).toBe(true)
  })

  test('identity and correlation match ADR 0006 row 2', () => {
    const source = createXHRCaptureSource({ maxBodySize: 262_144, redactHeaders: [] })
    expect(source.id).toBe('hakka.xhr')
    expect(source.runtime).toBe('client')
    expect(source.transport).toBe('xhr')
    expect(source.correlation).toBe('originates')
  })
})
