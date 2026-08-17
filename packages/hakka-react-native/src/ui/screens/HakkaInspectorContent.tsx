import type { NetworkRequest } from 'hakka-core'
import React from 'react'
import { Pressable, StatusBar, Text, View, type LayoutChangeEvent } from 'react-native'

import { Filters } from '../components/Filters'
import { type HeaderNavKey, Header } from '../components/Header'
import { List } from '../components/List'
import type { InspectorPage } from '../hooks/useInspectorPages'
import { Pause } from '../icons'
import type { useTheme } from '../styles'
import type { FilterSnapshot, SavedFilter } from '../utils/filterPersist'
import { type GroupBy, type SortBy, type SortDir } from '../utils/groupSort'
import type { MonitorHealthInput, MonitorSummary } from '../utils/monitorSummary'
import type { StatusGroup } from '../viewModels'
import type { createStyles } from './HakkaInspectorStyles'
import { LogsTabView } from './LogsTabView'
import { RulesPanel } from './RulesPanel'
import { SettingsPanel } from './SettingsPanel'
import { Stats } from './Stats'
import { StorageViewer } from './StorageViewer'

type MonitorStatusBarStyle = 'default' | 'light-content' | 'dark-content'

/** Which tab lights up for a given page; 'settings' maps to nothing (not a tab). */
const PAGE_TO_NAV_KEY: Record<Exclude<InspectorPage, 'settings'>, HeaderNavKey> = {
  logs: 'network',
  stats: 'stats',
  rules: 'rules',
  storage: 'storage',
  appLogs: 'appLogs',
}

type DetailsVisibility = 'open' | 'closed'

interface InspectorHeaderSpec {
  enabled: boolean
  exportButton: 'visible' | 'hidden'
  filteredCount?: number
}

interface InspectorFilterSpec {
  query: string
  /** Effective query passed to the list: `query` verbatim, or `nlToQuery(query)` when NL mode is on. */
  effectiveQuery: string
  panel: 'expanded' | 'collapsed'
  statusGroup: StatusGroup
  methodFilters: Set<string>
  sort: 'newest' | 'oldest'
  bodySearch: 'enabled' | 'disabled'
  nlSearch: 'enabled' | 'disabled'
  domains: string[]
  selectedDomains: Set<string>
  groupBy: GroupBy
  sortBy: SortBy
  sortDir: SortDir
  savedFilters: SavedFilter[]
  recentFilters: FilterSnapshot[]
}

export interface InspectorContentProps {
  barStyle: MonitorStatusBarStyle
  colors: ReturnType<typeof useTheme>['colors']
  styles: ReturnType<typeof createStyles>
  mode: 'bubble' | 'invisible' | 'fullscreen'
  logs: NetworkRequest[]
  globalMonitorSummary: MonitorSummary
  healthReport: MonitorHealthInput | null
  page: InspectorPage
  details: DetailsVisibility
  header: InspectorHeaderSpec
  filters: InspectorFilterSpec
  isPaused: boolean
  onTogglePause: () => void
  onCloseStats: () => void
  onCloseRules: () => void
  onCloseStorage: () => void
  onCloseAppLogs: () => void
  onCloseSettings: () => void
  onInspectorClose: () => void
  onExport: () => void
  onOpenNetwork: () => void
  onOpenStats: () => void
  onOpenRules: () => void
  onOpenStorage: () => void
  onOpenAppLogs: () => void
  onOpenSettings: () => void
  onClearLogs: () => void
  onFilterChange: (value: string) => void
  onToggleFilters: () => void
  onStatusGroupChange: (value: StatusGroup) => void
  onMethodToggle: (method: string) => void
  onSortToggle: () => void
  onSearchInBodyToggle: (value: boolean) => void
  onNlModeToggle: (value: boolean) => void
  onDomainToggle: (domain: string) => void
  onGroupByChange: (value: GroupBy) => void
  onSortByChange: (value: SortBy) => void
  onSortDirToggle: () => void
  onDetailsOpenChange: (value: boolean) => void
  onLayoutMeasured: (event: LayoutChangeEvent) => void
  onSaveFilter: () => void
  onApplyFilter: (snapshot: FilterSnapshot) => void
  onRemoveSavedFilter: (name: string) => void
  selectMode: boolean
  onSelectModeToggle: () => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onBulkExportHar: () => void
  onBulkExportPostman: () => void
  onBulkExportOtel: () => void
  onCancelSelect: () => void
}

