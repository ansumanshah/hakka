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

// Sequence for synthesizing LogEntry ids — see sendStorageData below.
let storageLogSeq = 0

/**
 * Forward one storage operation as a canonical `{type:'console', payload: LogEntry[]}`
 * frame via `hakkaBridge.sendConsole` — matches `HakkaBridge.ts`'s own console routing.
 * There is no 'storage:update' branch in the wire protocol (`parseBridgeMessage` in
 * `packages/hakka-bridge/src/protocol.ts`), so emitting that type directly is silently
 * dropped by the bridge hub; `LogEntry.metadata` carries the structured operation detail.
 */
function sendStorageData(data: StorageData): void {
  hakkaBridge.sendConsole([
    {
      id: `storage_${++storageLogSeq}_${data.timestamp}`,
      timestamp: data.timestamp,
      level: 'info',
      message: `${data.storageType} ${data.operation} ${data.key}`,
      category: 'storage',
      metadata: {
        storageType: data.storageType,
        key: data.key,
        value: redactStorageValue(data.key, data.value),
        operation: data.operation,
      },
    },
  ])
}

/**
 * Patch `@react-native-async-storage/async-storage` to forward
 * operations to the desktop app. Restores originals on cleanup.
 */
export function useAsyncStorageMonitor(): void {
  useEffect(() => {
    let AsyncStorage: AsyncStorageLike | null = null
    let originals: {
      getItem: AsyncStorageLike['getItem']
      setItem: AsyncStorageLike['setItem']
      removeItem: AsyncStorageLike['removeItem']
      clear: AsyncStorageLike['clear']
    } | null = null

    function install(): void {
      if (originals) return // already installed

      let mod: ({ default?: AsyncStorageLike } & AsyncStorageLike) | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mod = require('@react-native-async-storage/async-storage')
      } catch {
        return // not installed
      }
      AsyncStorage = mod!.default ?? mod!
      const storage = AsyncStorage

      originals = {
        getItem: storage.getItem,
        setItem: storage.setItem,
        removeItem: storage.removeItem,
        clear: storage.clear,
      }

      storage.getItem = async (key: string) => {
        const result = await originals!.getItem.call(storage, key)
        sendStorageData({ storageType: 'AsyncStorage', key, value: result, operation: 'get', timestamp: Date.now() })
        return result
      }

      storage.setItem = async (key: string, value: string) => {
        const result = await originals!.setItem.call(storage, key, value)
        sendStorageData({ storageType: 'AsyncStorage', key, value, operation: 'set', timestamp: Date.now() })
        return result
      }

      storage.removeItem = async (key: string) => {
        const result = await originals!.removeItem.call(storage, key)
        sendStorageData({
          storageType: 'AsyncStorage',
          key,
          value: null,
          operation: 'remove',
          timestamp: Date.now(),
        })
        return result
      }

      storage.clear = async () => {
        const result = await originals!.clear.call(storage)
        sendStorageData({
          storageType: 'AsyncStorage',
          key: '*',
          value: null,
          operation: 'clear',
          timestamp: Date.now(),
        })
        return result
      }
    }

    function uninstall(): void {
      if (!originals || !AsyncStorage) return
      AsyncStorage.getItem = originals.getItem
      AsyncStorage.setItem = originals.setItem
      AsyncStorage.removeItem = originals.removeItem
      AsyncStorage.clear = originals.clear
      originals = null
    }

    // `hakkaBridge.connect()` typically resolves after this effect has already
    // run (see e.g. `SettingsViewModel`'s `loadSettings().then(() => connect())`),
    // so a one-time `isConnected` check at mount misses the connection entirely
    // and the patch never installs. Subscribing to `onStatus` re-checks on every
    // transition, including a later connect.
    const unsubscribeStatus = hakkaBridge.onStatus(() => {
      if (hakkaBridge.isConnected) install()
      else uninstall()
    })

    return () => {
      unsubscribeStatus()
      uninstall()
    }
  }, [])
}

/**
 * Patch an MMKV instance to forward operations to the desktop app.
 * Pass your `MMKV` instance — if omitted the hook is a no-op.
 */
export function useMMKVMonitor(mmkv?: MMKVMonitorInstance): void {
  useEffect(() => {
    if (!mmkv) return

    let installed = false
    let originals: {
      getString: MMKVMonitorInstance['getString']
      setString: MMKVMonitorInstance['setString']
      getNumber: MMKVMonitorInstance['getNumber']
      setNumber: MMKVMonitorInstance['setNumber']
      getBoolean: MMKVMonitorInstance['getBoolean']
      setBoolean: MMKVMonitorInstance['setBoolean']
      delete: MMKVMonitorInstance['delete']
    } | null = null

    function install(): void {
      if (installed) return
      installed = true

      originals = {
        getString: mmkv!.getString,
        setString: mmkv!.setString,
        getNumber: mmkv!.getNumber,
        setNumber: mmkv!.setNumber,
        getBoolean: mmkv!.getBoolean,
        setBoolean: mmkv!.setBoolean,
        delete: mmkv!.delete,
      }

      mmkv!.getString = (key: string) => {
        const result = originals!.getString.call(mmkv, key)
        sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
        return result
      }

      mmkv!.setString = (key: string, value: string) => {
        const result = originals!.setString.call(mmkv, key, value)
        sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
        return result
      }

      mmkv!.getNumber = (key: string) => {
        const result = originals!.getNumber.call(mmkv, key)
        sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
        return result
      }

      mmkv!.setNumber = (key: string, value: number) => {
        const result = originals!.setNumber.call(mmkv, key, value)
        sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
        return result
      }

      mmkv!.getBoolean = (key: string) => {
        const result = originals!.getBoolean.call(mmkv, key)
        sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
        return result
      }

      mmkv!.setBoolean = (key: string, value: boolean) => {
        const result = originals!.setBoolean.call(mmkv, key, value)
        sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
        return result
      }

      mmkv!.delete = (key: string) => {
        const result = originals!.delete.call(mmkv, key)
        sendStorageData({ storageType: 'MMKV', key, value: null, operation: 'remove', timestamp: Date.now() })
        return result
      }
    }

    function uninstall(): void {
      if (!installed || !originals) return
      mmkv!.getString = originals.getString
      mmkv!.setString = originals.setString
      mmkv!.getNumber = originals.getNumber
      mmkv!.setNumber = originals.setNumber
      mmkv!.getBoolean = originals.getBoolean
      mmkv!.setBoolean = originals.setBoolean
      mmkv!.delete = originals.delete
      installed = false
      originals = null
    }

    // Same connect-after-mount race as `useAsyncStorageMonitor` above — re-check
    // on every status transition instead of only once at mount.
    const unsubscribeStatus = hakkaBridge.onStatus(() => {
      if (hakkaBridge.isConnected) install()
      else uninstall()
    })

    return () => {
      unsubscribeStatus()
      uninstall()
    }
  }, [mmkv])
}
