import React from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { Pause, Play, Search, SlidersHorizontal, X } from '../icons'
import { createStyleSheet, useTheme } from '../styles'

export interface FiltersSearchBarProps {
  filter: string
  onFilterChange: (text: string) => void
  nlMode: boolean
  showFilters: boolean
  onToggleFilters: () => void
  activeFilterCount: number
  isPaused: boolean
  onTogglePause?: () => void
}

/** The search bar IS the row — edge to edge, no box inside a box. The field
 * carries the bar; pause and Filters sit behind a divider at its end. */
export function FiltersSearchBar({
  filter,
  onFilterChange,
  nlMode,
  showFilters,
  onToggleFilters,
  activeFilterCount,
  isPaused,
  onTogglePause,
}: FiltersSearchBarProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  return (
    <View style={[styles.searchBar, { borderBottomColor: colors.border }]}>
      <Search size={14} color={filter.length > 0 ? colors.accent : colors.textMuted} />
      <TextInput
        style={[styles.input, { color: colors.text }]}
        testID="hakka-filter-input"
        // Full query grammar doesn't fit a phone-width field (clips mid-token,
        // e.g. "…size<2") — it's documented, not crammed into the placeholder.
        // Same wording as the web overlay's FilterBar.
        placeholder={nlMode ? 'try "failed posts to /checkout"' : 'Search url, headers, body…'}
        placeholderTextColor={colors.textMuted}
        value={filter}
        onChangeText={onFilterChange}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {filter.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          testID="hakka-filter-clear"
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          onPress={() => onFilterChange('')}
          style={({ pressed }) => pressed && { opacity: 0.5 }}
        >
          <X size={14} color={colors.textMuted} />
        </Pressable>
      )}
      <View style={[styles.searchDivider, { backgroundColor: colors.border }]} />
      {/* Pause lives here, not the header — it freezes this list, and five tabs
          plus four header buttons don't fit at phone widths (STORAGE clipped to "STOR"). */}
      {onTogglePause && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPaused ? 'Resume capture' : 'Pause capture'}
          testID="hakka-pause-button"
          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
          style={({ pressed }) => [styles.barButton, pressed && { opacity: 0.5 }]}
          onPress={onTogglePause}
        >
          {isPaused ? <Play size={14} color={colors.accent} /> : <Pause size={14} color={colors.textMuted} />}
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
        testID="hakka-filters-toggle"
        style={({ pressed }) => [styles.filtersTrigger, pressed && { opacity: 0.5 }]}
        onPress={onToggleFilters}
      >
        <SlidersHorizontal size={13} color={showFilters || activeFilterCount > 0 ? colors.accent : colors.textMuted} />
        <Text
          style={[
            styles.filtersTriggerText,
            { color: showFilters || activeFilterCount > 0 ? colors.accent : colors.textMuted },
          ]}
        >
          {activeFilterCount > 0 ? `Filters +${activeFilterCount}` : 'Filters'}
        </Text>
      </Pressable>
    </View>
  )
}

// Fast Refresh-safe: tokens static, colors inline via useTheme()
const createStyles = createStyleSheet((theme) => ({
  // `xl` (16) is the one gutter for the whole panel, shared with the header and the
  // request rows (2px severity stripe + 14 content padding also lands text at 16).
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    height: theme.controlHeight.bar,
    paddingLeft: theme.spacing.xl,
    paddingRight: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: theme.fontSize.md,
  },
  searchDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20, // ui-token-check-ignore: search-bar divider rule
    marginLeft: theme.spacing.xs,
  },
  filtersTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    alignSelf: 'stretch',
    paddingHorizontal: theme.spacing.md,
  },
  filtersTriggerText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  barButton: {
    width: theme.controlHeight.icon,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
}))
