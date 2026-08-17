import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { ArrowDown, ArrowUp, Search, X } from '../../icons'
import { createStyleSheet, useTheme } from '../../styles'

export type TabType = 'overview' | 'request' | 'response' | 'timing' | 'graphql' | 'ws'

interface TabsProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  /** Show the GraphQL tab (only when the request is a detected GraphQL operation). */
  showGraphql?: boolean
  /** Show the WS Frames tab (only when the request is a WebSocket with messages). */
  showWsFrames?: boolean
  // Search props
  searchValue?: string
  onSearchChange?: (text: string) => void
  currentMatch?: number
  totalMatches?: number
  onNextMatch?: () => void
  onPrevMatch?: () => void
}

const TABS: { value: TabType; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'request', label: 'Request' },
  { value: 'response', label: 'Response' },
  { value: 'timing', label: 'Timing' },
]

export const Tabs: React.FC<TabsProps> = ({
  activeTab,
  onTabChange,
  showGraphql,
  showWsFrames,
  searchValue,
  onSearchChange,
  currentMatch,
  totalMatches,
  onNextMatch,
  onPrevMatch,
}) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme
  // Insert GraphQL after Response, WS Frames at the end, when present.
  let visibleTabs = showGraphql
    ? [...TABS.slice(0, 3), { value: 'graphql' as TabType, label: 'GraphQL' }, ...TABS.slice(3)]
    : [...TABS]
  if (showWsFrames) {
    visibleTabs = [...visibleTabs, { value: 'ws' as TabType, label: 'Frames' }]
  }
  const isSearchable = activeTab === 'overview' || activeTab === 'request' || activeTab === 'response'
  const hasMatches = totalMatches !== undefined && totalMatches > 0
  const hasQuery = Boolean(searchValue && searchValue.trim().length > 0)
  const showNav = hasMatches && hasQuery

  // Icon-only affordance that expands in place — a fixed-width "Search" text
  // label competes with 4 tab labels for the same row and clips at mobile
  // width. Starts expanded if a query is already active (e.g. tab switched
  // away and back) so an in-progress search isn't hidden without warning.
  const [expanded, setExpanded] = useState(() => hasQuery)

  const handleCollapse = () => setExpanded(false)
  const handleExpand = () => setExpanded(true)

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {!(expanded && isSearchable) && (
        <View style={styles.tabsWrapper}>
          {visibleTabs.map((tab) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.value }}
              accessibilityLabel={`${tab.label} tab`}
              key={tab.value}
              onPress={() => onTabChange(tab.value)}
              style={[styles.tab, activeTab === tab.value && { borderBottomColor: colors.accent }]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: colors.textMuted },
                  activeTab === tab.value && [styles.tabTextActive, { color: colors.accent }],
                ]}
              >
                {tab.label.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {isSearchable && expanded && (
        <View style={[styles.searchContainer, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
          <Search size={13} color={colors.textSubtle} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search"
            placeholderTextColor={colors.textSubtle}
            value={searchValue}
            onChangeText={onSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          {showNav && (
            <View style={styles.navContainer}>
              <Text style={[styles.matchCount, { color: colors.textSubtle }]}>
                {currentMatch}/{totalMatches}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous match"
                style={[styles.navBtn, { backgroundColor: colors.background }]}
                onPress={onPrevMatch}
                disabled={!hasMatches}
              >
                <ArrowUp size={14} color={colors.textMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next match"
                style={[styles.navBtn, { backgroundColor: colors.background }]}
                onPress={onNextMatch}
                disabled={!hasMatches}
              >
                <ArrowDown size={14} color={colors.textMuted} />
              </Pressable>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close search"
            style={styles.collapseBtn}
            onPress={handleCollapse}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={13} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      {isSearchable && !expanded && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasQuery ? `Search this tab, active query ${searchValue}` : 'Search this tab'}
          style={[
            styles.searchToggle,
            {
              backgroundColor: hasQuery ? colors.accent + '1A' : colors.backgroundAlt,
              borderColor: hasQuery ? colors.accent + '66' : colors.border,
            },
          ]}
          onPress={handleExpand}
        >
          <Search size={14} color={hasQuery ? colors.accent : colors.textMuted} />
        </Pressable>
      )}
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabsWrapper: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  tab: {
    paddingHorizontal: theme.spacing.ml,
    paddingVertical: theme.spacing.sm,
    backgroundColor: 'transparent',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    fontWeight: theme.fontWeight.semibold,
  },
  tabText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  tabTextActive: {
    fontWeight: theme.fontWeight.semibold,
  },
  // Icon-only, 44pt-compatible tap target via padding (visual glyph stays small).
  searchToggle: {
    width: theme.controlHeight.field,
    height: theme.controlHeight.field,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flex: 1,
    gap: theme.spacing.xs,
    paddingLeft: theme.spacing.sm,
    height: theme.controlHeight.field,
  },
  searchInput: {
    flex: 1,
    height: theme.controlHeight.field,
    paddingHorizontal: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
  },
  collapseBtn: {
    width: theme.controlHeight.icon,
    height: theme.controlHeight.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingRight: theme.spacing.xs,
  },
  matchCount: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    marginRight: theme.spacing.xs,
  },
  navBtn: {
    width: theme.controlHeight.chip,
    height: theme.controlHeight.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.sm,
  },
}))
