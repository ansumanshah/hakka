/** StorageViewerList — the key list, search, and backend toggle in StorageViewer. */
import { FlashList } from '@shopify/flash-list'
import React, { useCallback } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'

import { useSheetScrollable } from '../hooks/useSheetScrollable'
import { ArrowLeft, X } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import { StorageViewerRow } from './StorageViewerRow'
import type { StorageBackend, StorageEntry } from './StorageViewerState'

export interface StorageViewerListProps {
  backend: StorageBackend
  entries: StorageEntry[]
  filtered: StorageEntry[]
  hasAsyncStorage: boolean
  hasMMKV: boolean
  loading: boolean
  noBackend: boolean
  onClose?: () => void
  showHeader: boolean
  onRefresh: () => void
  onSelectAsyncStorage: () => void
  onSelectMMKV: () => void
  onSelectKey: (key: string) => void
  onDeleteKey: (key: string) => void
  search: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
}

function StorageViewerListInner({
  backend,
  entries,
  filtered,
  hasAsyncStorage,
  hasMMKV,
  loading,
  noBackend,
  onClose,
  showHeader,
  onRefresh,
  onSelectAsyncStorage,
  onSelectMMKV,
  onSelectKey,
  onDeleteKey,
  search,
  onSearchChange,
  onClearSearch,
}: StorageViewerListProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme
  const renderScrollComponent = useSheetScrollable()

  const renderListRow = useCallback(
    ({ item }: { item: StorageEntry }) => (
      <StorageViewerRow item={item} onSelect={onSelectKey} onDelete={onDeleteKey} />
    ),
    [onSelectKey, onDeleteKey],
  )

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        {showHeader && onClose && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close storage panel"
            style={styles.backBtn}
            onPress={onClose}
          >
            <ArrowLeft size={18} color={colors.text} />
          </Pressable>
        )}
        {showHeader ? (
          <Text style={[styles.headerTitle, { color: colors.text }]}>Storage</Text>
        ) : (
          // Stands in for the title's `flex: 1`, which pushes the toggle/Refresh right.
          <View style={styles.headerSpacer} />
        )}

        {hasAsyncStorage && hasMMKV && (
          <View style={styles.toggle}>
            <Pressable
              accessibilityRole="button"
              style={[styles.toggleBtn, backend === 'AsyncStorage' && { backgroundColor: colors.accent }]}
              onPress={onSelectAsyncStorage}
            >
              <Text
                style={[
                  styles.toggleText,
                  {
                    color: backend === 'AsyncStorage' ? '#fff' : colors.textMuted,
                  },
                ]}
              >
                Async
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.toggleBtn, backend === 'MMKV' && { backgroundColor: colors.accent }]}
              onPress={onSelectMMKV}
            >
              <Text style={[styles.toggleText, { color: backend === 'MMKV' ? '#fff' : colors.textMuted }]}>MMKV</Text>
            </Pressable>
          </View>
        )}

        <Pressable accessibilityRole="button" style={styles.actionBtn} onPress={onRefresh}>
          <Text style={[styles.actionText, { color: colors.accent }]}>Refresh</Text>
        </Pressable>
      </View>

      {noBackend ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            No storage backend available. Install @react-native-async-storage/async-storage or react-native-mmkv.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.searchRow}>
            <TextInput
              style={[
                styles.searchInput,
                {
                  backgroundColor: colors.backgroundAlt,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Search keys..."
              placeholderTextColor={colors.textSubtle}
              value={search}
              onChangeText={onSearchChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <Pressable accessibilityRole="button" style={styles.clearSearch} onPress={onClearSearch}>
                <X size={14} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          {loading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {entries.length === 0 ? 'No keys found.' : 'No matching keys.'}
              </Text>
            </View>
          ) : (
            <FlashList
              data={filtered}
              keyExtractor={(item) => item.key}
              renderItem={renderListRow}
              contentContainerStyle={styles.listContent}
              renderScrollComponent={renderScrollComponent}
            />
          )}
        </>
      )}
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  backBtn: {
    width: theme.controlHeight.nav,
    height: theme.controlHeight.nav,
    borderRadius: theme.radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  headerTitle: {
    flex: 1,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  toggleBtn: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  toggleText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  actionBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  actionText: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
  },
  searchRow: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    position: 'relative',
  },
  searchInput: {
    height: theme.controlHeight.field,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    fontSize: theme.fontSize.md,
  },
  clearSearch: {
    position: 'absolute',
    right: theme.spacing.lg + theme.spacing.md,
    top: 0,
    bottom: theme.spacing.md,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xs,
  },
  listContent: {
    paddingBottom: theme.layout.scrollBottomInset,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xxl,
  },
  emptyText: {
    fontSize: theme.fontSize.md,
    textAlign: 'center',
    lineHeight: 20,
  },
}))

export const StorageViewerList = React.memo(StorageViewerListInner)
