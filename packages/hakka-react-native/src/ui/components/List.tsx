import { FlashList } from '@shopify/flash-list'
import { Hakka } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import { compileQuery, extractHost, parseRangeFilters, parseSearchTokens } from 'hakka-core'
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshControl, Text, View } from 'react-native'

import { useChromeTopInset } from '../hooks/useChromeInsets'
import { useSafeAreaInsets } from '../hooks/useSafeArea'
import { useSheetScrollable } from '../hooks/useSheetScrollable'
import { Details } from '../screens/Details'
import { createStyleSheet, useTheme } from '../styles'
import { type GroupBy, type SortBy, type SortDir, groupRequests, sortRequests } from '../utils/groupSort'
import { type TabType } from './Details/Tabs'
import { Row } from './Row'

export interface ListProps {
  logs: NetworkRequest[]
  filter: string
  methodFilters: Set<string>
  statusGroup: 'all' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
  sortDesc: boolean
  minDuration?: number
  minSize?: number
  searchInBody?: boolean
  isDetailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  selectedDomains?: Set<string>
  /** Group requests by host / status-class / method. Default: 'none' */
  groupBy?: GroupBy
  /** Sort field for the list. Default: 'time' */
  sortBy?: SortBy
  /** Sort direction. Derived from sortDesc when sortBy is 'time', explicit otherwise. */
  sortDir?: SortDir
  /** Multi-select mode — rows become selectable. */
  selectMode?: boolean
  selectedIds?: Set<string>
  /** Called when a row is toggled in multi-select mode. */
  onToggleSelect?: (id: string) => void
}

const EMPTY_SELECTED_DOMAINS = new Set<string>()
const EMPTY_SELECTED_IDS = new Set<string>()

/** Virtual list item: either a section header or a request row */
type ListItem = { type: 'header'; title: string; count: number } | { type: 'row'; request: NetworkRequest }

