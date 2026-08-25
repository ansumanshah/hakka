import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

import { breakpointEngine } from '../../engine/BreakpointEngine'
import { mockEngine } from '../../engine/MockEngine'
import { ThrottleEngine } from '../../engine/ThrottleEngine'
import { HAKKA_TRACE_HEADER, configureTrace, setTraceProvider } from '../../engine/trace'
import { TRACEPARENT_HEADER, deriveTraceId } from '../../engine/traceparent'
import type { NetworkRequest } from '../../model/types'
import { enableXHRInterceptor } from '../xhr'

// Minimal fake XMLHttpRequest — bun:test has no XMLHttpRequest global.

// FakeEvent — minimal Event stub with stopImmediatePropagation support, so the bandwidth
// completion-delay logic can stop propagation and re-dispatch a __hakka_replayed synthetic event.
class FakeEvent {
  type: string
  __hakka_replayed?: boolean
  private _stopped = false

  constructor(type: string) {
    this.type = type
  }

  stopImmediatePropagation() {
    this._stopped = true
  }

  get stopped() {
    return this._stopped
  }
}

class FakeXHR {
  static UNSENT = 0
  static OPENED = 1
  static HEADERS_RECEIVED = 2
  static LOADING = 3
  static DONE = 4

  readyState = 0
  status = 0
  responseType = ''
  responseText = ''
  response: unknown = undefined

  // Separate capture-phase and bubble-phase listener lists per event type.
  private _captureListeners: Map<string, Array<(e: Event) => void>> = new Map()
  private _bubbleListeners: Map<string, Array<(e: Event) => void>> = new Map()
  private _reqHeaders: Map<string, string> = new Map()

  // Populated by the test before open() to control what this XHR returns
  __simulatedStatus = 200
  __simulatedResponseText = '{"ok":true}'
  __simulatedResponseHeaders = 'content-type: application/json\r\nx-trace-id: trace-abc'
  __skipAutoFire = false
  __sendSpy: ReturnType<typeof mock> | null = null

  open(_method: string, _url: string) {
    // Per the WHATWG spec, open() resets the author request header list — model that so a
    // breakpoint resume's re-open() realistically drops headers that aren't replayed.
    this._reqHeaders.clear()
  }

  send(data?: unknown) {
    if (this.__sendSpy) this.__sendSpy(data)
    if (this.__skipAutoFire) return
    // Simulate an async response completing
    setTimeout(() => {
      this.readyState = 4
      this.status = this.__simulatedStatus
      this.responseText = this.__simulatedResponseText
      this.response = this.__simulatedResponseText
      this._fire('loadend')
    }, 0)
  }

  setRequestHeader(key: string, value: string) {
    this._reqHeaders.set(key, value)
  }

  /** Test accessor — the exact value passed to the real (saved) setRequestHeader. */
  getRequestHeader(key: string): string | undefined {
    return this._reqHeaders.get(key)
  }

  getAllResponseHeaders(): string {
    return this.__simulatedResponseHeaders
  }

  addEventListener(event: string, handler: (e: Event) => void, useCapture?: boolean) {
    const map = useCapture ? this._captureListeners : this._bubbleListeners
    const list = map.get(event) ?? []
    list.push(handler)
    map.set(event, list)
  }

  dispatchEvent(event: Event) {
    this._fire(event.type, event)
    return true
  }

  _fire(eventType: string, event?: Event) {
    // Build a FakeEvent if not supplied, so stopImmediatePropagation works.
    const ev: FakeEvent = (event as unknown as FakeEvent) ?? new FakeEvent(eventType)

    // Capture-phase listeners first
    for (const h of this._captureListeners.get(eventType) ?? []) {
      h.call(this, ev as unknown as Event)
      if (ev.stopped) return
    }

    // Bubble-phase listeners
    for (const h of this._bubbleListeners.get(eventType) ?? []) {
      h.call(this, ev as unknown as Event)
      if (ev.stopped) return
    }
  }
}

const OrigXHR = (globalThis as Record<string, unknown>).XMLHttpRequest

