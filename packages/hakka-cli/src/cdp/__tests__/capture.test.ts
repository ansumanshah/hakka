import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from 'hakka-core'

import { createCdpCapture } from '../capture'
import type { CdpTransport } from '../types'

/** Fake transport — no real CDP session, just enough to drive `createCdpCapture` and assert what it sent/subscribed to. */
class FakeTransport implements CdpTransport {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  responses = new Map<string, unknown>()
  rejectMethods = new Set<string>()
  private listeners = new Map<string, Set<(params: unknown) => void>>()

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (this.rejectMethods.has(method)) throw new Error(`${method} failed`)
    return (this.responses.get(method) as T) ?? (undefined as T)
  }

  on(event: string, listener: (params: unknown) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)?.add(listener)
  }

  off(event: string, listener: (params: unknown) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }

  emit(event: string, params: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(params)
  }
}

const NETWORK_EVENTS = [
  'Network.requestWillBeSent',
  'Network.requestWillBeSentExtraInfo',
  'Network.responseReceived',
  'Network.responseReceivedExtraInfo',
  'Network.dataReceived',
  'Network.loadingFinished',
  'Network.loadingFailed',
]

describe('createCdpCapture', () => {
  test('start() enables the Network domain and subscribes to every event this package understands', async () => {
    const transport = new FakeTransport()
    const capture = createCdpCapture({ transport, onRequest: () => {} })

    await capture.start()

    expect(transport.calls).toEqual([{ method: 'Network.enable', params: {} }])
    for (const event of NETWORK_EVENTS) {
      expect(transport.listenerCount(event)).toBe(1)
    }
  })

  test('start() is idempotent — calling twice does not double-subscribe or double-enable', async () => {
    const transport = new FakeTransport()
    const capture = createCdpCapture({ transport, onRequest: () => {} })

    await capture.start()
    await capture.start()

    expect(transport.calls.filter((c) => c.method === 'Network.enable').length).toBe(1)
    expect(transport.listenerCount('Network.requestWillBeSent')).toBe(1)
  })

  test('a request finished before stop() is called fetches its body and finalizes', async () => {
    const transport = new FakeTransport()
    transport.responses.set('Network.getResponseBody', { body: '{"ok":true}', base64Encoded: false })
    const records: NetworkRequest[] = []
    const capture = createCdpCapture({ transport, onRequest: (r) => records.push(r) })

    await capture.start()
    transport.emit('Network.requestWillBeSent', {
      requestId: 'r2',
      loaderId: 'l1',
      timestamp: 10,
      wallTime: 1_700_000_000,
      request: { url: 'https://api.example.com/y', method: 'GET', headers: {} },
      type: 'XHR',
    })
    transport.emit('Network.responseReceived', {
      requestId: 'r2',
      loaderId: 'l1',
      timestamp: 10.05,
      type: 'XHR',
      response: {
        url: 'https://api.example.com/y',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
      },
    })
    // loadingFinished triggers an async body fetch through transport.send — await the mapper's own promise
    // by draining the microtask queue via the listener's returned (fire-and-forget) call. Give it a tick.
    transport.emit('Network.loadingFinished', { requestId: 'r2', timestamp: 10.1, encodedDataLength: 32 })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(transport.calls.some((c) => c.method === 'Network.getResponseBody' && c.params?.requestId === 'r2')).toBe(
      true,
    )
    const final = records.at(-1)
    expect(final?.status).toBe(200)
    expect(final?.responseBody).toBe('{"ok":true}')

    await capture.stop()
  })

  test('stop() detaches listeners and disables the Network domain; further events are ignored', async () => {
    const transport = new FakeTransport()
    const records: NetworkRequest[] = []
    const capture = createCdpCapture({ transport, onRequest: (r) => records.push(r) })

    await capture.start()
    await capture.stop()

    expect(transport.calls.some((c) => c.method === 'Network.disable')).toBe(true)
    for (const event of NETWORK_EVENTS) {
      expect(transport.listenerCount(event)).toBe(0)
    }

    transport.emit('Network.requestWillBeSent', {
      requestId: 'ignored',
      loaderId: 'l1',
      timestamp: 0,
      wallTime: 0,
      request: { url: 'https://example.com', method: 'GET', headers: {} },
    })
    expect(records.length).toBe(0)
  })

  test('stop() never throws even if the transport is already closed (Network.disable rejects)', async () => {
    const transport = new FakeTransport()
    transport.rejectMethods.add('Network.disable')
    const capture = createCdpCapture({ transport, onRequest: () => {} })

    await capture.start()
    await expect(capture.stop()).resolves.toBeUndefined()
  })

  test('stop() before start() is a no-op, not an error', async () => {
    const transport = new FakeTransport()
    const capture = createCdpCapture({ transport, onRequest: () => {} })
    await expect(capture.stop()).resolves.toBeUndefined()
    expect(transport.calls.length).toBe(0)
  })

  test('captureBody: false never calls Network.getResponseBody', async () => {
    const transport = new FakeTransport()
    const records: NetworkRequest[] = []
    const capture = createCdpCapture({ transport, onRequest: (r) => records.push(r), captureBody: false })

    await capture.start()
    transport.emit('Network.requestWillBeSent', {
      requestId: 'r3',
      loaderId: 'l1',
      timestamp: 10,
      wallTime: 1_700_000_000,
      request: { url: 'https://api.example.com/z', method: 'GET', headers: {} },
      type: 'XHR',
    })
    transport.emit('Network.responseReceived', {
      requestId: 'r3',
      loaderId: 'l1',
      timestamp: 10.05,
      type: 'XHR',
      response: {
        url: 'https://api.example.com/z',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
      },
    })
    transport.emit('Network.loadingFinished', { requestId: 'r3', timestamp: 10.1, encodedDataLength: 16 })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(transport.calls.some((c) => c.method === 'Network.getResponseBody')).toBe(false)
    expect(records.at(-1)?.responseBody).toBeNull()

    await capture.stop()
  })

  // An in-flight `getResponseBody` fetch that resolves AFTER stop() has
  // already unsubscribed/disabled the Network domain must not still surface
  // a record via `onRequest`.
  test('a getResponseBody that resolves after stop() emits nothing', async () => {
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

    const records: NetworkRequest[] = []
    const capture = createCdpCapture({ transport, onRequest: (r) => records.push(r) })

    await capture.start()
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
    // Triggers the mapper's fetchResponseBody call, which is now stuck awaiting bodyPromise.
    transport.emit('Network.loadingFinished', { requestId: 'r-late', timestamp: 10.1, encodedDataLength: 16 })

    const recordCountBeforeStop = records.length
    await capture.stop()

    // Resolve the in-flight body fetch only AFTER stop() has already resolved.
    resolveBody({ body: '{"late":true}', base64Encoded: false })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(records.length).toBe(recordCountBeforeStop)
    expect(records.some((r) => r.responseBody === '{"late":true}')).toBe(false)
  })
})
