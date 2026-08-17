import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ArrowDown, ArrowUp, X } from '../icons'
import { controlHeight, createStyleSheet, fontSize, useTheme } from '../styles'
import type { FilterSnapshot, SavedFilter } from '../utils/filterPersist'
import { type GroupBy, type SortBy, type SortDir } from '../utils/groupSort'
import { Badge, getStatusGroupColors } from './Badge'
import { Chip } from './Chip'

export interface FiltersDisclosureProps {
  statusGroup: 'all' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
  onStatusGroupChange: (group: 'all' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx') => void
  domains: string[]
  selectedDomains: Set<string>
  onDomainToggle?: (domain: string) => void
  nlMode: boolean
  onNlModeToggle?: (enabled: boolean) => void
  searchInBody: boolean
  onSearchInBodyToggle?: (enabled: boolean) => void
  groupBy: GroupBy
  onGroupByChange?: (value: GroupBy) => void
  sortBy: SortBy
  onSortByChange?: (value: SortBy) => void
  sortDesc: boolean
  onSortToggle: () => void
  sortDir?: SortDir
  onSortDirToggle?: () => void
  savedFilters: SavedFilter[]
  recentFilters: FilterSnapshot[]
  onSaveFilter?: () => void
  onApplyFilter?: (snapshot: FilterSnapshot) => void
  onRemoveSavedFilter?: (name: string) => void
  selectMode: boolean
  onSelectModeToggle?: () => void
  isDirty: boolean
  onReset: () => void
}

const STATUS_GROUPS = ['all', '1xx', '2xx', '3xx', '4xx', '5xx'] as const
const CHIP_HEIGHT = controlHeight.chip // matches the always-visible method row above

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'host', label: 'Host' },
  { value: 'status-class', label: 'Status' },
  { value: 'method', label: 'Method' },
]

const SORT_BY_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'time', label: 'Time' },
  { value: 'duration', label: 'Duration' },
  { value: 'size', label: 'Size' },
  { value: 'status', label: 'Status' },
]

/** Disclosure: inline expand, one filter surface, one open/closed state. Every
 * control here is the same chip (24pt, 4pt radius, hairline border, transparent
 * at rest, tone-tinted when active) — don't introduce a second chip system. */
