/**
 * LogsPanel — lists structured log entries from hakka-core's `logStore`
 * (log()/logDebug()/logInfo()/logWarn()/logError()), with a level filter,
 * color-coded badges, category tag, and expandable metadata.
 *
 * Distinct from ConsolePanel: that mirrors raw console.* output via
 * ConsoleInterceptor; this is for the app's own structured logging calls
 * (category + metadata, redaction-aware).
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import type { LogEntry, LogLevel } from 'hakka-core'
import { logStore } from 'hakka-core'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Chip } from '../components/Chip'
import { useSheetScrollable } from '../hooks/useSheetScrollable'
import { ArrowLeft, Trash2 } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import { lightImpact } from '../utils/haptics'

type LevelFilter = 'all' | LogLevel

const LEVEL_FILTERS: { key: LevelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'debug', label: 'Debug' },
  { key: 'info', label: 'Info' },
  { key: 'warn', label: 'Warn' },
  { key: 'error', label: 'Error' },
]

function matchesFilter(entry: LogEntry, filter: LevelFilter): boolean {
  return filter === 'all' || entry.level === filter
}

function levelLabel(level: LogLevel): string {
  return level.toUpperCase().slice(0, 4)
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
    .getSeconds()
    .toString()
    .padStart(2, '0')}`
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function useLogEntries(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>(() => logStore.getEntries())

  useEffect(() => {
    setEntries(logStore.getEntries())
    return logStore.subscribe(() => {
      setEntries(logStore.getEntries())
    })
  }, [])

  return entries
}

interface LogRowProps {
  entry: LogEntry
  levelColor: (level: LogLevel) => string
  styles: ReturnType<typeof createStyles>
  colors: ReturnType<typeof useTheme>['colors']
}

const LogRow = memo(function LogRow({ entry, levelColor, styles, colors }: LogRowProps) {
  const [expanded, setExpanded] = useState(false)
  const color = levelColor(entry.level)
  const metadataEntries = entry.metadata ? Object.entries(entry.metadata) : []
  const hasMetadata = metadataEntries.length > 0

  return (
    <Pressable
      accessibilityRole={hasMetadata ? 'button' : undefined}
      disabled={!hasMetadata}
      onPress={() => setExpanded((prev) => !prev)}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      <View style={styles.rowHeader}>
        <Text style={[styles.levelBadge, { color }]}>{levelLabel(entry.level)}</Text>
        <Text style={[styles.timestamp, { color: colors.textSubtle }]}>{formatTimestamp(entry.timestamp)}</Text>
        {entry.category && (
          <View style={[styles.categoryPill, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
            <Text style={[styles.categoryText, { color: colors.textMuted }]} numberOfLines={1}>
              {entry.category}
            </Text>
          </View>
        )}
        {hasMetadata && <Text style={[styles.expandGlyph, { color: colors.textSubtle }]}>{expanded ? '▾' : '▸'}</Text>}
      </View>
      <Text
        style={[styles.message, { color: entry.level === 'error' || entry.level === 'warn' ? color : colors.text }]}
        selectable
      >
        {entry.message}
      </Text>
      {expanded && hasMetadata && (
        <View style={[styles.metadata, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
          {metadataEntries.map(([key, value]) => (
            <Text key={key} style={[styles.metadataLine, { color: colors.textMuted }]} selectable>
              <Text style={[styles.metadataKey, { color: colors.text }]}>{key}</Text>: {formatMetadataValue(value)}
            </Text>
          ))}
        </View>
      )}
    </Pressable>
  )
})

export interface LogsPanelProps {
  onClose: () => void
  /** Hide the panel's own back/title/clear header — used when embedded under
   * the merged Logs screen's shared header + Console/Structured segmented
   * switch (LogsTabView). Default true. */
  showHeader?: boolean
}

export const LogsPanel: React.FC<LogsPanelProps> = ({ onClose, showHeader = true }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const entries = useLogEntries()
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const listRef = useRef<FlashListRef<LogEntry>>(null)
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
    (level: LogLevel): string => {
      switch (level) {
        case 'error':
          return colors.error
        case 'warn':
          return colors.warning
        case 'info':
          return colors.info
        case 'debug':
          return colors.textMuted
      }
    },
    [colors],
  )

  const filtered = useMemo(() => entries.filter((e) => matchesFilter(e, levelFilter)), [entries, levelFilter])

  const handleClear = useCallback(() => {
    lightImpact()
    logStore.clear()
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: LogEntry }) => <LogRow entry={item} levelColor={levelColor} styles={styles} colors={colors} />,
    [levelColor, styles, colors],
  )

  const keyExtractor = useCallback((item: LogEntry) => item.id, [])

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {showHeader && (
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close logs panel"
            onPress={onClose}
            style={styles.backButton}
          >
            <ArrowLeft size={20} color={colors.textMuted} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Logs</Text>
          <Pressable accessibilityRole="button" onPress={handleClear} style={styles.clearButton}>
            <Trash2 size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      <View style={[styles.toolbar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.chips}>
          {LEVEL_FILTERS.map(({ key, label }) => (
            <Chip key={key} label={label} active={levelFilter === key} onPress={() => setLevelFilter(key)} />
          ))}
        </View>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {entries.length === 0 ? 'No logs captured yet.' : 'No matching entries.'}
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chips: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },

  row: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.xxs,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  levelBadge: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  timestamp: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  categoryPill: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 1,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
  },
  categoryText: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
  },
  expandGlyph: {
    fontSize: theme.fontSize.xs,
    marginLeft: 'auto',
  },
  message: {
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  metadata: {
    marginTop: theme.spacing.xxs,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.xxs,
  },
  metadataLine: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  metadataKey: {
    fontWeight: theme.fontWeight.semibold,
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
