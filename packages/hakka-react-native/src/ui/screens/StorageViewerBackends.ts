/**
 * StorageViewerBackends — optional AsyncStorage / MMKV module lookup for
 * StorageViewer. Gracefully handles either dependency being absent.
 */
export let AsyncStorageModule: {
  getAllKeys: () => Promise<string[]>
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
  multiGet: (keys: string[]) => Promise<Array<[string, string | null]>>
} | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AS = require('@react-native-async-storage/async-storage')
  AsyncStorageModule = AS.default ?? AS
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native')
    if (RN.AsyncStorage) {
      AsyncStorageModule = RN.AsyncStorage
    }
  } catch {
    AsyncStorageModule = null
  }
}

export interface MMKVInstance {
  getAllKeys: () => string[]
  getString: (key: string) => string | undefined
  set: (key: string, value: string) => void
  delete: (key: string) => void
}

export let MMKVModule: { MMKV: new () => MMKVInstance } | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('react-native-mmkv')
  MMKVModule = mod.default ?? mod
} catch {
  MMKVModule = null
}
