import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Hakka } from '../../index'
import type { NativeCaptureAdapter, NativeHakkaModule } from '../../index'
import type { NetworkRequest } from '../../model/types'
import type { StorageAdapter } from '../../storage/StorageAdapter'

// A no-op native module/adapter lets the engine reach running=true in Bun, which
// lacks XMLHttpRequest (so JS capture mode can't be started here). Requests are
// then fed through the public Hakka.ingest() to exercise the persistence path.
function fakeNativeAdapter(): NativeCaptureAdapter {
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
  return {
    getModule: () => module,
    createEventEmitter: () => ({ addListener: () => ({ remove() {} }) }),
  }
}

function countingAdapter() {
  const state = { saves: 0, lastLen: 0, cleared: 0 }
  const adapter: StorageAdapter = {
    save(records) {
      state.saves++
      state.lastLen = records.length
    },
    load() {
      return []
    },
    clear() {
      state.cleared++
    },
  }
  return { adapter, state }
}

function req(id: string): NetworkRequest {
  return { id, url: `https://example.com/${id}`, method: 'GET', startTime: Date.now() }
}

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  Hakka.registerNativeAdapter(fakeNativeAdapter())
  Hakka.start({ mode: 'native', maxRequests: 500 })
  Hakka.clearLogs()
})

afterEach(() => {
  Hakka.stop()
  Hakka.setStorageAdapter(null)
  Hakka.registerNativeAdapter(null)
  Hakka.clearLogs()
})