export function InspectorContent({
  barStyle,
  colors,
  styles,
  mode,
  logs,
  globalMonitorSummary,
  healthReport,
  page,
  details,
  header,
  filters,
  isPaused,
  onTogglePause,
  onCloseStats,
  onCloseRules,
  onCloseStorage,
  onCloseAppLogs,
  onCloseSettings,
  onInspectorClose,
  onOpenNetwork,
  onExport,
  onOpenStats,
  onOpenRules,
  onOpenStorage,
  onOpenAppLogs,
  onOpenSettings,
  onClearLogs,
  onFilterChange,
  onToggleFilters,
  onStatusGroupChange,
  onMethodToggle,
  onSortToggle,
  onSearchInBodyToggle,
  onNlModeToggle,
  onDomainToggle,
  onGroupByChange,
  onSortByChange,
  onSortDirToggle,
  onDetailsOpenChange,
  onLayoutMeasured,
  onSaveFilter,
  onApplyFilter,
  onRemoveSavedFilter,
  selectMode,
  onSelectModeToggle,
  selectedIds,
  onToggleSelect,
  onBulkExportHar,
  onBulkExportPostman,
  onBulkExportOtel,
  onCancelSelect,
}: InspectorContentProps) {
  // The five tab pages share one shell: the persistent Header (tab strip +
  // gear + close) sits above whichever page renders headerless. Only Settings
  // and the request detail are genuine drill-downs and keep back buttons.
  const tabHeader = details === 'closed' && (
    <Header
      isEnabled={header.enabled}
      activeKey={page === 'settings' ? 'network' : PAGE_TO_NAV_KEY[page]}
      showCloseButton={mode !== 'fullscreen'}
      onClose={onInspectorClose}
      onExport={onExport}
      showExportButton={header.exportButton === 'visible'}
      onNetworkPress={onOpenNetwork}
      onStatsPress={onOpenStats}
      onRulesPress={onOpenRules}
      onStoragePress={onOpenStorage}
      onAppLogsPress={onOpenAppLogs}
      onSettingsPress={onOpenSettings}
    />
  )

  if (page !== 'settings') {
    if (page === 'stats') {
      return (
        <View style={[styles.fullContainer, { backgroundColor: colors.background }]} onLayout={onLayoutMeasured}>
          <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />
          {tabHeader}
          <Stats
            logs={logs}
            summary={globalMonitorSummary}
            healthReport={healthReport}
            onClose={onCloseStats}
            showHeader={false}
          />
        </View>
      )
    }

    if (page === 'rules') {
      return (
        <View style={[styles.fullContainer, { backgroundColor: colors.background }]} onLayout={onLayoutMeasured}>
          <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />
          {tabHeader}
          <RulesPanel onClose={onCloseRules} showHeader={false} />
        </View>
      )
    }

    if (page === 'storage') {
      return (
        <View style={[styles.fullContainer, { backgroundColor: colors.background }]} onLayout={onLayoutMeasured}>
          <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />
          {tabHeader}
          <StorageViewer onClose={onCloseStorage} showHeader={false} />
        </View>
      )
    }

    if (page === 'appLogs') {
      return (
        <View style={[styles.fullContainer, { backgroundColor: colors.background }]} onLayout={onLayoutMeasured}>
          <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />
          {tabHeader}
          <LogsTabView onClose={onCloseAppLogs} showHeader={false} />
        </View>
      )
    }
  }

  if (page === 'settings') {
    return (
      <View style={[styles.fullContainer, { backgroundColor: colors.background }]} onLayout={onLayoutMeasured}>
        <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />
        <SettingsPanel onClose={onCloseSettings} onClearLogs={onClearLogs} />
      </View>
    )
  }

  return (
    <View style={[styles.fullContainer, { backgroundColor: colors.background }]} onLayout={onLayoutMeasured}>
      <StatusBar animated barStyle={barStyle} backgroundColor="transparent" translucent />
      {tabHeader}
      {details === 'closed' && (
        <Filters
          filter={filters.query}
          onFilterChange={onFilterChange}
          showFilters={filters.panel === 'expanded'}
          onToggleFilters={onToggleFilters}
          statusGroup={filters.statusGroup}
          onStatusGroupChange={onStatusGroupChange}
          methodFilters={filters.methodFilters}
          onMethodToggle={onMethodToggle}
          sortDesc={filters.sort === 'newest'}
          onSortToggle={onSortToggle}
          searchInBody={filters.bodySearch === 'enabled'}
          onSearchInBodyToggle={onSearchInBodyToggle}
          nlMode={filters.nlSearch === 'enabled'}
          onNlModeToggle={onNlModeToggle}
          domains={filters.domains}
          selectedDomains={filters.selectedDomains}
          onDomainToggle={onDomainToggle}
          groupBy={filters.groupBy}
          onGroupByChange={onGroupByChange}
          sortBy={filters.sortBy}
          onSortByChange={onSortByChange}
          sortDir={filters.sortDir}
          onSortDirToggle={onSortDirToggle}
          savedFilters={filters.savedFilters}
          recentFilters={filters.recentFilters}
          onSaveFilter={onSaveFilter}
          onApplyFilter={onApplyFilter}
          onRemoveSavedFilter={onRemoveSavedFilter}
          selectMode={selectMode}
          onSelectModeToggle={onSelectModeToggle}
          isPaused={isPaused}
          onTogglePause={onTogglePause}
        />
      )}
      {isPaused && (
        <View style={[styles.pausedBanner, { backgroundColor: colors.warning }]}>
          <Pause size={12} color={colors.background} />
          <Text style={[styles.pausedBannerText, { color: colors.background }]}>Capture paused</Text>
        </View>
      )}
      {selectMode && selectedIds.size > 0 && (
        <View style={[styles.bulkBar, { backgroundColor: colors.backgroundAlt, borderTopColor: colors.border }]}>
          <Text style={[styles.bulkBarCount, { color: colors.text }]}>{selectedIds.size} selected</Text>
          <Pressable
            onPress={onBulkExportHar}
            style={({ pressed }) => [
              styles.bulkBtn,
              { backgroundColor: colors.background },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.bulkBtnText, { color: colors.text }]}>HAR</Text>
          </Pressable>
          <Pressable
            onPress={onBulkExportPostman}
            style={({ pressed }) => [
              styles.bulkBtn,
              { backgroundColor: colors.background },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.bulkBtnText, { color: colors.text }]}>Postman</Text>
          </Pressable>
          <Pressable
            onPress={onBulkExportOtel}
            style={({ pressed }) => [
              styles.bulkBtn,
              { backgroundColor: colors.background },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.bulkBtnText, { color: colors.text }]}>OTel</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onCancelSelect} style={({ pressed }) => pressed && { opacity: 0.7 }}>
            <Text style={[styles.bulkBtnText, { color: colors.textMuted }]}>Cancel</Text>
          </Pressable>
        </View>
      )}
      <List
        logs={logs}
        filter={filters.effectiveQuery}
        methodFilters={filters.methodFilters}
        statusGroup={filters.statusGroup}
        sortDesc={filters.sort === 'newest'}
        searchInBody={filters.bodySearch === 'enabled'}
        isDetailsOpen={details === 'open'}
        onDetailsOpenChange={onDetailsOpenChange}
        selectedDomains={filters.selectedDomains}
        groupBy={filters.groupBy}
        sortBy={filters.sortBy}
        sortDir={filters.sortDir}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
      />
    </View>
  )
}
