/**
 * LogsTabView — Console and Structured logs under one tab, segmented instead
 * of spending two top-level tab slots — mirrors iOS's `LogsTabView.swift`,
 * web's `ConsoleTab.tsx`, and this package's own RulesPanel.tsx (same header
 * shape, same `showHeader={false}` convention on child panels).
 *
 * Active section is local state, not persisted across close/reopen — matches
 * RulesPanel and iOS (both default back to their first section on reopen).
 */
import { logStore } from 'hakka-core'
import React, { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Segmented } from '../components/primitives'
import { ArrowLeft, Trash2 } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import { lightImpact } from '../utils/haptics'
import { clearConsoleEntries, ConsolePanel } from './ConsolePanel'
import { LogsPanel } from './LogsPanel'

type LogsSection = 'console' | 'structured'

const SECTIONS = [
  { id: 'console', label: 'Console' },
  { id: 'structured', label: 'Structured' },
] as const satisfies readonly { id: LogsSection; label: string }[]

export interface LogsTabViewProps {
  onClose: () => void
  /** False when the inspector shell renders its persistent tab strip above this
   * page — the page then owns no back button and no title of its own. */
  showHeader?: boolean
}

export const LogsTabView: React.FC<LogsTabViewProps> = ({ onClose, showHeader = true }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const [section, setSection] = useState<LogsSection>('console')

  // Clear is contextual to the active section — one Clear action in the
  // shared header, not duplicated per section (DESIGN.md: one action, once).
  const handleClear = useCallback(() => {
    lightImpact()
    if (section === 'console') clearConsoleEntries()
    else logStore.clear()
  }, [section])

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
          <View style={styles.backButton} />
        </View>
      )}

      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Segmented
          items={SECTIONS}
          value={section}
          accessibilityLabel="Log source"
          testIDPrefix="hakka-logs-seg"
          onChange={(id) => setSection(id)}
        />
        {/* Lives on the segment row, not the page header — the inspector
            shell replaces the page header with the tab strip here. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={section === 'console' ? 'Clear console' : 'Clear structured logs'}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={handleClear}
          style={({ pressed }) => [styles.clearButton, pressed && { opacity: 0.5 }]}
        >
          <Trash2 size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      {section === 'console' && <ConsolePanel onClose={onClose} showHeader={false} />}
      {section === 'structured' && <LogsPanel onClose={onClose} showHeader={false} />}
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
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
  },
  seg: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: theme.spacing.xxs,
    padding: theme.spacing.xxs,
    borderWidth: 1,
    borderRadius: theme.radius.md,
  },
  segBtn: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.sm,
  },
  segText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
}))