function installFake() {
  ;(globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest
}

function removeFake() {
  if (OrigXHR === undefined) {
    delete (globalThis as Record<string, unknown>).XMLHttpRequest
  } else {
    ;(globalThis as Record<string, unknown>).XMLHttpRequest = OrigXHR
  }
}

describe('enableXHRInterceptor', () => {
  let dispose: (() => void) | null = null

  beforeEach(() => {
    installFake()
    mockEngine.clearRules()
    breakpointEngine.resumeAll()
    breakpointEngine.clearBreakpoints()
    ThrottleEngine.setProfile('none')
    dispose = null
  })

  afterEach(() => {
    if (dispose) {
      dispose()
      dispose = null
    }
    mockEngine.clearRules()
    breakpointEngine.resumeAll()
    breakpointEngine.clearBreakpoints()
    ThrottleEngine.setProfile('none')
    removeFake()
  })

  it('captures GET with url/method/status/source:xhr and parses response headers', (done) => {
    const records: NetworkRequest[] = []

    dispose = enableXHRInterceptor(
      (r) => {
        records.push(r)
        expect(r.url).toBe('https://api.example.com/users')
        expect(r.method).toBe('GET')
        expect(r.status).toBe(200)
        expect(r.source).toBe('xhr')
        // response headers parsed from getAllResponseHeaders()
        expect(r.responseHeaders['content-type']).toBe('application/json')
        expect(r.responseHeaders['x-trace-id']).toBe('trace-abc')
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__simulatedStatus = 200
    xhr.__simulatedResponseText = '{"users":[]}'
    xhr.__simulatedResponseHeaders = 'content-type: application/json\r\nx-trace-id: trace-abc'
    xhr.open('GET', 'https://api.example.com/users')
    xhr.send()
  })

  it('captures POST body and requestBodySize, and redacts sensitive headers', (done) => {
    const records: NetworkRequest[] = []

    dispose = enableXHRInterceptor(
      (r) => {
        records.push(r)
        expect(r.method).toBe('POST')
        expect(r.requestBody).toBe('{"q":"hello"}')
        expect(r.requestBodySize).toBe(13)
        // authorization must be redacted
        expect(r.requestHeaders['Authorization']).toBe('[REDACTED]')
        // content-type is not sensitive
        expect(r.requestHeaders['Content-Type']).toBe('application/json')
        done()
      },
      262_144,
      ['authorization'],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.open('POST', 'https://api.example.com/search')
    xhr.setRequestHeader('Authorization', 'Bearer secret-token')
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.send('{"q":"hello"}')
  })

  it('repeated setRequestHeader calls for the same name append, matching spec behavior', (done) => {
    dispose = enableXHRInterceptor(
      (r) => {
        // Per spec, setRequestHeader appends on a repeat call rather than overwriting —
        // capture must preserve both values, not just the last one.
        expect(r.requestHeaders['X-Custom']).toBe('a, b')
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.open('POST', 'https://api.example.com/search')
    xhr.setRequestHeader('X-Custom', 'a')
    xhr.setRequestHeader('X-Custom', 'b')
    xhr.send('{}')
  })

  it('sets error:"Network error" when status is 0', (done) => {
    dispose = enableXHRInterceptor(
      (r) => {
        expect(r.status).toBeNull()
        expect(r.error).toBe('Network error')
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__simulatedStatus = 0
    xhr.__simulatedResponseText = ''
    xhr.open('GET', 'https://api.example.com/fail')
    xhr.send()
  })

  it('sets responseBody to null but records true responseBodySize when response exceeds maxBodySize', (done) => {
    const BIG = 'x'.repeat(200)
    const MAX = 100

    dispose = enableXHRInterceptor(
      (r) => {
        expect(r.responseBody).toBeNull()
        expect(r.responseBodySize).toBe(200)
        done()
      },
      MAX,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__simulatedResponseText = BIG
    xhr.open('GET', 'https://api.example.com/big')
    xhr.send()
  })

  it('intercepts via mockEngine mock-mode: fires onRequest with mocked:true and skips real send', (done) => {
    mockEngine.addRule({
      pattern: 'api.example.com/mocked',
      response: { status: 201, body: '{"mocked":true}' },
      enabled: true,
    })

    const sendSpy = mock(() => {})

    dispose = enableXHRInterceptor(
      (r) => {
        expect(r.mocked).toBe(true)
        expect(r.status).toBe(201)
        expect(r.responseBody).toBe('{"mocked":true}')
        expect(r.source).toBe('xhr')
        // The fake's underlying send should NOT have been called
        expect(sendSpy).not.toHaveBeenCalled()
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    // Suppress the auto-fire; mock-mode bypasses send entirely
    xhr.__skipAutoFire = true
    xhr.__sendSpy = sendSpy
    xhr.open('POST', 'https://api.example.com/mocked')
    xhr.send('{}')
  })

  it('mock-mode advances the live xhr to DONE and fires load/loadend so a caller awaiting completion resolves', (done) => {
    mockEngine.addRule({
      pattern: 'api.example.com/mocked-completion',
      response: { status: 201, body: '{"mocked":true}' },
      enabled: true,
    })

    dispose = enableXHRInterceptor(() => {}, 262_144, [])

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__skipAutoFire = true
    xhr.open('GET', 'https://api.example.com/mocked-completion')
    xhr.addEventListener('load', () => {
      // A caller reading these off the live xhr (the primary way app code resolves an
      // in-flight XHR) must see the mocked completion, not the pre-send defaults.
      expect(xhr.readyState).toBe(4)
      expect(xhr.status).toBe(201)
      expect(xhr.responseText).toBe('{"mocked":true}')
      done()
    })
    xhr.send()
  })

  // A block-only rule previously fell through to the mock-serve branch (isRewrite() is false
  // for it) and was SERVED instead of aborted, unlike fetch.ts's block handling.
  it('block-only rule aborts the request with a network error and never calls real send', (done) => {
    mockEngine.addRule({
      pattern: 'api.example.com/blocked',
      block: true,
      response: { status: 200, body: '{"should":"never-serve"}' },
      enabled: true,
    })

    const sendSpy = mock(() => {})

    dispose = enableXHRInterceptor(
      (r) => {
        // Must show the blocked error, not a served mock response.
        expect(r.error).toBe('Blocked by Hakka')
        expect(r.status).toBeNull()
        expect(r.responseBody).toBeNull()
        expect(r.mocked).toBe(true)
        expect(r.source).toBe('xhr')
        // Real send must never be called for a block-only rule.
        expect(sendSpy).not.toHaveBeenCalled()
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__skipAutoFire = true
    xhr.__sendSpy = sendSpy
    xhr.open('GET', 'https://api.example.com/blocked')
    xhr.send('{}')
  })

  it('rewrite-mode rule passes through to real send and is captured by loadend', (done) => {
    mockEngine.addRule({
      pattern: 'api.example.com/rewrite-target',
      response: { status: 200, body: 'MOCK' },
      mode: 'rewrite',
      enabled: true,
    })

    const sendSpy = mock(() => {})

    dispose = enableXHRInterceptor(
      (r) => {
        // The record should come from real loadend, not mock handler
        expect(r.mocked).toBeUndefined()
        expect(r.source).toBe('xhr')
        expect(r.status).toBe(200)
        expect(sendSpy).toHaveBeenCalled() // real send WAS called
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__sendSpy = sendSpy
    xhr.open('GET', 'https://api.example.com/rewrite-target')
    xhr.send()
  })

  it('pauses on request breakpoint and applies URL edits on resume', (done) => {
    breakpointEngine.clearBreakpoints()
    breakpointEngine.addBreakpoint({ pattern: '/bp-test', on: 'request', enabled: true })

    dispose = enableXHRInterceptor(
      (r) => {
        // The resume path re-opens the XHR with the edited URL before sending.
        expect(r.url).toBe('https://api.example.com/bp-test-edited')
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__skipAutoFire = true // don't auto-fire loadend — resumed manually below
    xhr.open('GET', 'https://api.example.com/bp-test')

    // After send is called, the interceptor pauses. Resumed in the next tick.
    setTimeout(async () => {
      const paused = breakpointEngine.getPaused()
      expect(paused.length).toBe(1)
      expect(paused[0]?.phase).toBe('request')

      // Override __skipAutoFire so when savedSend is eventually called,
      // the fake XHR auto-fires loadend normally
      xhr.__skipAutoFire = false
      breakpointEngine.resume(paused[0]!.id, { url: 'https://api.example.com/bp-test-edited' })
      // done() is called in onRequest above
    }, 10)

    xhr.send()
  })

  it('resume with a URL edit replays the caller-set headers on the re-opened connection', (done) => {
    breakpointEngine.clearBreakpoints()
    breakpointEngine.addBreakpoint({ pattern: '/bp-headers', on: 'request', enabled: true })

    dispose = enableXHRInterceptor(() => {}, 262_144, [])

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__skipAutoFire = true
    xhr.open('POST', 'https://api.example.com/bp-headers')
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', 'Bearer original-token')

    setTimeout(() => {
      const paused = breakpointEngine.getPaused()
      expect(paused.length).toBe(1)

      xhr.__skipAutoFire = false
      // URL-only edit — no header edit — must not lose the headers set before the pause.
      breakpointEngine.resume(paused[0]!.id, { url: 'https://api.example.com/bp-headers-edited' })

      setTimeout(() => {
        expect(xhr.getRequestHeader('Content-Type')).toBe('application/json')
        expect(xhr.getRequestHeader('Authorization')).toBe('Bearer original-token')
        done()
      }, 10)
    }, 10)

    xhr.send('{}')
  })

  it('emits error record and skips real send on breakpoint abort', (done) => {
    breakpointEngine.clearBreakpoints()
    breakpointEngine.addBreakpoint({ pattern: '/abort-test', on: 'request', enabled: true })

    const sendSpy = mock(() => {})

    dispose = enableXHRInterceptor(
      (r) => {
        expect(r.error).toBe('Aborted by Hakka')
        expect(r.status).toBeNull()
        expect(sendSpy).not.toHaveBeenCalled()
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__skipAutoFire = true
    xhr.__sendSpy = sendSpy
    xhr.open('POST', 'https://api.example.com/abort-test')

    setTimeout(() => {
      const paused = breakpointEngine.getPaused()
      expect(paused.length).toBe(1)
      breakpointEngine.abort(paused[0]!.id)
    }, 10)

    xhr.send('{}')
  })

  it('emits offline error record when ThrottleEngine is offline', (done) => {
    ThrottleEngine.setProfile('offline')

    const sendSpy = mock(() => {})

    dispose = enableXHRInterceptor(
      (r) => {
        expect(r.error).toBe('Network request failed — offline mode (Hakka)')
        expect(r.status).toBeNull()
        expect(r.source).toBe('xhr')
        expect(sendSpy).not.toHaveBeenCalled()
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__skipAutoFire = true
    xhr.__sendSpy = sendSpy
    xhr.open('GET', 'https://api.example.com/offline-check')
    xhr.send()
  })

  it('_noHakka=true bypasses capture and calls real send directly', (done) => {
    const records: NetworkRequest[] = []
    const sendSpy = mock(() => {})

    dispose = enableXHRInterceptor(
      (r) => {
        records.push(r)
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    ;(xhr as unknown as Record<string, unknown>)._noHakka = true
    xhr.__sendSpy = sendSpy
    // skipAutoFire so loadend never fires — meaning no record is emitted
    xhr.__skipAutoFire = true
    xhr.open('GET', 'https://api.example.com/no-capture')
    xhr.send()

    setTimeout(() => {
      // sendSpy called (the real send path hit), but onRequest never called
      expect(sendSpy).toHaveBeenCalled()
      expect(records.length).toBe(0)
      done()
    }, 30)
  })

  // These tests verify the caller's loadend handler fires no earlier than the computed delay
  // when a throttle profile with downloadKbps > 0 is active (delayed completion, not true streaming).

  it('profile:none — loadend fires immediately, zero overhead', (done) => {
    // profile is already 'none' from beforeEach; verify explicitly
    ThrottleEngine.setProfile('none')

    dispose = enableXHRInterceptor(() => {}, 262_144, [])

    const t0 = Date.now()
    let callerFired = false

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.open('GET', 'https://api.example.com/none-profile')

    // Register the caller's loadend BEFORE send so it is added to the bubble list
    xhr.addEventListener('loadend', () => {
      callerFired = true
    })

    xhr.send()

    // Allow 2 ticks for the fake's setTimeout(fn, 0) + event dispatch
    setTimeout(() => {
      const elapsed = Date.now() - t0
      expect(callerFired).toBe(true)
      // No artificial delay — the throttled sibling below computes ~80ms, so
      // anything under 70 proves no throttle ran. 50 left only 20ms of headroom
      // over this callback's own 30ms timer and flaked under `just verify`'s
      // 14 parallel legs (observed 56ms of pure scheduler jitter).
      expect(elapsed).toBeLessThan(70)
      done()
    }, 30)
  })

  // 400 kbps / 0ms latency, 4096-byte body: expected delay = 4096 / (400*1024/8/1000) = ~80ms.
  // Asserts >= 50ms (generous lower bound to survive timer jitter).
  it('throttled profile — caller loadend fires no earlier than computed delay', (done) => {
    ThrottleEngine.setCustom(0, 400) // 0ms latency, 400 kbps download

    dispose = enableXHRInterceptor(() => {}, 262_144, [])

    const BODY = 'x'.repeat(4096)
    const t0 = Date.now()
    let callerFiredAt = -1

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__simulatedResponseText = BODY
    xhr.open('GET', 'https://api.example.com/throttled')

    xhr.addEventListener('loadend', () => {
      callerFiredAt = Date.now()
    })

    xhr.send()

    // Wait long enough for the delay to elapse: expected ~80ms, wait 300ms
    setTimeout(() => {
      expect(callerFiredAt).toBeGreaterThan(-1) // fired at all
      const elapsed = callerFiredAt - t0
      // 4096 bytes at 400 kbps = ~80ms. Lower bound = 50ms (accounts for jitter).
      expect(elapsed).toBeGreaterThanOrEqual(50)
      done()
    }, 300)
  }, 2000)

  // 100ms latency + 400 kbps download: expected total = 100 + 80 = 180ms. Assert >= 130ms.
  it('throttled profile with latency — completion delay includes latency + download time', (done) => {
    ThrottleEngine.setCustom(100, 400) // 100ms latency, 400 kbps download

    dispose = enableXHRInterceptor(() => {}, 262_144, [])

    const BODY = 'x'.repeat(4096)
    const t0 = Date.now()
    let callerFiredAt = -1

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__simulatedResponseText = BODY
    xhr.open('GET', 'https://api.example.com/throttled-with-latency')

    xhr.addEventListener('loadend', () => {
      callerFiredAt = Date.now()
    })

    xhr.send()

    setTimeout(() => {
      expect(callerFiredAt).toBeGreaterThan(-1)
      const elapsed = callerFiredAt - t0
      // 100ms latency + 4096 bytes at 400 kbps (~80ms) = ~180ms. Lower bound 130ms.
      expect(elapsed).toBeGreaterThanOrEqual(130)
      done()
    }, 600)
  }, 3000)

  it('offline mode — errors the XHR, caller loadend never fires', (done) => {
    ThrottleEngine.setProfile('offline')

    const sendSpy = mock(() => {})
    let callerLoadendFired = false

    dispose = enableXHRInterceptor(() => {}, 262_144, [])

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__skipAutoFire = true
    xhr.__sendSpy = sendSpy

    xhr.open('GET', 'https://api.example.com/offline-bandwidth-check')

    xhr.addEventListener('loadend', () => {
      callerLoadendFired = true
    })

    xhr.send()

    setTimeout(() => {
      // Offline short-circuits before savedSend — real send never called
      expect(sendSpy).not.toHaveBeenCalled()
      // The offline path emits a synthetic error event, not a successful loadend
      expect(callerLoadendFired).toBe(false)
      done()
    }, 50)
  })

  it('throttled profile with empty response body — no download delay added', (done) => {
    ThrottleEngine.setCustom(0, 400) // 400 kbps, but body is empty

    dispose = enableXHRInterceptor(() => {}, 262_144, [])

    const t0 = Date.now()
    let callerFiredAt = -1

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.__simulatedResponseText = '' // empty body → 0 bytes
    xhr.open('GET', 'https://api.example.com/empty-body-throttle')

    xhr.addEventListener('loadend', () => {
      callerFiredAt = Date.now()
    })

    xhr.send()

    setTimeout(() => {
      expect(callerFiredAt).toBeGreaterThan(-1)
      const elapsed = callerFiredAt - t0
      // No download delay for empty body — should complete quickly
      expect(elapsed).toBeLessThan(80)
      done()
    }, 150)
  })
})

// Trace correlation — mirrors fetchTrace.test.ts's coverage of the fetch interceptor's trace
// path. The XHR interceptor injects the same two headers via the real setRequestHeader before
// send, and stamps the same correlationId on every emitted record.
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

function stubLocation(origin: string): void {
  ;(globalThis as Record<string, unknown>).location = { href: `${origin}/`, origin }
}

describe('enableXHRInterceptor — trace propagation', () => {
  let dispose: (() => void) | null = null

  beforeEach(() => {
    installFake()
    mockEngine.clearRules()
  })

  afterEach(() => {
    if (dispose) {
      dispose()
      dispose = null
    }
    mockEngine.clearRules()
    configureTrace({ enabled: false, propagateOrigins: undefined })
    setTraceProvider(null)
    delete (globalThis as Record<string, unknown>).location
    removeFake()
  })

  it('client-originated XHR emits BOTH x-hakka-trace and a matching traceparent, and the record carries correlationId', (done) => {
    stubLocation('https://app.test')
    configureTrace({ enabled: true })

    dispose = enableXHRInterceptor(
      (r) => {
        const hakkaTrace = xhr.getRequestHeader(HAKKA_TRACE_HEADER)
        expect(hakkaTrace).toBeTruthy()

        const traceparent = xhr.getRequestHeader(TRACEPARENT_HEADER)
        expect(traceparent).toBeTruthy()
        const match = TRACEPARENT_RE.exec(traceparent!)
        expect(match).not.toBeNull()

        // The traceparent's trace-id segment is the SAME correlationId run through the shared derivation.
        expect(match?.[2]).toBe(deriveTraceId(hakkaTrace!))

        // The captured record's correlationId matches the x-hakka-trace header sent to setRequestHeader.
        expect(r.correlationId).toBe(hakkaTrace!)
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.open('GET', 'https://app.test/api/products')
    xhr.send()
  })

  it('a server context (inherited trace provider) also gets a traceparent, not just x-hakka-trace', (done) => {
    setTraceProvider(() => 'server-inherited-id')

    dispose = enableXHRInterceptor(
      (r) => {
        expect(xhr.getRequestHeader(HAKKA_TRACE_HEADER)).toBe('server-inherited-id')
        const traceparent = xhr.getRequestHeader(TRACEPARENT_HEADER)
        expect(TRACEPARENT_RE.exec(traceparent ?? '')?.[2]).toBe(deriveTraceId('server-inherited-id'))
        expect(r.correlationId).toBe('server-inherited-id')
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.open('GET', 'https://upstream.test/x')
    xhr.send()
  })

  it('never overwrites a caller-supplied x-hakka-trace or traceparent header', (done) => {
    stubLocation('https://app.test')
    configureTrace({ enabled: true })

    dispose = enableXHRInterceptor(
      () => {
        expect(xhr.getRequestHeader(HAKKA_TRACE_HEADER)).toBe('caller-supplied-trace-id')
        expect(xhr.getRequestHeader(TRACEPARENT_HEADER)).toBe('00-11111111111111111111111111111111-2222222222222222-01')
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.open('GET', 'https://app.test/api/x')
    xhr.setRequestHeader(HAKKA_TRACE_HEADER, 'caller-supplied-trace-id')
    xhr.setRequestHeader(TRACEPARENT_HEADER, '00-11111111111111111111111111111111-2222222222222222-01')
    xhr.send()
  })

  it('no trace context / not enabled: no trace headers are set and no correlationId is stamped', (done) => {
    dispose = enableXHRInterceptor(
      (r) => {
        expect(xhr.getRequestHeader(HAKKA_TRACE_HEADER)).toBeUndefined()
        expect(xhr.getRequestHeader(TRACEPARENT_HEADER)).toBeUndefined()
        expect(r.correlationId).toBeUndefined()
        done()
      },
      262_144,
      [],
    )

    const xhr = new XMLHttpRequest() as unknown as FakeXHR
    xhr.open('GET', 'https://app.test/api/x')
    xhr.send()
  })
})
