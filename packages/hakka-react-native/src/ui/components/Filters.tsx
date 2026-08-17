import React from 'react'
import { View } from 'react-native'

import { useTheme } from '../styles'
import type { FilterSnapshot, SavedFilter } from '../utils/filterPersist'
import { type GroupBy, type SortBy, type SortDir } from '../utils/groupSort'
import { FiltersDisclosure } from './FiltersDisclosure'
import { FiltersMethodChips } from './FiltersMethodChips'
import { FiltersSearchBar } from './FiltersSearchBar'

export interface FiltersProps {
  filter: string
  onFilterChange: (text: string) => void
  showFilters: boolean
  onToggleFilters: () => void
  statusGroup: 'all' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
  onStatusGroupChange: (group: 'all' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx') => void
  methodFilters: Set<string>
  onMethodToggle: (method: string) => void
  sortDesc: boolean
  onSortToggle: () => void
  searchInBody?: boolean
  onSearchInBodyToggle?: (enabled: boolean) => void
  // Natural-language search: raw `filter` text is run through `nlToQuery` (hakka-core)
  // before applying — lets "failed posts to /checkout" resolve to `status:>=400 method:POST url:/checkout`.
  nlMode?: boolean
  onNlModeToggle?: (enabled: boolean) => void
  // Domain filtering (multi-select)
  domains?: string[]
  selectedDomains?: Set<string>
  onDomainToggle?: (domain: string) => void
  // Group-by + sort-by controls
  groupBy?: GroupBy
  onGroupByChange?: (value: GroupBy) => void
  sortBy?: SortBy
  onSortByChange?: (value: SortBy) => void
  sortDir?: SortDir
  onSortDirToggle?: () => void
  // Saved / recent filters
  savedFilters?: SavedFilter[]
  recentFilters?: FilterSnapshot[]
  onSaveFilter?: () => void
  onApplyFilter?: (snapshot: FilterSnapshot) => void
  onRemoveSavedFilter?: (name: string) => void
  // Multi-select mode
  selectMode?: boolean
  onSelectModeToggle?: () => void
  // Capture pause. Lives in the search bar, not the header — see the search-bar
  // comment in the body.
  isPaused?: boolean
  onTogglePause?: () => void
}

const EMPTY_DOMAINS: string[] = []
const EMPTY_SELECTED_DOMAINS = new Set<string>()
const EMPTY_SAVED_FILTERS: SavedFilter[] = []
const EMPTY_RECENT_FILTERS: FilterSnapshot[] = []

export function Filters({
  filter,
  onFilterChange,
  showFilters,
  onToggleFilters,
  statusGroup,
  onStatusGroupChange,
  methodFilters,
  onMethodToggle,
  sortDesc,
  onSortToggle,
  searchInBody = false,
  onSearchInBodyToggle,
  nlMode = false,
  onNlModeToggle,
  domains = EMPTY_DOMAINS,
  selectedDomains = EMPTY_SELECTED_DOMAINS,
  onDomainToggle,
  groupBy = 'none',
  onGroupByChange,
  sortBy = 'time',
  onSortByChange,
  sortDir,
  onSortDirToggle,
  savedFilters = EMPTY_SAVED_FILTERS,
  recentFilters = EMPTY_RECENT_FILTERS,
  onSaveFilter,
  onApplyFilter,
  onRemoveSavedFilter,
  selectMode = false,
  onSelectModeToggle,
  isPaused = false,
  onTogglePause,
}: FiltersProps) {
  const { colors } = useTheme()

  // Non-default filter/sort states active right now — shown as the "Filters +n" badge
  // so the disclosure communicates state even while collapsed.
  const activeFilterCount =
    (statusGroup !== 'all' ? 1 : 0) +
    (selectedDomains.size > 0 ? 1 : 0) +
    (groupBy !== 'none' ? 1 : 0) +
    (sortBy !== 'time' ? 1 : 0) +
    (searchInBody ? 1 : 0)

  // Resets everything the "Filters +n" badge counts, composed from handlers
  // already wired rather than a new prop.
  const handleReset = React.useCallback(() => {
    onFilterChange('')
    onStatusGroupChange('all')
    methodFilters.forEach((method) => onMethodToggle(method))
    selectedDomains.forEach((domain) => onDomainToggle?.(domain))
    onGroupByChange?.('none')
    onSortByChange?.('time')
    if (searchInBody) onSearchInBodyToggle?.(false)
    if (nlMode) onNlModeToggle?.(false)
  }, [
    methodFilters,
    nlMode,
    onDomainToggle,
    onFilterChange,
    onGroupByChange,
    onMethodToggle,
    onNlModeToggle,
    onSearchInBodyToggle,
    onSortByChange,
    onStatusGroupChange,
    searchInBody,
    selectedDomains,
  ])

  const isDirty = activeFilterCount > 0 || filter.length > 0 || methodFilters.size > 0

  return (
    <View style={{ backgroundColor: colors.backgroundAlt }}>
      <FiltersSearchBar
        filter={filter}
        onFilterChange={onFilterChange}
        nlMode={nlMode}
        showFilters={showFilters}
        onToggleFilters={onToggleFilters}
        activeFilterCount={activeFilterCount}
        isPaused={isPaused}
        onTogglePause={onTogglePause}
      />

      <FiltersMethodChips methodFilters={methodFilters} onMethodToggle={onMethodToggle} />

      {showFilters && (
        <FiltersDisclosure
          statusGroup={statusGroup}
          onStatusGroupChange={onStatusGroupChange}
          domains={domains}
          selectedDomains={selectedDomains}
          onDomainToggle={onDomainToggle}
          nlMode={nlMode}
          onNlModeToggle={onNlModeToggle}
          searchInBody={searchInBody}
          onSearchInBodyToggle={onSearchInBodyToggle}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          sortBy={sortBy}
          onSortByChange={onSortByChange}
          sortDesc={sortDesc}
          onSortToggle={onSortToggle}
          sortDir={sortDir}
          onSortDirToggle={onSortDirToggle}
          savedFilters={savedFilters}
          recentFilters={recentFilters}
          onSaveFilter={onSaveFilter}
          onApplyFilter={onApplyFilter}
          onRemoveSavedFilter={onRemoveSavedFilter}
          selectMode={selectMode}
          onSelectModeToggle={onSelectModeToggle}
          isDirty={isDirty}
          onReset={handleReset}
        />
      )}
    </View>
  )
}
