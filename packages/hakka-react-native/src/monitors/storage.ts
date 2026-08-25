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

// Shared install state for `useAsyncStorageMonitor`/`useMMKVMonitor`, keyed
// by refcount rather than per-effect closures. Either hook can be mounted
// more than once at a time (nested providers, HMR remounts); a raw
// save/restore per effect instance has no way to tell "am I the only
// installer" — the second install's saved "originals" would actually be the
// first hook's already-patched wrapper (not the true original), and
// whichever instance unmounts first stomps the shared AsyncStorage/MMKV
// object's methods, silently breaking the other instance's monitoring.
// Tracking the true originals + a refcount at module scope means only the
// first mount patches and only the last unmount restores.
let asyncStorageRefCount = 0
let asyncStorageOriginals: {
  getItem: AsyncStorageLike['getItem']
  setItem: AsyncStorageLike['setItem']
  removeItem: AsyncStorageLike['removeItem']
  clear: AsyncStorageLike['clear']
} | null = null

const mmkvPatches = new Map<
  MMKVMonitorInstance,
  {
    refCount: number
    originals: {
      getString: MMKVMonitorInstance['getString']
      setString: MMKVMonitorInstance['setString']
      getNumber: MMKVMonitorInstance['getNumber']
      setNumber: MMKVMonitorInstance['setNumber']
      getBoolean: MMKVMonitorInstance['getBoolean']
      setBoolean: MMKVMonitorInstance['setBoolean']
      delete: MMKVMonitorInstance['delete']
    }
  }
>()

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
    let installedHere = false // this effect instance's own contribution to the shared refcount

    function install(): void {
      if (installedHere) return // this instance already installed

      let mod: ({ default?: AsyncStorageLike } & AsyncStorageLike) | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mod = require('@react-native-async-storage/async-storage')
      } catch {
        return // not installed
      }
      AsyncStorage = mod!.default ?? mod!
      installedHere = true

      if (asyncStorageRefCount === 0) {
        // First installer — patch and record the true originals.
        const storage = AsyncStorage

        asyncStorageOriginals = {
          getItem: storage.getItem,
          setItem: storage.setItem,
          removeItem: storage.removeItem,
          clear: storage.clear,
        }

        storage.getItem = async (key: string) => {
          const result = await asyncStorageOriginals!.getItem.call(storage, key)
          sendStorageData({
            storageType: 'AsyncStorage',
            key,
            value: result,
            operation: 'get',
            timestamp: Date.now(),
          })
          return result
        }

        storage.setItem = async (key: string, value: string) => {
          const result = await asyncStorageOriginals!.setItem.call(storage, key, value)
          sendStorageData({ storageType: 'AsyncStorage', key, value, operation: 'set', timestamp: Date.now() })
          return result
        }

        storage.removeItem = async (key: string) => {
          const result = await asyncStorageOriginals!.removeItem.call(storage, key)
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
          const result = await asyncStorageOriginals!.clear.call(storage)
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
      // Later installers reuse the already-patched storage — every call
      // above always routes through `asyncStorageOriginals`, the true
      // pre-patch functions, regardless of which mount happens to be first.
      asyncStorageRefCount++
    }

    function uninstall(): void {
      if (!installedHere || !AsyncStorage) return
      installedHere = false
      asyncStorageRefCount = Math.max(0, asyncStorageRefCount - 1)
      if (asyncStorageRefCount === 0 && asyncStorageOriginals) {
        AsyncStorage.getItem = asyncStorageOriginals.getItem
        AsyncStorage.setItem = asyncStorageOriginals.setItem
        AsyncStorage.removeItem = asyncStorageOriginals.removeItem
        AsyncStorage.clear = asyncStorageOriginals.clear
        asyncStorageOriginals = null
      }
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
    const storage: MMKVMonitorInstance = mmkv // narrowed once; nested closures below reuse this, not the optional param

    let installedHere = false // this effect instance's own contribution to the shared refcount

    function install(): void {
      if (installedHere) return // this instance already installed
      installedHere = true

      let entry = mmkvPatches.get(storage)
      if (!entry) {
        // First installer for this MMKV instance — patch and record the true originals.
        const originals = {
          getString: storage.getString,
          setString: storage.setString,
          getNumber: storage.getNumber,
          setNumber: storage.setNumber,
          getBoolean: storage.getBoolean,
          setBoolean: storage.setBoolean,
          delete: storage.delete,
        }
        entry = { refCount: 0, originals }
        mmkvPatches.set(storage, entry)

        storage.getString = (key: string) => {
          const result = originals.getString.call(storage, key)
          sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
          return result
        }

        storage.setString = (key: string, value: string) => {
          const result = originals.setString.call(storage, key, value)
          sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
          return result
        }

        storage.getNumber = (key: string) => {
          const result = originals.getNumber.call(storage, key)
          sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
          return result
        }

        storage.setNumber = (key: string, value: number) => {
          const result = originals.setNumber.call(storage, key, value)
          sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
          return result
        }

        storage.getBoolean = (key: string) => {
          const result = originals.getBoolean.call(storage, key)
          sendStorageData({ storageType: 'MMKV', key, value: result, operation: 'get', timestamp: Date.now() })
          return result
        }

        storage.setBoolean = (key: string, value: boolean) => {
          const result = originals.setBoolean.call(storage, key, value)
          sendStorageData({ storageType: 'MMKV', key, value, operation: 'set', timestamp: Date.now() })
          return result
        }

        storage.delete = (key: string) => {
          const result = originals.delete.call(storage, key)
          sendStorageData({ storageType: 'MMKV', key, value: null, operation: 'remove', timestamp: Date.now() })
          return result
        }
      }
      // Later installers for the same instance reuse the already-patched
      // methods — every wrapper above closes over `originals`, the true
      // pre-patch functions, regardless of which mount happens to be first.
      entry.refCount++
    }

    function uninstall(): void {
      if (!installedHere) return
      installedHere = false
      const entry = mmkvPatches.get(storage)
      if (!entry) return
      entry.refCount--
      if (entry.refCount <= 0) {
        storage.getString = entry.originals.getString
        storage.setString = entry.originals.setString
        storage.getNumber = entry.originals.getNumber
        storage.setNumber = entry.originals.setNumber
        storage.getBoolean = entry.originals.getBoolean
        storage.setBoolean = entry.originals.setBoolean
        storage.delete = entry.originals.delete
        mmkvPatches.delete(storage)
      }
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
