/**
 * storeClient — the Worker backend's own error/teardown handling.
 *
 * Exercises `createWorkerClient` directly (exported for exactly this) against
 * a hand-rolled `FakeWorker` rather than through `createStoreClient`/the real
 * `StoreWorker` — happy-dom has no real `Worker`/blob-URL support, and every
 * other test in this package (`store.test.ts`, `storeEngine.bridge.test.ts`)
 * forces the in-process backend for that reason. `FakeWorker` implements only
 * the `postMessage`/`terminate`/`onmessage`/`onerror` surface `storeClient.ts`
 * actually touches.
 */
import type { NetworkRequest } from 'hakka-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MainToWorker } from '../protocol'
import { createWorkerClient } from '../storeClient'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: { 'content-type': 'application/json' },
    source: 'fetch',
    ...over,
  } as NetworkRequest
}

class FakeWorker {
  posted: MainToWorker[] = []
  terminated = false
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null

  postMessage(msg: MainToWorker): void {
    this.posted.push(msg)
  }

  terminate(): void {
    this.terminated = true
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createWorkerClient — worker.onerror (async post-construction failure)', () => {
  it('settles every in-flight RPC with a safe, type-correct fallback instead of hanging forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const worker = new FakeWorker()
    const client = createWorkerClient(worker as unknown as Worker, {})

    const snapshot = client.getSnapshot()
    const body = client.getBody('req-1')
    const bodies = client.getBodies(['req-1'])
    const har = client.exportHar()
    const ids = client.matchIds({ tokens: [] })
    const spans = client.getSpansForTrace!('trace-1')

    // No 'result' message ever arrives — the worker script failed to load.
    worker.onerror!(new ErrorEvent('error', { message: 'blob URL blocked by CSP' }))

    await expect(snapshot).resolves.toEqual([])
    await expect(body).resolves.toBeNull()
    await expect(bodies).resolves.toEqual(new Map())
    await expect(har).resolves.toBe('')
    await expect(ids).resolves.toEqual([])
    await expect(spans).resolves.toEqual([])
  })

  it('terminates the dead worker and reports it, exactly once even if onerror fires twice', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const worker = new FakeWorker()
    createWorkerClient(worker as unknown as Worker, {})

    worker.onerror!(new ErrorEvent('error', { message: 'first' }))
    worker.onerror!(new ErrorEvent('error', { message: 'second' }))

    expect(worker.terminated).toBe(true)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('an RPC issued after the failure resolves immediately with its fallback, not a fresh hang', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const worker = new FakeWorker()
    const client = createWorkerClient(worker as unknown as Worker, {})

    worker.onerror!(new ErrorEvent('error', { message: 'blob URL blocked by CSP' }))
    const postedBeforeLateCall = worker.posted.length

    await expect(client.getSnapshot()).resolves.toEqual([])
    // Confirms the fallback, not luck: nothing new was even posted to the
    // (now-dead) worker for this call.
    expect(worker.posted.length).toBe(postedBeforeLateCall)
  })

  it('fire-and-forget calls (ingest/update) made after the failure are silently dropped, not thrown', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const worker = new FakeWorker()
    const client = createWorkerClient(worker as unknown as Worker, {})

    worker.onerror!(new ErrorEvent('error', { message: 'blob URL blocked by CSP' }))
    const postedBeforeLateCall = worker.posted.length

    expect(() => client.ingest(req({ id: 'x' }))).not.toThrow()
    expect(worker.posted.length).toBe(postedBeforeLateCall)
  })
})

describe('createWorkerClient — destroy()', () => {
  it('settles every in-flight RPC with its fallback before terminating, instead of hanging forever', async () => {
    const worker = new FakeWorker()
    const client = createWorkerClient(worker as unknown as Worker, {})

    const body = client.getBody('req-1')
    const snapshot = client.getSnapshot()

    client.destroy()

    await expect(body).resolves.toBeNull()
    await expect(snapshot).resolves.toEqual([])
    expect(worker.terminated).toBe(true)
  })
})
