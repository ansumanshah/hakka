/**
 * BreakpointsPanel — manage request breakpoints and edit paused requests.
 * Mirrors web BreakpointsTab (packages/hakka-browser/src/ui/BreakpointsTab.tsx).
 * Uses breakpointEngine from hakka-core; runs in-process, no proxy/certificate.
 */
import { breakpointEngine } from 'hakka-core'
import type { Breakpoint, BreakpointPhase, PausedRequest, PausedResponse } from 'hakka-core'
import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ArrowLeft, Pause } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import { BreakpointsAddForm, type MethodOption } from './BreakpointsAddForm'
import { PausedCard } from './BreakpointsPausedCard'
import { BreakpointsRuleList } from './BreakpointsRuleList'

export interface BreakpointsPanelProps {
  onClose: () => void
  /** Hide the panel's own back/title header — used when embedded under the
   * merged Rules screen's shared header + segmented switch. Default true. */
  showHeader?: boolean
}

export const BreakpointsPanel: React.FC<BreakpointsPanelProps> = ({ onClose, showHeader = true }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const [rules, setRules] = useState<Breakpoint[]>(() => breakpointEngine.getBreakpoints())
  const [paused, setPaused] = useState(() => breakpointEngine.getPaused())

  const [pattern, setPattern] = useState('')
  const [method, setMethod] = useState<MethodOption>('ANY')
  const [phase, setPhase] = useState<BreakpointPhase>('request')

  useEffect(() => {
    const refresh = () => {
      setRules(breakpointEngine.getBreakpoints())
      setPaused(breakpointEngine.getPaused())
    }
    const off = breakpointEngine.subscribe(refresh)
    return off
  }, [])

  const handleAdd = useCallback(() => {
    const p = pattern.trim()
    if (!p) return
    breakpointEngine.addBreakpoint({
      pattern: p,
      method: method === 'ANY' ? undefined : method,
      on: phase,
      enabled: true,
    })
    setPattern('')
    setMethod('ANY')
    setPhase('request')
  }, [pattern, method, phase])

  const handleToggle = useCallback((rule: Breakpoint) => {
    breakpointEngine.setEnabled(rule.id, !rule.enabled)
  }, [])

  const handleRemove = useCallback((id: string) => {
    Alert.alert('Remove Breakpoint', 'Remove this breakpoint?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => breakpointEngine.removeBreakpoint(id) },
    ])
  }, [])

  const handleClearAll = useCallback(() => {
    Alert.alert('Clear All', 'Remove all breakpoints?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => breakpointEngine.clearBreakpoints() },
    ])
  }, [])

  const handleResume = useCallback((pauseId: string, edits: Partial<PausedRequest> | Partial<PausedResponse>) => {
    breakpointEngine.resume(pauseId, edits)
  }, [])

  const handleAbort = useCallback((pauseId: string) => {
    breakpointEngine.abort(pauseId)
  }, [])

  const addEnabled = pattern.trim().length > 0

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {showHeader && (
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.backButton}>
            <ArrowLeft size={20} color={colors.textMuted} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Breakpoints</Text>
          <View style={styles.headerRight} />
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Paused section — shown first when requests are held */}
        {paused.length > 0 && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <View style={styles.pausedHeader}>
              <Pause size={14} color={colors.warning} />
              <Text style={[styles.pausedTitle, { color: colors.warning }]}>Paused ({paused.length})</Text>
            </View>
            <Text style={[styles.sectionNote, { color: colors.textSubtle }]}>
              Requests are held until you Resume or Abort. Edit URL or body before resuming.
            </Text>
            <View style={styles.pausedList}>
              {paused.map((entry) => (
                <PausedCard key={entry.id} entry={entry} onResume={handleResume} onAbort={handleAbort} />
              ))}
            </View>
          </View>
        )}

        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>BREAKPOINTS</Text>
          <Text style={[styles.sectionNote, { color: colors.textSubtle }]}>
            Pause matching requests before they're sent so you can inspect, edit, or abort them. Runs in-process — no
            proxy or certificate required.
          </Text>
        </View>

        <BreakpointsAddForm
          pattern={pattern}
          method={method}
          phase={phase}
          addEnabled={addEnabled}
          onPatternChange={setPattern}
          onMethodChange={setMethod}
          onPhaseChange={setPhase}
          onAdd={handleAdd}
        />

        <BreakpointsRuleList
          rules={rules}
          onToggle={handleToggle}
          onRemove={handleRemove}
          onClearAll={handleClearAll}
        />
      </ScrollView>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: theme.layout.scrollBottomInset,
  },
  section: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionNote: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  pausedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  pausedTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.bold,
  },
  pausedList: {
    gap: theme.spacing.md,
  },
}))
