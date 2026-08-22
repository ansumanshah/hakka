/**
 * Storage monitoring hooks.
 *
 * Monkey-patch AsyncStorage / MMKV to forward every
 * read/write/delete operation to the Hakka desktop companion.
 *
 * All storage libraries are optional peer dependencies — the hooks
 * are no-ops when the library isn't installed.
 *
 * @example
 * ```tsx
 * import { useAsyncStorageMonitor } from 'hakka-react-native'
 *
 * function App() {
 *   useAsyncStorageMonitor()
 *   return <MyApp />
 * }
 * ```
 */
import { useEffect } from 'react'

import { hakkaBridge } from '../core/HakkaBridge'
import { redactStorageValue } from '../storage/redact'

export type StorageType = 'AsyncStorage' | 'MMKV' | 'Zustand' | 'Redux' | 'Context'

export interface StorageData {
  storageType: StorageType
  key: string
  value: unknown
  operation: 'get' | 'set' | 'remove' | 'clear'
  timestamp: number
}

interface AsyncStorageLike {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
  clear: () => Promise<void>
}

export interface MMKVMonitorInstance {
  getString: (key: string) => string | undefined
  setString: (key: string, value: string) => void
  getNumber: (key: string) => number | undefined
  setNumber: (key: string, value: number) => void
  getBoolean: (key: string) => boolean | undefined
  setBoolean: (key: string, value: boolean) => void
  delete: (key: string) => void
}

function sendStorageData(data: StorageData): void {
  hakkaBridge.emit('storage:update', { ...data, value: redactStorageValue(data.key, data.value) })
}

/**
 * Patch `@react-native-async-storage/async-storage` to forward
 * operations to the desktop app. Restores originals on cleanup.
 */
export function useAsyncStorageMonitor(): void {
  useEffect(() => {
    if (!hakkaBridge.isConnected) return

    let AsyncStorage: AsyncStorageLike
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@react-native-async-storage/async-storage') as {
        default?: AsyncStorageLike
      } & AsyncStorageLike
      AsyncStorage = mod.default ?? mod
    } catch {
      return // not installed
    }

    const originalGetItem = AsyncStorage.getItem
    const originalSetItem = AsyncStorage.setItem
    const originalRemoveItem = AsyncStorage.removeItem
    const originalClear = AsyncStorage.clear

    AsyncStorage.getItem = async (key: string) => {
      const result = await originalGetItem.call(AsyncStorage, key)
      sendStorageData({ storageType: 'AsyncStorage', key, value: result, operation: 'get', timestamp: Date.now() })
      return result
    }

    AsyncStorage.setItem = async (key: string, value: string) => {
      const result = await originalSetItem.call(AsyncStorage, key, value)
      sendStorageData({ storageType: 'AsyncStorage', key, value, operation: 'set', timestamp: Date.now() })
      return result
    }

    AsyncStorage.removeItem = async (key: string) => {
      const result = await originalRemoveItem.call(AsyncStorage, key)
      sendStorageData({ storageType: 'AsyncStorage', key, value: null, operation: 'remove', timestamp: Date.now() })
      return result
    }

    AsyncStorage.clear = async () => {
      const result = await originalClear.call(AsyncStorage)
      sendStorageData({ storageType: 'AsyncStorage', key: '*', value: null, operation: 'clear', timestamp: Date.now() })
      return result
    }

    return () => {
      AsyncStorage.getItem = originalGetItem
      AsyncStorage.setItem = originalSetItem
      AsyncStorage.removeItem = originalRemoveItem
      AsyncStorage.clear = originalClear
    }
  }, [])
}

/**
 * Patch an MMKV instance to forward operations to the desktop app.
 * Pass your `MMKV` instance — if omitted the hook is a no-op.
 */
export function useMMKVMonitor(mmkv?: MMKVMonitorInstance): void {
  useEffect(() => {
    if (!hakkaBridge.isConnected || !mmkv) return

    const originalGetString = mmkv.getString
    const originalSetString = mmkv.setString
    const originalGetNumber = mmkv.getNumber
    const originalSetNumber = mmkv.setNumber
    const originalGetBoolean = mmkv.getBoolean
    const originalSetBoolean = mmkv.setBoolean
    const originalDelete = mmkv.delete

    mmkv.getString = (key: string) => {
      const result = originalGetString.call(mmkv, key)
      sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
      return result
    }

    mmkv.setString = (key: string, value: string) => {
      const result = originalSetString.call(mmkv, key, value)
      sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
      return result
    }

    mmkv.getNumber = (key: string) => {
      const result = originalGetNumber.call(mmkv, key)
      sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
      return result
    }

    mmkv.setNumber = (key: string, value: number) => {
      const result = originalSetNumber.call(mmkv, key, value)
      sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
      return result
    }

    mmkv.getBoolean = (key: string) => {
      const result = originalGetBoolean.call(mmkv, key)
      sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
      return result
    }

    mmkv.setBoolean = (key: string, value: boolean) => {
      const result = originalSetBoolean.call(mmkv, key, value)
      sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
      return result
    }

    mmkv.delete = (key: string) => {
      const result = originalDelete.call(mmkv, key)
      sendStorageData({ storageType: 'MMKV', key, value: null, operation: 'remove', timestamp: Date.now() })
      return result
    }

    return () => {
      mmkv.getString = originalGetString
      mmkv.setString = originalSetString
      mmkv.getNumber = originalGetNumber
      mmkv.setNumber = originalSetNumber
      mmkv.getBoolean = originalGetBoolean
      mmkv.setBoolean = originalSetBoolean
      mmkv.delete = originalDelete
    }
  }, [mmkv])
}
