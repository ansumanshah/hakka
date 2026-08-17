/** BreakpointsAddForm — the "add breakpoint" pattern/method/phase form in BreakpointsPanel. */
import type { BreakpointPhase } from 'hakka-core'
import React from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'

export type MethodOption = 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const METHOD_OPTIONS: MethodOption[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const PHASE_OPTIONS: BreakpointPhase[] = ['request', 'response', 'both']

export interface BreakpointsAddFormProps {
  pattern: string
  method: MethodOption
  phase: BreakpointPhase
  addEnabled: boolean
  onPatternChange: (value: string) => void
  onMethodChange: (method: MethodOption) => void
  onPhaseChange: (phase: BreakpointPhase) => void
  onAdd: () => void
}

export function BreakpointsAddForm({
  pattern,
  method,
  phase,
  addEnabled,
  onPatternChange,
  onMethodChange,
  onPhaseChange,
  onAdd,
}: BreakpointsAddFormProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  return (
    <View style={[styles.section, { borderBottomColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>ADD BREAKPOINT</Text>

      <View>
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>URL pattern (substring)</Text>
        <TextInput
          accessibilityLabel="Breakpoint URL pattern"
          placeholder="/api/checkout"
          placeholderTextColor={colors.textMuted}
          value={pattern}
          onChangeText={onPatternChange}
          onSubmitEditing={onAdd}
          returnKeyType="done"
          style={[
            styles.patternInput,
            { backgroundColor: colors.backgroundAlt, borderColor: colors.border, color: colors.text },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View>
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Method</Text>
        <View style={styles.chipRow}>
          {METHOD_OPTIONS.map((m) => {
            const isActive = method === m
            return (
              <Pressable
                key={m}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`Select method ${m}`}
                onPress={() => onMethodChange(m)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: isActive ? colors.accent : colors.backgroundAlt,
                    borderColor: isActive ? colors.accent : colors.border,
                  },
                  pressed && { opacity: 0.74 },
                ]}
              >
                <Text style={[styles.chipText, { color: isActive ? '#fff' : colors.textMuted }]}>{m}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <View>
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Pause on</Text>
        <View style={styles.chipRow}>
          {PHASE_OPTIONS.map((p) => {
            const isActive = phase === p
            return (
              <Pressable
                key={p}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`Select phase ${p}`}
                onPress={() => onPhaseChange(p)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: isActive ? colors.accent : colors.backgroundAlt,
                    borderColor: isActive ? colors.accent : colors.border,
                  },
                  pressed && { opacity: 0.74 },
                ]}
              >
                <Text style={[styles.chipText, { color: isActive ? '#fff' : colors.textMuted }]}>{p}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={styles.addRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add breakpoint"
          disabled={!addEnabled}
          onPress={onAdd}
          style={({ pressed }) => [
            styles.addBtn,
            {
              backgroundColor: addEnabled ? colors.accent : colors.backgroundAlt,
              borderColor: addEnabled ? colors.accent : colors.border,
            },
            pressed && { opacity: 0.74 },
          ]}
        >
          <Text style={[styles.addBtnText, { color: addEnabled ? '#fff' : colors.textMuted }]}>Add</Text>
        </Pressable>
      </View>
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
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
  fieldLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  patternInput: {
    height: theme.controlHeight.field,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  chip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  addRow: {
    alignItems: 'flex-end',
  },
  addBtn: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
}))
