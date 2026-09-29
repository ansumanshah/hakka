/**
 * Tests for start() re-applying settings persisted by the Settings tab, so a
 * developer's previous toggles take effect even when the overlay is never opened.
 */
import { getBodyRedactionFields } from 'hakka-core'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { start, destroy, isConsoleMirrorEnabled, saveUiState } from '../index'
import { hasStore, store } from '../worker'

function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? (store[key] as string) : null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

const lsMock = makeLocalStorageMock()

// Capture-only options keep start() lightweight and deterministic.
const QUIET = { overlay: false as const, resourceTiming: false, captureBeacons: false, console: false }

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
})

afterEach(() => {
  destroy()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('start() — settings rehydration', () => {
  it('enables the console mirror from a persisted logToConsole', () => {
    saveUiState({ logToConsole: true })
    start(QUIET)
    expect(isConsoleMirrorEnabled()).toBe(true)
  })

  it('leaves the console mirror off when nothing is persisted and nothing is passed', () => {
    start(QUIET)
    expect(isConsoleMirrorEnabled()).toBe(false)
  })

  it('lets an explicit logToConsole:false override a persisted true', () => {
    saveUiState({ logToConsole: true })
    start({ ...QUIET, logToConsole: false })
    expect(isConsoleMirrorEnabled()).toBe(false)
  })

  it('honours an explicit logToConsole:true even with nothing persisted', () => {
    start({ ...QUIET, logToConsole: true })
    expect(isConsoleMirrorEnabled()).toBe(true)
  })
})

describe('start() — capture lifecycle', () => {
  it('applies the configured retained body budget to the browser store', async () => {
    start({ ...QUIET, maxBufferBytes: 4 })
    const record = {
      url: 'https://budget.test',
      method: 'POST' as const,
      startTime: Date.now(),
      source: 'fetch' as const,
      requestBody: 'abcd',
      requestBodySize: 4,
    }
    store().ingest({ ...record, id: 'first' })
    store().ingest({ ...record, id: 'second' })
    expect((await store().getSnapshot()).map((r) => r.id)).toEqual(['second'])
  })

  it('does not initialize capture or UI when disabled, and can start afterward', () => {
    const originalFetch = fetch
    const originalXHR = XMLHttpRequest.prototype.send
    const originalWebSocket = WebSocket
    start({ enabled: false })
    expect(fetch).toBe(originalFetch)
    expect(XMLHttpRequest.prototype.send).toBe(originalXHR)
    expect(WebSocket).toBe(originalWebSocket)
    expect(hasStore()).toBe(false)
    expect(document.querySelector('[aria-label="Open Hakka inspector"]')).toBeNull()
    start(QUIET)
    expect(hasStore()).toBe(true)
    expect(fetch).not.toBe(originalFetch)
  })

  it('honors explicit empty redaction fields over persisted fields and resets on restart', () => {
    saveUiState({ redactBodyFields: ['token'] })
    start({ ...QUIET, redactBodyFields: [] })
    expect(getBodyRedactionFields()).toEqual([])
    destroy()
    start({ ...QUIET, redactBodyFields: ['password'] })
    expect(getBodyRedactionFields()).toEqual(['password'])
    destroy()
    lsMock.clear()
    start(QUIET)
    expect(getBodyRedactionFields()).toEqual([])
  })

  it('does not inherit trace propagation from a previous capture session', async () => {
    const original = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
    vi.stubGlobal('fetch', original)
    start({ ...QUIET, trace: { propagateOrigins: ['https://trace.test'] } })
    await fetch('https://trace.test/api')
    expect(new Headers(original.mock.calls[0]![1]?.headers).has('x-hakka-trace')).toBe(true)
    destroy()
    start(QUIET)
    await fetch('https://trace.test/api')
    expect(new Headers(original.mock.calls[1]![1]?.headers).has('x-hakka-trace')).toBe(false)
  })

  it('stops forwarding messages from already-created workers on destroy', () => {
    const workers: FakeWorker[] = []
    class FakeWorker extends EventTarget {
      onmessage = null
      onerror = null
      postMessage = vi.fn()
      constructor(_url: string | URL, _options?: WorkerOptions) {
        super()
        workers.push(this)
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    start({ ...QUIET, captureWorkers: true })
    const worker = new Worker('data.js')
    const data = { __hakka_worker_record: { id: 'worker-1', url: 'https://x.test', method: 'GET', startTime: 1 } }
    worker.dispatchEvent(new MessageEvent('message', { data }))
    expect(workers[0]!.postMessage.mock.calls.some(([msg]) => msg.type === 'ingest')).toBe(true)
    destroy()
    start(QUIET)
    worker.dispatchEvent(new MessageEvent('message', { data }))
    expect(workers.at(-1)!.postMessage.mock.calls.some(([msg]) => msg.type === 'ingest')).toBe(false)
  })
})
