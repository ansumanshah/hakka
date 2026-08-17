import React from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Download, Settings, X } from '../icons'
import { createStyleSheet, useTheme } from '../styles'
import { NAV_ITEMS, type HeaderNavKey } from '../utils/headerNavItems'
import { TabStrip } from './TabStrip'

export type { HeaderNavKey }

/** Lifts the 28pt glyph buttons to a 44pt target without widening the row. */
const ICON_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const

export interface HeaderProps {
  isEnabled: boolean
  /** Which of the five tabs the shell is currently showing. */
  activeKey?: HeaderNavKey
  onClose?: () => void
  showCloseButton?: boolean
  onExport?: () => void
  showExportButton?: boolean
  onNetworkPress?: () => void
  onStatsPress?: () => void
  onRulesPress?: () => void
  onStoragePress?: () => void
  onAppLogsPress?: () => void
  /** Opens SettingsPanel — wired to the persistent header gear icon, not the
   * tab strip. The floating bubble's own gear-equivalent (SlidersHorizontal in
   * FloatingMonitorHud) calls the same handler from HakkaInspector.tsx; both
   * paths stay live. */
  onSettingsPress?: () => void
}

export function Header({
  isEnabled,
  activeKey = 'network',
  onClose,
  showCloseButton = false,
  onExport,
  showExportButton = true,
  onNetworkPress,
  onStatsPress,
  onRulesPress,
  onStoragePress,
  onAppLogsPress,
  onSettingsPress,
}: HeaderProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  // Persistent across all five tab pages; `activeKey` marks which is showing.
  // Tabs are lateral navigation, not drill-down — only Settings and the
  // request detail view push.
  const handleNavChange = React.useCallback(
    (key: HeaderNavKey) => {
      switch (key) {
        case 'network':
          return onNetworkPress?.()
        case 'stats':
          return onStatsPress?.()
        case 'rules':
          return onRulesPress?.()
        case 'storage':
          return onStoragePress?.()
        case 'appLogs':
          return onAppLogsPress?.()
      }
    },
    [onAppLogsPress, onNetworkPress, onRulesPress, onStatsPress, onStoragePress],
  )

  const navItems = NAV_ITEMS.filter((item) => {
    if (item.key === 'network') return true
    if (item.key === 'stats') return !!onStatsPress
    if (item.key === 'rules') return !!onRulesPress
    if (item.key === 'storage') return !!onStoragePress
    if (item.key === 'appLogs') return !!onAppLogsPress
    return false
  })

  return (
    <View style={[styles.container, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      {/* One row: tabs left, actions right. Only two actions fit — five mono
          tabs need ~270pt, leaving ~279pt on a 375pt phone after gutters, and
          a third button slices the last tab mid-word (STORAGE → STOR).
          Export is opt-in, off by default. */}
      <View style={styles.row2}>
        {navItems.length > 0 && (
          <View style={styles.navWrap}>
            <TabStrip items={navItems} activeKey={activeKey} onChange={handleNavChange} />
          </View>
        )}
        <View style={styles.actions}>
          {showExportButton && onExport && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export captured logs"
              hitSlop={ICON_HIT_SLOP}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.5 }]}
              onPress={onExport}
            >
              <Download size={15} color={colors.textMuted} />
            </Pressable>
          )}
          {onSettingsPress && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              testID="hakka-settings-button"
              hitSlop={ICON_HIT_SLOP}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.5 }]}
              onPress={onSettingsPress}
            >
              <Settings size={15} color={colors.textMuted} />
            </Pressable>
          )}
          {showCloseButton && onClose && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close network monitor"
              testID="hakka-inspector-close"
              hitSlop={ICON_HIT_SLOP}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.5 }]}
              onPress={onClose}
            >
              <X size={15} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Shown only when capture is stopped — paused is the exceptional state
          worth signalling; capturing (the default) needs no persistent cue. */}
      {!isEnabled && <View style={[styles.statusBorder, { backgroundColor: colors.error }]} />}
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    position: 'relative' as const,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // `xl` (16) matches the panel gutter shared with the filter bar and
  // request rows (2px stripe + 14 padding = 16), so edges line up.
  row2: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingLeft: theme.spacing.xl,
    paddingRight: theme.spacing.xl,
    // The sheet has no grabber above this row, so the header owns the whole
    // top inset itself.
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  navWrap: {
    flex: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: theme.spacing.xxs,
    alignItems: 'center' as const,
  },
  // Bare glyphs, no box — chips/boxes are for controls that carry state,
  // these are verbs. 28pt keeps them level with the 34pt tabs; hitSlop
  // restores the 44pt tap target.
  iconBtn: {
    width: theme.controlHeight.icon,
    height: theme.controlHeight.icon,
    borderRadius: theme.radius.md,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  statusBorder: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
}))
