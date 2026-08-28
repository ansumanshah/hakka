import { describe, expect, test } from 'bun:test'

import { checkCaptureSourceConformance, type CaptureSourceProbe } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

import { createCdpCaptureSource } from '../capture'
import type { CdpTransport } from '../types'

/**
 * Deliberately a SEPARATE file from `capture.test.ts`, not a `describe` block appended to it —
 * same reasoning as `websocketCaptureSource.test.ts`'s own doc: keeps the wrapper's conformance
 * run and quirk tests from tangling with `capture.test.ts`'s own hand-rolled `createCdpCapture`
 * assertions.
 *
 * `FakeTransport` is a local duplicate of `capture.test.ts`'s private class (same shape,
 * unexported there) rather than a shared import, again mirroring `websocketCaptureSource.test.ts`.
 */
class FakeTransport implements CdpTransport {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  responses = new Map<string, unknown>()
  private listeners = new Map<string, Set<(params: unknown) => void>>()

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    return (this.responses.get(method) as T) ?? (undefined as T)
  }

  on(event: string, listener: (params: unknown) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)?.add(listener)
  }

  off(event: string, listener: (params: unknown) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string, params: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(params)
  }
}

let requestCounter = 0

/** Fires ONE `Network.requestWillBeSent` — `mapper.ts` emits synchronously on this event alone (see its own doc), so this is a complete, single-emission `triggerOnce()` with no async work needed. */
function fireRequestWillBeSent(transport: FakeTransport): void {
  const id = `conformance-${++requestCounter}`
  transport.emit('Network.requestWillBeSent', {
    requestId: id,
    loaderId: 'l1',
    timestamp: 10,
    wallTime: 1_700_000_000,
    request: { url: `https://api.example.com/${id}`, method: 'GET', headers: {} },
    type: 'XHR',
  })
}

describe('createCdpCaptureSource — CaptureSource conformance', () => {
  function createCdpProbe(): CaptureSourceProbe {
    let transport: FakeTransport
    return {
      createSource() {
        transport = new FakeTransport()
        return createCdpCaptureSource({ transport })
      },
      triggerOnce() {
        fireRequestWillBeSent(transport)
      },
    }
  }

  test('all 7 lifecycle checks pass against the real wrapper', async () => {
    const report = await checkCaptureSourceConformance(createCdpProbe())
    expect(
      report.checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
    ).toEqual(report.checks.map((c) => `PASS: ${c.name}`))
    expect(report.passed).toBe(true)
  })

  test('identity and correlation match ADR 0006 row 9', () => {
    const source = createCdpCaptureSource({ transport: new FakeTransport() })
    expect(source.id).toBe('hakka.cdp')
    expect(source.runtime).toBe('client')
    expect(source.transport).toBe('cdp')
    expect(source.correlation).toBe('none')
  })
})