export function List({
  logs: liveLogs,
  filter,
  methodFilters,
  statusGroup,
  sortDesc,
  minDuration,
  minSize,
  searchInBody,
  isDetailsOpen,
  onDetailsOpenChange,
  selectedDomains = EMPTY_SELECTED_DOMAINS,
  groupBy = 'none',
  sortBy = 'time',
  sortDir,
  selectMode = false,
  selectedIds = EMPTY_SELECTED_IDS,
  onToggleSelect,
}: ListProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme
  const safeAreaInsets = useSafeAreaInsets()
  const chromeTopInset = useChromeTopInset()
  const [selectedRequest, setSelectedRequest] = useState<NetworkRequest | null>(null)
  const [detailTab, setDetailTab] = useState<TabType>('overview')
  const [refreshing, setRefreshing] = useState(false)

  // Logs freeze while details is open, so the list underneath doesn't reflow under it.
  const frozenLogsRef = useRef<NetworkRequest[]>(liveLogs)
  const logs = isDetailsOpen ? frozenLogsRef.current : liveLogs

  useEffect(() => {
    if (!isDetailsOpen) {
      frozenLogsRef.current = liveLogs
    }
  }, [isDetailsOpen, liveLogs])

  // sortBy==='time' honors the legacy sortDesc prop (true=desc=newest-first); otherwise sortDir wins, default 'desc'.
  const effectiveSortDir: SortDir = sortDir ?? (sortBy === 'time' ? (sortDesc ? 'desc' : 'asc') : 'desc')

  // Build the compiled predicate once per query change (regex/glob compiled once, not per request).
  const deferredFilter = useDeferredValue(filter)
  const predicate = useMemo(() => {
    const { ranges, rest } = parseRangeFilters(deferredFilter)

    const statusDslMap: Record<string, string | undefined> = {
      '1xx': '1xx',
      '2xx': '2xx',
      '3xx': '3xx',
      '4xx': '4xx',
      '5xx': '5xx',
    }

    return compileQuery({
      tokens: parseSearchTokens(rest),
      statusDsl: statusDslMap[statusGroup],
      method: methodFilters.size === 1 ? [...methodFilters][0] : undefined,
      ...ranges,
      // minDuration/minSize props override the parsed range.
      ...(minDuration !== undefined && minDuration > 0 ? { durationMin: minDuration } : {}),
      ...(minSize !== undefined && minSize > 0 ? { sizeMin: minSize } : {}),
    })
  }, [deferredFilter, statusGroup, methodFilters, minDuration, minSize])

  // Filter and domain-filter in one pass
  const displayLogs = useMemo(() => {
    const hasDomainFilter = selectedDomains.size > 0
    const hasMultiMethodFilter = methodFilters.size > 1

    return logs.filter((l) => {
      // Core predicate handles tokens, status DSL, single-method, ranges
      if (!predicate(l)) return false

      // Core predicate only handles single method (`method` field); multi-select falls back to a Set check.
      if (hasMultiMethodFilter && !methodFilters.has(l.method.toUpperCase())) {
        return false
      }

      if (hasDomainFilter && !selectedDomains.has(extractHost(l.url))) {
        return false
      }

      return true
    })
  }, [logs, predicate, methodFilters, selectedDomains])

  const flatItems = useMemo((): ListItem[] => {
    if (groupBy !== 'none') return []
    const sorted = sortRequests(displayLogs, sortBy, effectiveSortDir)
    return sorted.map((request) => ({ type: 'row' as const, request }))
  }, [displayLogs, groupBy, sortBy, effectiveSortDir])

  // Grouped list items: interleave section headers + rows
  const groupedItems = useMemo((): ListItem[] => {
    if (groupBy === 'none') return []
    const groups = groupRequests(displayLogs, groupBy, sortBy, effectiveSortDir)
    const items: ListItem[] = []
    for (const group of groups) {
      items.push({ type: 'header', title: group.title, count: group.data.length })
      for (const request of group.data) {
        items.push({ type: 'row', request })
      }
    }
    return items
  }, [displayLogs, groupBy, sortBy, effectiveSortDir])

  const listItems = groupBy === 'none' ? flatItems : groupedItems

  const handleRequestPress = useCallback(
    (request: NetworkRequest) => {
      setSelectedRequest(request)
      setDetailTab('overview')
      onDetailsOpenChange(true)
    },
    [onDetailsOpenChange],
  )

  const handleDetailsClose = useCallback(() => {
    setSelectedRequest(null)
    onDetailsOpenChange(false)
  }, [onDetailsOpenChange])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const freshLogs = Hakka.getLogs() || []
      if (isDetailsOpen) {
        frozenLogsRef.current = freshLogs
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[List] Refresh failed:', error)
      }
    } finally {
      setRefreshing(false)
    }
  }, [isDetailsOpen])

  const keyExtractor = useCallback((item: ListItem, index: number) => {
    if (item.type === 'header') return `__header__${item.title}_${index}`
    return item.request.id
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'header') {
        return (
          <View
            style={[styles.sectionHeader, { backgroundColor: colors.backgroundAlt, borderBottomColor: colors.border }]}
          >
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{item.title}</Text>
            <Text style={[styles.sectionCount, { color: colors.textSubtle }]}>{item.count}</Text>
          </View>
        )
      }
      const isSelected = selectMode && selectedIds.has(item.request.id)
      const handlePress = selectMode ? () => onToggleSelect?.(item.request.id) : handleRequestPress
      return <Row request={item.request} onPress={handlePress} searchTerm={deferredFilter} selected={isSelected} />
    },
    [
      colors.backgroundAlt,
      colors.border,
      colors.textMuted,
      colors.textSubtle,
      deferredFilter,
      handleRequestPress,
      onToggleSelect,
      selectMode,
      selectedIds,
      styles.sectionCount,
      styles.sectionHeader,
      styles.sectionTitle,
    ],
  )

  // FlashList v2 auto-sizes everything (no getItemLayout/estimatedItemSize) —
  // getItemType is the recommended recycling hint for a mixed header/row list.
  const getItemType = useCallback((item: ListItem) => item.type, [])

  const renderScrollComponent = useSheetScrollable()

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor={colors.active}
      colors={[colors.active]}
    />
  )

  if (selectedRequest) {
    return (
      <View
        style={[
          styles.container,
          styles.detailsContainer,
          { borderTopColor: colors.border, backgroundColor: colors.background, paddingTop: chromeTopInset },
        ]}
      >
        <Details
          request={selectedRequest}
          detailTab={detailTab}
          onClose={handleDetailsClose}
          onTabChange={setDetailTab}
        />
      </View>
    )
  }

  return (
    <View style={[styles.container, { borderTopColor: colors.border }]}>
      <FlashList
        data={listItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: 20 + safeAreaInsets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        renderScrollComponent={renderScrollComponent}
        // Live traffic streaming in at the top must not yank scroll position — FlashList v2
        // does this by default; disabled for grouped mode since headers shift more than a plain top-insert.
        maintainVisibleContentPosition={groupBy === 'none' ? undefined : { disabled: true }}
        stickyHeaderIndices={
          groupBy !== 'none'
            ? groupedItems.map((item, index) => (item.type === 'header' ? index : -1)).filter((i) => i !== -1)
            : undefined
        }
      />
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    flex: 1,
    borderTopWidth: 1,
  },
  list: {
    flex: 1,
  },
  detailsContainer: {
    flex: 1,
  },
  listContent: {},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.ll,
    paddingVertical: theme.spacing.xs,
    borderBottomWidth: 1,
    height: theme.controlHeight.icon,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionCount: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
  },
}))
