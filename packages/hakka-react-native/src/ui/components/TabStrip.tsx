import React from 'react'
import { Pressable, ScrollView, Text } from 'react-native'

import { createStyleSheet, useTheme } from '../styles'

export interface TabStripItem<T extends string = string> {
  key: T
  label: string
}

export interface TabStripProps<T extends string = string> {
  items: readonly TabStripItem<T>[]
  /** Key of the active tab, or `null`/`undefined` when the strip is a launcher row with no persistent selection. */
  activeKey?: T | null
  onChange: (key: T) => void
}

/**
 * Mono, uppercase, letterspaced navigation strip with a flame underline for
 * the active tab — matches web's `.hakka-tabs` / `.hakka-tab` pattern.
 */
export function TabStrip<T extends string = string>({ items, activeKey = null, onChange }: TabStripProps<T>) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.track}
      // `flex: 1` is load-bearing — without it the strip overflows past its
      // box into the header's action buttons instead of clipping/scrolling.
      // No background fill is deliberate: a cut-off tab should read as
      // scrollable content, not a clipped panel with a hard seam.
      style={styles.scrollView}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${item.label} tab`}
            testID={`hakka-tab-${item.key}`}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => [
              styles.tab,
              { borderBottomColor: isActive ? colors.accent : 'transparent' },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.tabText, { color: isActive ? colors.accent : colors.textMuted }]}>{item.label}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const createStyles = createStyleSheet((theme) => ({
  scrollView: {
    flex: 1,
    overflow: 'hidden' as const,
  },
  track: {
    flexDirection: 'row' as const,
    alignItems: 'stretch' as const,
  },
  tab: {
    // height = `field` (36) incl. 2pt underline — same control-scale step as a field/button.
    height: theme.controlHeight.field - 2,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    // `sm` not `lg`: `lg` padding sliced "RULES" mid-word next to the action buttons.
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    fontFamily: 'monospace',
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
}))