describe('createCdpCaptureSource — mechanism-specific quirks (ADR 0006 row 9)', () => {
  // The generic conformance harness's "work in flight when stop() is called must not emit after
  // it" check passes trivially against `fireRequestWillBeSent` alone, since that path is fully
  // synchronous — it never exercises CDP's one genuinely async in-flight case. This test drives
  // that case directly THROUGH the wrapper (capture.test.ts already proves `createCdpCapture`
  // itself gets this right; this proves the wrapper doesn't reintroduce a leak on top of it).
  test('a Network.getResponseBody resolving after stop() does not reach ctx.ingest through the wrapper', async () => {
    const transport = new FakeTransport()
    let resolveBody: (value: { body: string; base64Encoded: boolean }) => void = () => {}
    const bodyPromise = new Promise<{ body: string; base64Encoded: boolean }>((resolve) => {
      resolveBody = resolve
    })
    const originalSend = transport.send.bind(transport)
    transport.send = (async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Network.getResponseBody') {
        transport.calls.push({ method, params })
        return bodyPromise as unknown
      }
      return originalSend(method, params)
    }) as typeof transport.send

    const source = createCdpCaptureSource({ transport })
    const records: NetworkRequest[] = []
    await source.start({ ingest: (r) => records.push(r) })

    transport.emit('Network.requestWillBeSent', {
      requestId: 'r-late',
      loaderId: 'l1',
      timestamp: 10,
      wallTime: 1_700_000_000,
      request: { url: 'https://api.example.com/late', method: 'GET', headers: {} },
      type: 'XHR',
    })
    transport.emit('Network.responseReceived', {
      requestId: 'r-late',
      loaderId: 'l1',
      timestamp: 10.05,
      type: 'XHR',
      response: {
        url: 'https://api.example.com/late',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
      },
    })
    // Triggers the mapper's fetchResponseBody call, now stuck awaiting bodyPromise.
    transport.emit('Network.loadingFinished', { requestId: 'r-late', timestamp: 10.1, encodedDataLength: 16 })

    const recordCountBeforeStop = records.length
    await source.stop()

    // Resolve the in-flight body fetch only AFTER stop() has already resolved.
    resolveBody({ body: '{"late":true}', base64Encoded: false })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(records.length).toBe(recordCountBeforeStop)
    expect(records.some((r) => r.responseBody === '{"late":true}')).toBe(false)
  })

  // Proves the wrapper is a pure additive pass-through — every `CreateCdpCaptureOptions` knob
  // besides `onRequest`/`runtime` (see capture.ts's doc on why those two are handled specially)
  // still reaches `createCdpCapture` unchanged, exercised here with the same option
  // `capture.test.ts` uses for its own `createCdpCapture`-level version of this assertion.
  test('non-identity options (captureBody: false) thread through unchanged', async () => {
    const transport = new FakeTransport()
    const source = createCdpCaptureSource({ transport, captureBody: false })
    const records: NetworkRequest[] = []
    await source.start({ ingest: (r) => records.push(r) })

    transport.emit('Network.requestWillBeSent', {
      requestId: 'r-no-body',
      loaderId: 'l1',
      timestamp: 10,
      wallTime: 1_700_000_000,
      request: { url: 'https://api.example.com/no-body', method: 'GET', headers: {} },
      type: 'XHR',
    })
    transport.emit('Network.responseReceived', {
      requestId: 'r-no-body',
      loaderId: 'l1',
      timestamp: 10.05,
      type: 'XHR',
      response: {
        url: 'https://api.example.com/no-body',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
      },
    })
    transport.emit('Network.loadingFinished', { requestId: 'r-no-body', timestamp: 10.1, encodedDataLength: 16 })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(transport.calls.some((c) => c.method === 'Network.getResponseBody')).toBe(false)
    expect(records.at(-1)?.responseBody).toBeNull()

    await source.stop()
  })

  // Regression for the bug the conformance harness can't reach (see its own "Known limitation"
  // comment): `createCdpCapture().start()` sets `started = true` and registers every listener
  // SYNCHRONOUSLY, then `await`s `Network.enable` — which can reject (target navigated away,
  // session detached, WS hiccup mid-handshake). The wrapper must not adopt that instance as
  // `capture` until `start()` has actually succeeded, or every later `source.start()` call sees
  // the guard already set and silently no-ops forever with no further `Network.enable` sent.
  test('a rejected start() leaves the source restartable, not silently wedged', async () => {
    const transport = new FakeTransport()
    let enableCalls = 0
    const originalSend = transport.send.bind(transport)
    transport.send = (async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Network.enable') {
        enableCalls++
        if (enableCalls === 1) throw new Error('Network.enable failed: session detached')
      }
      return originalSend(method, params)
    }) as typeof transport.send

    const source = createCdpCaptureSource({ transport })
    const records: NetworkRequest[] = []

    await expect(source.start({ ingest: (r) => records.push(r) })).rejects.toThrow(
      'Network.enable failed: session detached',
    )

    // The retry must actually re-attempt Network.enable — not silently no-op because `capture`
    // was adopted before the first attempt's rejection.
    await source.start({ ingest: (r) => records.push(r) })
    expect(enableCalls).toBe(2)

    fireRequestWillBeSent(transport)
    expect(records.length).toBe(1)

    await source.stop()
  })
})
