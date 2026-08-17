/** StorageViewerState — reducer-driven state machine for StorageViewer. */
export type StorageBackend = 'AsyncStorage' | 'MMKV'

export interface StorageEntry {
  key: string
  value: string
}

export interface StorageViewerState {
  backend: StorageBackend
  entries: StorageEntry[]
  search: string
  loading: boolean
  selectedKey: string | null
  editValue: string
  isEditing: boolean
}

export type StorageViewerAction =
  | { type: 'backend'; backend: StorageBackend }
  | { type: 'entriesLoading' }
  | { type: 'entriesLoaded'; entries: StorageEntry[] }
  | { type: 'search'; value: string }
  | { type: 'selectKey'; key: string }
  | { type: 'backToList' }
  | { type: 'startEdit'; value: string }
  | { type: 'cancelEdit' }
  | { type: 'editValue'; value: string }
  | { type: 'saveComplete' }
  | { type: 'deleted'; key: string }

export function createStorageViewerState(backend: StorageBackend): StorageViewerState {
  return {
    backend,
    entries: [],
    search: '',
    loading: false,
    selectedKey: null,
    editValue: '',
    isEditing: false,
  }
}

export function storageViewerReducer(state: StorageViewerState, action: StorageViewerAction): StorageViewerState {
  switch (action.type) {
    case 'backend':
      return { ...state, backend: action.backend, selectedKey: null, isEditing: false }
    case 'entriesLoading':
      return { ...state, loading: true }
    case 'entriesLoaded':
      return { ...state, entries: action.entries, loading: false }
    case 'search':
      return { ...state, search: action.value }
    case 'selectKey':
      return { ...state, selectedKey: action.key }
    case 'backToList':
      return { ...state, selectedKey: null, isEditing: false }
    case 'startEdit':
      return { ...state, editValue: action.value, isEditing: true }
    case 'cancelEdit':
      return { ...state, isEditing: false }
    case 'editValue':
      return { ...state, editValue: action.value }
    case 'saveComplete':
      return { ...state, isEditing: false }
    case 'deleted':
      return state.selectedKey === action.key ? { ...state, selectedKey: null, isEditing: false } : state
  }
}