export function FiltersDisclosure({
  statusGroup,
  onStatusGroupChange,
  domains,
  selectedDomains,
  onDomainToggle,
  nlMode,
  onNlModeToggle,
  searchInBody,
  onSearchInBodyToggle,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
  sortDesc,
  onSortToggle,
  sortDir,
  onSortDirToggle,
  savedFilters,
  recentFilters,
  onSaveFilter,
  onApplyFilter,
  onRemoveSavedFilter,
  selectMode,
  onSelectModeToggle,
  isDirty,
  onReset,
}: FiltersDisclosureProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  // Effective sort direction: when sortBy='time', use legacy sortDesc; otherwise use sortDir
  const effectiveSortDesc = sortBy === 'time' ? sortDesc : sortDir === 'desc'

  const renderDomain = React.useCallback(
    ({ item: domain }: { item: string }) => (
      <Chip label={domain} active={selectedDomains.has(domain)} onPress={() => onDomainToggle?.(domain)} />
    ),
    [onDomainToggle, selectedDomains],
  )
  const renderStatusChip = React.useCallback(
    ({ item: group }: { item: (typeof STATUS_GROUPS)[number] }) => {
      const isActive = statusGroup === group
      const badgeColors = getStatusGroupColors(group, colors)
      // Quiet at rest (graphite text, default border); active adds status-tone text,
      // ~40% opacity border (the `66` hex suffix), ~10% tint fill (the `1A` suffix).
      // Tapping the active chip clears back to 'all' — matches web's status chip row.
      return (
        <Pressable
          onPress={() => onStatusGroupChange(isActive ? 'all' : group)}
          style={({ pressed }) => pressed && { opacity: 0.7 }}
        >
          <Badge
            text={group.toUpperCase()}
            backgroundColor={isActive ? badgeColors.bg + '1A' : 'transparent'}
            textColor={isActive ? badgeColors.bg : colors.textSubtle}
            fontSize={fontSize.xs}
            height={CHIP_HEIGHT}
            style={{
              borderWidth: 1,
              borderColor: isActive ? badgeColors.bg + '66' : colors.border,
              borderRadius: theme.radius.sm,
            }}
          />
        </Pressable>
      )
    },
    [colors, onStatusGroupChange, statusGroup, theme.radius.sm],
  )

  const handleSortDirToggle = React.useCallback(() => {
    if (sortBy === 'time') {
      onSortToggle()
    } else {
      onSortDirToggle?.()
    }
  }, [onSortDirToggle, onSortToggle, sortBy])

  return (
    <View style={[styles.disclosure, { borderTopColor: colors.border }]}>
      <ControlRow label="STATUS" styles={styles} color={colors.textSubtle}>
        {STATUS_GROUPS.filter((g) => g !== 'all').map((group) => (
          <View key={group}>{renderStatusChip({ item: group })}</View>
        ))}
      </ControlRow>

      {/* Domain picker — folds into the disclosure rather than a permanent
          chrome row; the search bar's own `host:` token does the same job. */}
      {domains.length > 0 && (
        <ControlRow label="DOMAIN" styles={styles} color={colors.textSubtle} scroll>
          {domains.map((domain) => (
            <View key={domain}>{renderDomain({ item: domain })}</View>
          ))}
        </ControlRow>
      )}

      <ControlRow label="SEARCH" styles={styles} color={colors.textSubtle}>
        {onNlModeToggle && <Chip label="Natural language" active={nlMode} onPress={() => onNlModeToggle(!nlMode)} />}
        <Chip label="Include bodies" active={searchInBody} onPress={() => onSearchInBodyToggle?.(!searchInBody)} />
      </ControlRow>

      {onGroupByChange && (
        <ControlRow label="GROUP" styles={styles} color={colors.textSubtle}>
          {GROUP_BY_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              active={groupBy === opt.value}
              onPress={() => onGroupByChange(opt.value)}
            />
          ))}
        </ControlRow>
      )}

      {onSortByChange && (
        <ControlRow label="SORT" styles={styles} color={colors.textSubtle}>
          {SORT_BY_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              active={sortBy === opt.value}
              onPress={() => onSortByChange(opt.value)}
            />
          ))}
          {/* Direction sits with the field it orders, not three rows away
              under "SEARCH". */}
          <Chip
            label={effectiveSortDesc ? 'Desc' : 'Asc'}
            accessibilityLabel={effectiveSortDesc ? 'Sorting descending' : 'Sorting ascending'}
            icon={
              effectiveSortDesc ? (
                <ArrowDown size={10} color={theme.colors.textSubtle} />
              ) : (
                <ArrowUp size={10} color={theme.colors.textSubtle} />
              )
            }
            active={false}
            onPress={handleSortDirToggle}
          />
        </ControlRow>
      )}

      {(onSaveFilter || savedFilters.length > 0 || recentFilters.length > 0) && (
        <ControlRow label="PRESETS" styles={styles} color={colors.textSubtle} scroll>
          {onSaveFilter && <Chip label="Save current" onPress={onSaveFilter} />}
          {savedFilters.map((sf) => (
            <View key={sf.name} style={styles.savedEntry}>
              <Chip label={sf.name} active onPress={() => onApplyFilter?.(sf.snapshot)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove saved filter ${sf.name}`}
                onPress={() => onRemoveSavedFilter?.(sf.name)}
                style={({ pressed }) => pressed && { opacity: 0.5 }}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                <X size={11} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          {recentFilters.map((rf, i) => (
            <Chip
              key={`recent-${i}`}
              label={rf.query || `${rf.statusGroup} ${rf.methodFilters.join(',')}`}
              onPress={() => onApplyFilter?.(rf)}
            />
          ))}
        </ControlRow>
      )}

      {/* Footer — the two things that act on the whole surface rather than
          on one facet of it. */}
      <View style={[styles.disclosureFooter, { borderTopColor: colors.border }]}>
        {onSelectModeToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: selectMode }}
            accessibilityLabel="Select multiple requests"
            onPress={onSelectModeToggle}
            style={({ pressed }) => pressed && { opacity: 0.5 }}
          >
            <Text style={[styles.footerAction, { color: selectMode ? colors.accent : colors.textMuted }]}>
              {selectMode ? 'Done selecting' : 'Select multiple'}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset all filters"
          testID="hakka-filters-reset"
          disabled={!isDirty}
          onPress={onReset}
          style={({ pressed }) => pressed && { opacity: 0.5 }}
        >
          <Text style={[styles.footerAction, { color: isDirty ? colors.accent : colors.textSubtle }]}>Reset</Text>
        </Pressable>
      </View>
    </View>
  )
}

interface ControlRowProps {
  label: string
  color: string
  /** Horizontally scroll the chips instead of wrapping — for open-ended sets (domains, presets). */
  scroll?: boolean
  styles: ReturnType<typeof createStyles>
  children: React.ReactNode
}

/** `LABEL  [chips]`. A fixed label column keeps the disclosure compact — six
 * stacked caption-over-content sections would be ~380pt, more than the medium
 * detent has to spare once the request list is accounted for. */
function ControlRow({ label, color, scroll = false, styles, children }: ControlRowProps) {
  return (
    <View style={styles.controlRow}>
      <Text style={[styles.controlLabel, { color }]}>{label}</Text>
      {scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.chipRow}>{children}</View>
      )}
    </View>
  )
}

// Fast Refresh-safe: tokens static, colors inline via useTheme()
const createStyles = createStyleSheet((theme) => ({
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingLeft: theme.spacing.xl,
    paddingRight: theme.spacing.xl,
    paddingBottom: theme.spacing.ml,
  },
  disclosure: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.spacing.md,
  },
  disclosureFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: theme.spacing.xl,
    paddingRight: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerAction: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  controlLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.5,
    // Wide enough for the longest row label ("PRESETS") without wrapping.
    width: 58,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  savedEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xxs,
  },
}))
