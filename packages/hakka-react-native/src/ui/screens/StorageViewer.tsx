/**
 * StorageViewer — Browse, search, edit, and delete AsyncStorage / MMKV entries.
 *
 * Gracefully handles missing deps:
 * - @react-native-async-storage/async-storage (optional)
 * - react-native-mmkv (optional)
 */
import React, { useCallback, useEffect, useMemo, useReducer } from 'react'
import { Alert } from 'react-native'

import { AsyncStorageModule, MMKVModule } from './StorageViewerBackends'
import { StorageViewerDetail } from './StorageViewerDetail'
import { StorageViewerList } from './StorageViewerList'
import { createStorageViewerState, storageViewerReducer } from './StorageViewerState'

export interface StorageViewerProps {
  onClose?: () => void
  /** False when the shell's persistent tab strip already renders above this
   * page: no back button/title of its own, but keeps the backend toggle. */
  showHeader?: boolean
}

export const StorageViewer: React.FC<StorageViewerProps> = ({ onClose, showHeader = true }) => {
  const hasAsyncStorage = AsyncStorageModule !== null
  const hasMMKV = MMKVModule !== null

  const [state, dispatch] = useReducer(
    storageViewerReducer,
    hasAsyncStorage ? 'AsyncStorage' : 'MMKV',
    createStorageViewerState,
  )

  const loadEntries = useCallback(async () => {
    dispatch({ type: 'entriesLoading' })
    try {
      if (state.backend === 'AsyncStorage' && AsyncStorageModule) {
        const keys = await AsyncStorageModule.getAllKeys()
        const pairs = await AsyncStorageModule.multiGet(keys)
        dispatch({ type: 'entriesLoaded', entries: pairs.map(([k, v]) => ({ key: k, value: v ?? '' })) })
      } else if (state.backend === 'MMKV' && MMKVModule) {
        const storage = new MMKVModule.MMKV()
        const keys = storage.getAllKeys()
        dispatch({ type: 'entriesLoaded', entries: keys.map((k) => ({ key: k, value: storage.getString(k) ?? '' })) })
      } else {
        dispatch({ type: 'entriesLoaded', entries: [] })
      }
    } catch {
      dispatch({ type: 'entriesLoaded', entries: [] })
    }
  }, [state.backend])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const filtered = useMemo(() => {
    if (!state.search) return state.entries
    const q = state.search.toLowerCase()
    return state.entries.filter((e) => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q))
  }, [state.entries, state.search])

  const selectedEntry = useMemo(
    () => state.entries.find((e) => e.key === state.selectedKey) ?? null,
    [state.entries, state.selectedKey],
  )

  const prettyValue = useMemo(() => {
    if (!selectedEntry) return ''
    try {
      return JSON.stringify(JSON.parse(selectedEntry.value), null, 2)
    } catch {
      return selectedEntry.value
    }
  }, [selectedEntry])

  const handleDelete = useCallback(
    (key: string) => {
      Alert.alert('Delete Key', `Delete "${key}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (state.backend === 'AsyncStorage' && AsyncStorageModule) {
                await AsyncStorageModule.removeItem(key)
              } else if (state.backend === 'MMKV' && MMKVModule) {
                const storage = new MMKVModule.MMKV()
                storage.delete(key)
              }
              dispatch({ type: 'deleted', key })
              loadEntries()
            } catch {
              Alert.alert('Error', 'Failed to delete key.')
            }
          },
        },
      ])
    },
    [loadEntries, state.backend],
  )

  const handleSave = useCallback(async () => {
    if (!state.selectedKey) return
    try {
      if (state.backend === 'AsyncStorage' && AsyncStorageModule) {
        await AsyncStorageModule.setItem(state.selectedKey, state.editValue)
      } else if (state.backend === 'MMKV' && MMKVModule) {
        const storage = new MMKVModule.MMKV()
        storage.set(state.selectedKey, state.editValue)
      }
      dispatch({ type: 'saveComplete' })
      loadEntries()
    } catch {
      Alert.alert('Error', 'Failed to save value.')
    }
  }, [loadEntries, state.backend, state.editValue, state.selectedKey])

  const startEdit = useCallback(() => {
    if (!selectedEntry) return
    dispatch({ type: 'startEdit', value: selectedEntry.value })
  }, [selectedEntry])
  const handleBackToList = useCallback(() => dispatch({ type: 'backToList' }), [])
  const handleCancelEdit = useCallback(() => dispatch({ type: 'cancelEdit' }), [])
  const handleSelectAsyncStorage = useCallback(() => dispatch({ type: 'backend', backend: 'AsyncStorage' }), [])
  const handleSelectMMKV = useCallback(() => dispatch({ type: 'backend', backend: 'MMKV' }), [])
  const handleClearSearch = useCallback(() => dispatch({ type: 'search', value: '' }), [])
  const handleEditValueChange = useCallback((value: string) => dispatch({ type: 'editValue', value }), [])
  const handleSearchChange = useCallback((value: string) => dispatch({ type: 'search', value }), [])

  const handleSelectKey = useCallback((key: string) => {
    dispatch({ type: 'selectKey', key })
  }, [])

  if (state.selectedKey && selectedEntry) {
    return (
      <StorageViewerDetail
        selectedEntry={selectedEntry}
        prettyValue={prettyValue}
        isEditing={state.isEditing}
        editValue={state.editValue}
        onBack={handleBackToList}
        onStartEdit={startEdit}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancelEdit={handleCancelEdit}
        onEditValueChange={handleEditValueChange}
      />
    )
  }

  const noBackend = !hasAsyncStorage && !hasMMKV

  return (
    <StorageViewerList
      backend={state.backend}
      entries={state.entries}
      filtered={filtered}
      hasAsyncStorage={hasAsyncStorage}
      hasMMKV={hasMMKV}
      loading={state.loading}
      noBackend={noBackend}
      onClose={onClose}
      showHeader={showHeader}
      onRefresh={loadEntries}
      onSelectAsyncStorage={handleSelectAsyncStorage}
      onSelectMMKV={handleSelectMMKV}
      onSelectKey={handleSelectKey}
      onDeleteKey={handleDelete}
      search={state.search}
      onSearchChange={handleSearchChange}
      onClearSearch={handleClearSearch}
    />
  )
}