describe('persistence — coalesced adapter writes', () => {
  test('a burst of ingests produces a single save(), not one per request', async () => {
    const { adapter, state } = countingAdapter()
    Hakka.setStorageAdapter(adapter)

    Hakka.ingest(req('a'))
    Hakka.ingest(req('b'))
    Hakka.ingest(req('c'))

    expect(state.saves).toBe(0) // debounced — nothing written synchronously
    await tick(80)
    expect(state.saves).toBe(1) // one coalesced write...
    expect(state.lastLen).toBe(3) // ...covering all three records
  })

  test('stop() flushes the pending coalesced write immediately', () => {
    const { adapter, state } = countingAdapter()
    Hakka.setStorageAdapter(adapter)

    Hakka.ingest(req('a'))
    expect(state.saves).toBe(0)
    Hakka.stop()
    expect(state.saves).toBe(1)
    expect(state.lastLen).toBe(1)
  })

  test('clearLogs() cancels a pending write and clears persisted storage', async () => {
    const { adapter, state } = countingAdapter()
    Hakka.setStorageAdapter(adapter)

    Hakka.ingest(req('a'))
    Hakka.clearLogs()
    await tick(80)

    expect(state.saves).toBe(0) // pending write was cancelled
    expect(state.cleared).toBeGreaterThanOrEqual(1)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('persistence — lifecycle and late updates', () => {
  test('clearLogs() invalidates an in-flight hydration', async () => {
    Hakka.stop()
    const load = deferred<NetworkRequest[]>()
    Hakka.setStorageAdapter({ save() {}, load: () => load.promise, clear() {} })
    Hakka.start({ mode: 'store' })
    Hakka.clearLogs()
    load.resolve([req('old')])
    await tick(0)
    expect(Hakka.getLogs()).toEqual([])
  })

  test('a restarted capture ignores the previous load', async () => {
    Hakka.stop()
    const first = deferred<NetworkRequest[]>()
    const second = deferred<NetworkRequest[]>()
    let loads = 0
    Hakka.setStorageAdapter({ save() {}, load: () => (++loads === 1 ? first.promise : second.promise), clear() {} })
    Hakka.start({ mode: 'store' })
    Hakka.stop()
    Hakka.start()
    first.resolve([req('stale')])
    second.resolve([req('current')])
    await tick(0)
    expect(Hakka.getLogs().map((record) => record.id)).toEqual(['current'])
  })

  test('replacing the adapter discards its pending hydration and coalesced save', async () => {
    Hakka.stop()
    const load = deferred<NetworkRequest[]>()
    const replacement = countingAdapter()
    Hakka.setStorageAdapter({ save() {}, load: () => load.promise, clear() {} })
    Hakka.start({ mode: 'store' })
    Hakka.ingest(req('live'))
    Hakka.setStorageAdapter(replacement.adapter)
    load.resolve([req('stale')])
    await tick(80)
    expect(Hakka.getLogs().map((record) => record.id)).toEqual(['live'])
    expect(replacement.state.saves).toBe(0)
  })

  test('a coalesced save reads the current buffer after reconfiguration', async () => {
    let saved: NetworkRequest[] = []
    Hakka.setStorageAdapter({
      save: (records) => {
        saved = records
      },
      load: () => [],
      clear() {},
    })
    Hakka.ingest(req('a'))
    Hakka.configure({ maxRequests: 3 })
    Hakka.ingest(req('b'))
    await tick(80)
    expect(saved.map((record) => record.id)).toEqual(['b', 'a'])
  })

  test('hydration uses the current buffer and capacity after reconfiguration', async () => {
    Hakka.stop()
    const load = deferred<NetworkRequest[]>()
    Hakka.setStorageAdapter({ save() {}, load: () => load.promise, clear() {} })
    Hakka.start({ mode: 'store', maxRequests: 3 })
    Hakka.configure({ maxRequests: 1 })
    Hakka.ingest(req('live'))
    load.resolve([req('old')])
    await tick(0)
    expect(Hakka.getLogs().map((record) => record.id)).toEqual(['live'])
  })

  test('update() persists details arriving after the initial save', async () => {
    let saved: NetworkRequest[] = []
    Hakka.setStorageAdapter({
      save: (records) => {
        saved = records
      },
      load: () => [],
      clear() {},
    })
    Hakka.ingest(req('a'))
    await tick(80)
    expect(Hakka.update({ id: 'a', responseBody: 'late body' })).toBe(true)
    await tick(80)
    expect(saved[0]?.responseBody).toBe('late body')
  })

  test('clear waits for an in-flight save and later saves wait for clear', async () => {
    const save = deferred<void>()
    const clear = deferred<void>()
    let saved: NetworkRequest[] = []
    const calls: string[] = []
    Hakka.setStorageAdapter({
      save(records) {
        calls.push('save')
        if (calls.length === 1)
          return save.promise.then(() => {
            saved = records
          })
        saved = records
      },
      load: () => [],
      clear() {
        calls.push('clear')
        return clear.promise.then(() => {
          saved = []
        })
      },
    })
    Hakka.ingest(req('old'))
    await tick(80)
    Hakka.clearLogs()
    Hakka.ingest(req('new'))
    await tick(80)
    expect(calls).toEqual(['save'])
    save.resolve()
    await tick(0)
    expect(calls).toEqual(['save', 'clear'])
    clear.resolve()
    await tick(0)
    expect(calls).toEqual(['save', 'clear', 'save'])
    expect(saved.map((record) => record.id)).toEqual(['new'])
  })

  test('restart hydration waits for the last save to finish', async () => {
    Hakka.stop()
    const save = deferred<void>()
    let saved: NetworkRequest[] = [req('stale')]
    let loads = 0
    Hakka.setStorageAdapter({
      save: (records) =>
        save.promise.then(() => {
          saved = records
        }),
      load() {
        loads += 1
        return saved
      },
      clear() {
        saved = []
      },
    })
    Hakka.start({ mode: 'store' })
    await tick(0)
    Hakka.ingest(req('live'))
    Hakka.stop()
    Hakka.start()
    expect(loads).toBe(1)
    save.resolve()
    await tick(0)
    expect(loads).toBe(2)
    expect(Hakka.getLogs().map((record) => record.id)).toEqual(['live', 'stale'])
  })

  test('a rejected async save still allows a queued clear to complete', async () => {
    let clears = 0
    Hakka.setStorageAdapter({
      save: () => Promise.reject(new Error('save failed')),
      load: () => [],
      clear() {
        clears += 1
      },
    })
    Hakka.ingest(req('a'))
    Hakka.stop()
    Hakka.clearLogs()
    await tick(0)
    expect(clears).toBe(1)
  })

  test('adapter failures do not crash capture or prevent a subsequent clear', async () => {
    const failed = deferred<void>()
    let clears = 0
    Hakka.setStorageAdapter({
      save() {
        throw new Error('save failed')
      },
      load: () => [],
      clear() {
        clears += 1
        if (clears === 1) throw new Error('clear failed')
        return failed.promise
      },
    })
    Hakka.ingest(req('a'))
    expect(() => Hakka.stop()).not.toThrow()
    expect(() => Hakka.clearLogs()).not.toThrow()
    expect(() => Hakka.clearLogs()).not.toThrow()
    failed.resolve()
    await tick(0)
    expect(clears).toBe(2)
  })
})
