/** BreakpointsRuleList — the active-breakpoints list (and its empty state) in BreakpointsPanel. */
import type { Breakpoint } from 'hakka-core'
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { MethodChip } from '../components/Badge'
import { Trash2 } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'

export interface BreakpointsRuleListProps {
  rules: Breakpoint[]
  onToggle: (rule: Breakpoint) => void
  onRemove: (id: string) => void
  onClearAll: () => void
}

export function BreakpointsRuleList({ rules, onToggle, onRemove, onClearAll }: BreakpointsRuleListProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  if (rules.length === 0) {
    return (
      <View style={styles.emptySection}>
        <Text style={[styles.emptyText, { color: colors.textSubtle }]}>
          No breakpoints. Add one above to pause matching requests.
        </Text>
        <Text style={[styles.emptyNote, { color: colors.textSubtle }]}>
          Breakpoints pause fetch / XHR calls before they reach the network. You can then inspect the request, edit the
          URL or body, and either Resume (forwarding your edits) or Abort (failing the request). Everything runs
          in-process — no proxy or certificate needed.
        </Text>
      </View>
    )
  }

  return (
    <View style={[styles.section, { borderBottomColor: colors.border }]}>
      <View style={styles.rulesHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>ACTIVE BREAKPOINTS ({rules.length})</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all breakpoints"
          onPress={onClearAll}
          style={({ pressed }) => pressed && { opacity: 0.74 }}
        >
          <Trash2 size={15} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.rulesList}>
        {rules.map((rule) => (
          <View
            key={rule.id}
            style={[
              styles.ruleCard,
              {
                backgroundColor: colors.backgroundAlt,
                borderColor: colors.border,
                opacity: rule.enabled ? 1 : 0.5,
              },
            ]}
          >
            <View style={styles.ruleTopRow}>
              <MethodChip method={rule.method ?? 'ANY'} width={46} />
              <Text style={[styles.rulePattern, { color: colors.text }]} numberOfLines={1} ellipsizeMode="middle">
                {rule.pattern}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove breakpoint ${rule.id}`}
                onPress={() => onRemove(rule.id)}
                style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.74 }]}
              >
                <Text style={[styles.removeBtnText, { color: colors.textMuted }]}>×</Text>
              </Pressable>
            </View>

            <View style={styles.ruleBottomRow}>
              <Text style={[styles.rulePhase, { color: colors.textSubtle }]}>pauses on {rule.on}</Text>
              <View style={styles.ruleToggleSpacer} />
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: rule.enabled }}
                accessibilityLabel={rule.enabled ? 'Disable breakpoint' : 'Enable breakpoint'}
                onPress={() => onToggle(rule)}
                style={[styles.toggleTrack, { backgroundColor: rule.enabled ? colors.success : colors.border }]}
              >
                <View style={[styles.toggleKnob, { transform: [{ translateX: rule.enabled ? 16 : 2 }] }]} />
              </Pressable>
            </View>
          </View>
        ))}
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
  rulesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rulesList: {
    gap: theme.spacing.sm,
  },
  ruleCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  ruleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  rulePattern: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
  },
  removeBtn: {
    width: theme.controlHeight.icon,
    height: theme.controlHeight.icon,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeBtnText: {
    fontSize: theme.fontSize.xxl,
    lineHeight: 20,
  },
  ruleBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rulePhase: {
    fontSize: theme.fontSize.xs,
  },
  ruleToggleSpacer: {
    flex: 1,
  },
  toggleTrack: {
    width: 40,
    height: theme.controlHeight.chip,
    borderRadius: theme.controlHeight.chip / 2,
    justifyContent: 'center',
  },
  toggleKnob: {
    width: 18,
    height: theme.controlHeight.badge,
    borderRadius: theme.controlHeight.badge / 2,
    backgroundColor: '#fff',
    position: 'absolute',
  },
  emptySection: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
  },
  emptyNote: {
    fontSize: theme.fontSize.xs,
    fontStyle: 'italic',
    lineHeight: 17,
  },
}))
