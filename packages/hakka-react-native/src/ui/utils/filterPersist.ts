/**
 * Saved and recent filter persistence for the RN inspector.
 * Mirrors packages/hakka-browser/src/ui/persist.ts semantics: savedFilters
 * are named snapshots, recentFilters is a ring buffer of the last N.
 * Persists to AsyncStorage (peer dep) under 'hakka:rn:filter-state'; falls
 * back to in-memory (session-only) when AsyncStorage is unavailable.
 */

export interface FilterSnapshot {
  query: string
  methodFilters: string[]
  statusGroup: string
  sortBy: string
  sortDir: string
  groupBy: string
}

export interface SavedFilter {
  name: string
  snapshot: FilterSnapshot
}

let AsyncStorageModule: {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
} | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AS = require('@react-native-async-storage/async-storage')
  AsyncStorageModule = AS.default ?? AS
} catch {
  AsyncStorageModule = null
}

const STORAGE_KEY = 'hakka:rn:filter-state'
const MAX_RECENT = 8

interface PersistedState {
  savedFilters: SavedFilter[]
  recentFilters: FilterSnapshot[]
}

// Seeded synchronously; populated from AsyncStorage once load() resolves.
let memState: PersistedState = {
  savedFilters: [],
  recentFilters: [],
}

let loaded = false
const onLoadCallbacks: Array<() => void> = []

async function load(): Promise<void> {
  if (loaded) return
  loaded = true
  if (!AsyncStorageModule) return
  try {
    const raw = await AsyncStorageModule.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>
      memState = {
        savedFilters: parsed.savedFilters ?? [],
        recentFilters: parsed.recentFilters ?? [],
      }
    }
  } catch {
    // Corrupt storage — ignore
  }
  onLoadCallbacks.forEach((cb) => cb())
  onLoadCallbacks.length = 0
}

function persist(): void {
  if (!AsyncStorageModule) return
  const raw = JSON.stringify(memState)
  void AsyncStorageModule.setItem(STORAGE_KEY, raw)
}

/** Loads from AsyncStorage and calls `onReady` once done. Idempotent. */
export function initFilterPersist(onReady?: () => void): void {
  if (loaded) {
    onReady?.()
    return
  }
  if (onReady) onLoadCallbacks.push(onReady)
  void load()
}

export function getSavedFilters(): SavedFilter[] {
  return memState.savedFilters
}

export function getRecentFilters(): FilterSnapshot[] {
  return memState.recentFilters
}

/** Replaces any existing entry with the same name. */
export function addSavedFilter(name: string, snapshot: FilterSnapshot): void {
  memState = {
    ...memState,
    savedFilters: [...memState.savedFilters.filter((f) => f.name !== name), { name, snapshot }],
  }
  persist()
}

export function removeSavedFilter(name: string): void {
  memState = {
    ...memState,
    savedFilters: memState.savedFilters.filter((f) => f.name !== name),
  }
  persist()
}

/** Ring buffer, most-recent first. Only non-empty snapshots are stored. */
export function pushRecentFilter(snapshot: FilterSnapshot): void {
  const isActive =
    snapshot.query.trim().length > 0 ||
    snapshot.methodFilters.length > 0 ||
    snapshot.statusGroup !== 'all' ||
    snapshot.groupBy !== 'none'

  if (!isActive) return

  // dedupe by query
  const deduplicated = memState.recentFilters.filter((r) => r.query !== snapshot.query)
  const next = [snapshot, ...deduplicated].slice(0, MAX_RECENT)

  memState = { ...memState, recentFilters: next }
  persist()
}
