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
  Hakka.start({ mode: 'native' })
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
