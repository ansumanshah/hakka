import { afterEach, describe, expect, test } from 'bun:test'

import { Hakka } from '../../index'
import type { HakkaPlugin, NativeCaptureAdapter, NativeHakkaModule } from '../../index'
import type { NetworkRequest } from '../../model/types'
import type { StorageAdapter } from '../../storage/StorageAdapter'

function fakeNative() {
  const calls = { pause: 0, resume: 0 }
  const module: NativeHakkaModule = {
    showUI() {},
    clearLogs() {},
    setSensitiveHeaders() {},
    setIgnoredHosts() {},
    setIgnoredPatterns() {},
    initialize: async () => {},
    getLogs: async () => [],
    addListener() {},
    removeListeners() {},
  }
  const adapter: NativeCaptureAdapter = {
    getModule: () => module,
    createEventEmitter: () => ({ addListener: () => ({ remove() {} }) }),
    pause: () => {
      calls.pause++
    },
    resume: () => {
      calls.resume++
    },
  }
  return { adapter, calls }
}

function req(id: string): NetworkRequest {
  return { id, url: `https://example.com/${id}`, method: 'GET', startTime: Date.now() }
}

afterEach(() => {
  Hakka.stop()
  Hakka.setStorageAdapter(null)
  Hakka.registerNativeAdapter(null)
  Hakka.clearLogs()
})

describe('engine — plugin registration', () => {
  test('use() is idempotent: a plugin registered twice sets up once', () => {
    Hakka.registerNativeAdapter(fakeNative().adapter)
    let setups = 0
    let teardowns = 0
    const plugin: HakkaPlugin = {
      id: `dedup-${Math.random()}`,
      setup: () => {
        setups++
        return () => {
          teardowns++
        }
      },
    }
    Hakka.use(plugin)
    Hakka.use(plugin)
    Hakka.start({ mode: 'native' })
    expect(setups).toBe(1)
    Hakka.stop()
    expect(teardowns).toBe(1)
  })
})

describe('engine — pause/resume lifecycle', () => {
  test('stop() resumes the native engine if stopped while paused', () => {
    const { adapter, calls } = fakeNative()
    Hakka.registerNativeAdapter(adapter)
    Hakka.start({ mode: 'native' })
    Hakka.pause()
    expect(calls.pause).toBe(1)
    Hakka.stop()
    expect(calls.resume).toBe(1)
  })

  test('clearLogs() drops paused-buffered requests so they do not reappear on resume', () => {
    Hakka.registerNativeAdapter(fakeNative().adapter)
    Hakka.start({ mode: 'native' })
    Hakka.pause()
    Hakka.ingest(req('buffered'))
    Hakka.clearLogs()
    Hakka.resume()
    expect(Hakka.getLogCount()).toBe(0)
  })
})

describe('engine — hydration race', () => {
  test('hydration does not evict live requests captured during async load()', async () => {
    // Historical set larger than any ring capacity, returned after a delay.
    const historical = Array.from({ length: 600 }, (_, i) => req(`hist-${i}`))
    const adapter: StorageAdapter = {
      save() {},
      clear() {},
      load: () => new Promise((resolve) => setTimeout(() => resolve(historical), 30)),
    }
    Hakka.registerNativeAdapter(fakeNative().adapter)
    Hakka.setStorageAdapter(adapter)
    Hakka.start({ mode: 'native' }) // fires hydrateFromAdapter (async)

    for (let i = 0; i < 20; i++) Hakka.ingest(req(`live-${i}`)) // live, before load() resolves
    await new Promise((resolve) => setTimeout(resolve, 60)) // let hydration finish

    const logs = Hakka.getLogs()
    const liveSurvivors = logs.filter((r) => r.id.startsWith('live-')).length
    expect(liveSurvivors).toBe(20) // every live request survived
  })
})

describe('engine — hydration boundary', () => {
  test('ingesting 600 records with maxRequests:500 keeps the newest 500 and evicts the oldest 100', () => {
    Hakka.start({ mode: 'store', maxRequests: 500 })

    // Ingest 600 records in order: r-0 (oldest) … r-599 (newest)
    for (let i = 0; i < 600; i++) Hakka.ingest(req(`r-${i}`))

    const logs = Hakka.getLogs()
    expect(logs.length).toBe(500)

    // getLogs() returns newest-first; the newest is r-599
    const ids = logs.map((r) => r.id)
    expect(ids[0]).toBe('r-599')
    expect(ids[ids.length - 1]).toBe('r-100') // r-0 … r-99 evicted; r-100 is the oldest survivor

    // None of the oldest 100 should be present
    for (let i = 0; i < 100; i++) {
      expect(ids.includes(`r-${i}`)).toBe(false)
    }
    // All of the newest 500 should be present
    for (let i = 100; i < 600; i++) {
      expect(ids.includes(`r-${i}`)).toBe(true)
    }
  })
})

describe("engine — mode: 'store' (pure aggregator, no interceptors)", () => {
  test('runs without interceptors yet ingests, dedups, and dispatches via the full pipeline', () => {
    Hakka.start({ mode: 'store', maxRequests: 50 })
    expect(Hakka.isActive).toBe(true)

    const seen: NetworkRequest[] = []
    const off = Hakka.onRequest((r) => seen.push(r))

    Hakka.ingest(req('a'))
    Hakka.ingest(req('b'))
    expect(Hakka.getLogs().map((r) => r.id)).toEqual(['b', 'a']) // newest-first

    // update() enriches an existing record in place (the resourceTiming path)
    expect(Hakka.update({ id: 'a', status: 200 })).toBe(true)
    expect(Hakka.getLog('a')?.status).toBe(200)
    expect(Hakka.update({ id: 'missing', status: 200 })).toBe(false)

    off()
    expect(seen.length).toBeGreaterThanOrEqual(2) // dispatch fired for ingests + update
  })

  test('respects maxRequests ring capacity in store mode', () => {
    Hakka.start({ mode: 'store', maxRequests: 3 })
    for (const id of ['a', 'b', 'c', 'd', 'e']) Hakka.ingest(req(id))
    expect(Hakka.getLogs().map((r) => r.id)).toEqual(['e', 'd', 'c'])
  })
})
