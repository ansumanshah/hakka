/**
 * RulesPanel — Mock, Breakpoints and Throttle under one tab.
 *
 * All three shape traffic before it reaches the app, so they share a
 * segmented switcher instead of spending three top-level tabs (mirrors web's
 * RulesTab.tsx). The active section is local state — it does not persist
 * across the panel closing/reopening.
 */
import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Segmented } from '../components/primitives'
import { ArrowLeft } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import { BreakpointsPanel } from './BreakpointsPanel'
import { Mocks } from './Mocks'
import { ThrottlePanel } from './ThrottlePanel'

type RulesSection = 'mock' | 'breakpoints' | 'throttle'

const SECTIONS = [
  { id: 'mock', label: 'Mock' },
  { id: 'breakpoints', label: 'Breakpoints' },
  { id: 'throttle', label: 'Throttle' },
] as const satisfies readonly { id: RulesSection; label: string }[]

export interface RulesPanelProps {
  onClose: () => void
  /** False when the inspector shell renders its persistent tab strip above this
   * page — the page then owns no back button and no title of its own. */
  showHeader?: boolean
}

export const RulesPanel: React.FC<RulesPanelProps> = ({ onClose, showHeader = true }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const [section, setSection] = useState<RulesSection>('mock')

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {showHeader && (
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close rules panel"
            onPress={onClose}
            style={styles.backButton}
          >
            <ArrowLeft size={20} color={colors.textMuted} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Rules</Text>
          <View style={styles.headerRight} />
        </View>
      )}

      <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
        <Segmented
          items={SECTIONS}
          value={section}
          accessibilityLabel="Rule type"
          testIDPrefix="hakka-rules-seg"
          onChange={(id) => setSection(id)}
        />
      </View>

      {section === 'mock' && <Mocks showTitle={false} />}
      {section === 'breakpoints' && <BreakpointsPanel onClose={onClose} showHeader={false} />}
      {section === 'throttle' && <ThrottlePanel onClose={onClose} showHeader={false} />}
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
  headerRight: {
    width: 40,
  },
  switchRow: {
    paddingHorizontal: theme.spacing.lg,
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
