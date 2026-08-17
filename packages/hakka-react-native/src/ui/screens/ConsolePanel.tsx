/**
 * ConsolePanel — lists captured console entries (log/info/warn/error/debug)
 * with level filter chips and a search bar.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { ConsoleInterceptor } from 'hakka-core'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { Chip } from '../components/Chip'
import { useSheetScrollable } from '../hooks/useSheetScrollable'
import { ArrowLeft, Trash2, X } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import { lightImpact } from '../utils/haptics'

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

interface ConsoleEntry {
  level: ConsoleLevel
  message: string
  timestamp: number
  count: number
  id: string
}

type LevelFilter = 'all' | 'log' | 'warn' | 'error'

const LEVEL_FILTERS: { key: LevelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'log', label: 'Log' },
  { key: 'warn', label: 'Warn' },
  { key: 'error', label: 'Error' },
]

const MAX_CONSOLE_ENTRIES = 500
let consoleEntries: ConsoleEntry[] = []
let nextEntryId = 0
const consoleListeners = new Set<() => void>()

function notifyConsoleListeners(): void {
  for (const fn of consoleListeners) {
    try {
      fn()
    } catch {
      // never crash
    }
  }
}

function addConsoleEntry(level: ConsoleLevel, message: string): void {
  const last = consoleEntries[consoleEntries.length - 1]
  if (last && last.level === level && last.message === message) {
    consoleEntries[consoleEntries.length - 1] = { ...last, count: last.count + 1, timestamp: Date.now() }
    notifyConsoleListeners()
    return
  }

  nextEntryId += 1
  consoleEntries = [
    ...consoleEntries.slice(consoleEntries.length >= MAX_CONSOLE_ENTRIES ? 1 : 0),
    { level, message, timestamp: Date.now(), count: 1, id: String(nextEntryId) },
  ]
  notifyConsoleListeners()
}

function getConsoleEntries(): ConsoleEntry[] {
  return consoleEntries
}

export function clearConsoleEntries(): void {
  consoleEntries = []
  notifyConsoleListeners()
}

function onConsoleChange(fn: () => void): () => void {
  consoleListeners.add(fn)
  return () => consoleListeners.delete(fn)
}

let interceptorSetUp = false

/**
 * Enable the console interceptor and wire it to the in-memory store.
 * Safe to call multiple times — idempotent.
 */
export function ensureConsoleCapture(): void {
  if (interceptorSetUp) return
  interceptorSetUp = true
  ConsoleInterceptor.enable()
  ConsoleInterceptor.onEntry((entry) => {
    addConsoleEntry(entry.level as ConsoleLevel, entry.message)
  })
}

function useConsoleEntries(): ConsoleEntry[] {
  const [entries, setEntries] = useState<ConsoleEntry[]>(() => getConsoleEntries())

  useEffect(() => {
    setEntries(getConsoleEntries())
    return onConsoleChange(() => setEntries(getConsoleEntries()))
  }, [])

  return entries
}

function levelLabel(level: ConsoleLevel): string {
  return level.toUpperCase().slice(0, 3)
}

function matchesFilter(entry: ConsoleEntry, filter: LevelFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'log') return entry.level === 'log' || entry.level === 'info' || entry.level === 'debug'
  if (filter === 'warn') return entry.level === 'warn'
  if (filter === 'error') return entry.level === 'error'
  return true
}

interface ConsoleRowProps {
  entry: ConsoleEntry
  levelColor: (level: ConsoleLevel) => string
  styles: ReturnType<typeof createStyles>
  colors: ReturnType<typeof useTheme>['colors']
}

const ConsoleRow = memo(function ConsoleRow({ entry, levelColor, styles, colors }: ConsoleRowProps) {
  const color = levelColor(entry.level)
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.levelBadge, { color }]}>{levelLabel(entry.level)}</Text>
      <Text
        style={[styles.message, { color: entry.level === 'error' || entry.level === 'warn' ? color : colors.text }]}
        selectable
      >
        {entry.message}
      </Text>
      {entry.count > 1 && (
        <View style={[styles.countBadge, { backgroundColor: colors.textMuted }]}>
          <Text style={styles.countText}>{entry.count > 99 ? '99+' : entry.count}</Text>
        </View>
      )}
    </View>
  )
})

