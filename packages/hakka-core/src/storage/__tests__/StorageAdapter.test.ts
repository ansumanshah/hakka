import { describe, expect, test } from 'bun:test'

import { Hakka } from '../../index'
import type { StorageAdapter } from '../StorageAdapter'

// clearLogs() must propagate to a registered StorageAdapter so persisted data
// does not outlive an explicit "clear".
describe('StorageAdapter — clear on clearLogs', () => {
  test('clearLogs() invokes adapter.clear()', () => {
    let cleared = 0
    const adapter: StorageAdapter = {
      save() {},
      load() {
        return []
      },
      clear() {
        cleared++
      },
    }
    Hakka.setStorageAdapter(adapter)
    try {
      Hakka.clearLogs()
      expect(cleared).toBe(1)
    } finally {
      Hakka.setStorageAdapter(null)
    }
  })

  test('clearLogs() swallows a rejected async clear() without throwing', async () => {
    const adapter: StorageAdapter = {
      save() {},
      load() {
        return []
      },
      clear() {
        return Promise.reject(new Error('clear failed'))
      },
    }
    Hakka.setStorageAdapter(adapter)
    try {
      expect(() => Hakka.clearLogs()).not.toThrow()
      // Let the rejected promise settle — must not surface as an unhandled rejection.
      await Promise.resolve()
    } finally {
      Hakka.setStorageAdapter(null)
    }
  })

  test('clearLogs() is a no-op when no adapter is set', () => {
    Hakka.setStorageAdapter(null)
    expect(() => Hakka.clearLogs()).not.toThrow()
  })
})
