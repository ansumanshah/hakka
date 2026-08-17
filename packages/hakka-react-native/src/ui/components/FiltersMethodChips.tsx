import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { controlHeight, createStyleSheet, fontSize, useTheme } from '../styles'
import { Badge, getMethodColor } from './Badge'

export interface FiltersMethodChipsProps {
  methodFilters: Set<string>
  onMethodToggle: (method: string) => void
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const FILTER_BADGES = HTTP_METHODS.map((value) => ({ kind: 'method' as const, value }))

/** One chip height for the whole filter surface, sized against the 32pt search
 * field above it. Badge's 18pt default made the always-visible method row read
 * as a different, smaller control system than the field it sits under. */
const CHIP_HEIGHT = controlHeight.chip

/** Method chips, always visible — the one filter facet that doesn't hide
 * behind the "Filters +n" disclosure. */
export function FiltersMethodChips({ methodFilters, onMethodToggle }: FiltersMethodChipsProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const renderFilterBadge = React.useCallback(
    ({ item }: { item: (typeof FILTER_BADGES)[number] }) => {
      const isActive = methodFilters.has(item.value)
      const color = getMethodColor(item.value, colors)
      // Quiet at rest, same box language as the row's MethodChip badge — the
      // method color appears only once this chip is the active filter.
      return (
        <Pressable onPress={() => onMethodToggle(item.value)}>
          <Badge
            text={item.value}
            backgroundColor={isActive ? color + '1A' : 'transparent'}
            textColor={isActive ? color : colors.textSubtle}
            fontSize={fontSize.xs}
            height={CHIP_HEIGHT}
            minWidth={44}
            style={{
              borderWidth: 1,
              borderColor: isActive ? color + '66' : colors.border,
              borderRadius: theme.radius.sm,
            }}
          />
        </Pressable>
      )
    },
    [colors, methodFilters, onMethodToggle, theme.radius.sm],
  )

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickChips}>
      {FILTER_BADGES.map((item) => (
        <View key={item.value}>{renderFilterBadge({ item })}</View>
      ))}
    </ScrollView>
  )
}

// Fast Refresh-safe: tokens static, colors inline via useTheme()
const createStyles = createStyleSheet((theme) => ({
  quickChips: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
    paddingLeft: theme.spacing.xl,
    paddingRight: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
}))