export interface ConsolePanelProps {
  onClose: () => void
  /** Hide the panel's own back/title/clear header — used when embedded under
   * the merged Logs screen's shared header + Console/Structured segmented
   * switch (LogsTabView). Default true. */
  showHeader?: boolean
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ onClose, showHeader = true }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const entries = useConsoleEntries()
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [search, setSearch] = useState('')
  const listRef = useRef<FlashListRef<ConsoleEntry>>(null)
  const isAtBottomRef = useRef(true)
  const prevCountRef = useRef(entries.length)
  const renderScrollComponent = useSheetScrollable()

  useEffect(() => {
    if (entries.length !== prevCountRef.current && isAtBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: false })
    }
    prevCountRef.current = entries.length
  }, [entries.length])

  const levelColor = useCallback(
    (level: ConsoleLevel): string => {
      switch (level) {
        case 'error':
          return colors.error
        case 'warn':
          return colors.warning
        case 'info':
          return colors.info
        default:
          return colors.textMuted
      }
    },
    [colors],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return entries.filter((e) => {
      if (!matchesFilter(e, levelFilter)) return false
      if (q && !e.message.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, levelFilter, search])

  const handleClear = useCallback(() => {
    lightImpact()
    clearConsoleEntries()
  }, [])

  const handleClearSearch = useCallback(() => setSearch(''), [])

  const renderItem = useCallback(
    ({ item }: { item: ConsoleEntry }) => (
      <ConsoleRow entry={item} levelColor={levelColor} styles={styles} colors={colors} />
    ),
    [levelColor, styles, colors],
  )

  const keyExtractor = useCallback((item: ConsoleEntry) => item.id, [])

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {showHeader && (
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close console panel"
            onPress={onClose}
            style={styles.backButton}
          >
            <ArrowLeft size={20} color={colors.textMuted} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Console</Text>
          <Pressable accessibilityRole="button" onPress={handleClear} style={styles.clearButton}>
            <Trash2 size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      <View style={[styles.toolbar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.searchWrapper}>
          <TextInput
            style={[
              styles.searchInput,
              {
                backgroundColor: colors.backgroundAlt,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder="Search console…"
            placeholderTextColor={colors.textSubtle}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable accessibilityRole="button" style={styles.clearSearch} onPress={handleClearSearch}>
              <X size={12} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <View style={styles.chips}>
          {LEVEL_FILTERS.map(({ key, label }) => (
            <Chip key={key} label={label} active={levelFilter === key} onPress={() => setLevelFilter(key)} />
          ))}
        </View>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {entries.length === 0 ? 'No console output captured yet.' : 'No matching entries.'}
          </Text>
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          renderScrollComponent={renderScrollComponent}
          onScrollEndDrag={({ nativeEvent }) => {
            const { contentOffset, contentSize, layoutMeasurement } = nativeEvent
            isAtBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 40
          }}
          onMomentumScrollEnd={({ nativeEvent }) => {
            const { contentOffset, contentSize, layoutMeasurement } = nativeEvent
            isAtBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 40
          }}
        />
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: theme.controlHeight.nav,
    height: theme.controlHeight.nav,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  clearButton: {
    width: theme.controlHeight.nav,
    height: theme.controlHeight.nav,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  toolbar: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchWrapper: {
    position: 'relative',
  },
  searchInput: {
    height: theme.controlHeight.field,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingRight: theme.spacing.xxxl,
    fontSize: theme.fontSize.md,
  },
  clearSearch: {
    position: 'absolute',
    right: theme.spacing.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  levelBadge: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    width: 30,
    flexShrink: 0,
    paddingTop: 1,
    fontFamily: 'monospace',
  },
  message: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  countBadge: {
    minWidth: theme.controlHeight.badge,
    height: theme.controlHeight.badge,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.controlHeight.badge / 2,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  countText: {
    fontSize: theme.fontSize.xxs,
    fontWeight: theme.fontWeight.bold,
    color: '#fff',
  },
  listContent: {
    paddingBottom: theme.layout.scrollBottomInset,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xxl,
  },
  emptyText: {
    fontSize: theme.fontSize.md,
    textAlign: 'center',
  },
}))
