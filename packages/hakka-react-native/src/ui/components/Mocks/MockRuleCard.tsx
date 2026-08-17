/**
 * MockRuleCard — one row in the rule list: pattern, mode/status badges, body
 * preview, enable switch, delete. `EmptyRules` is the list's empty state.
 *
 * `getMethodColor` here is intentionally local, not the shared
 * `utils/statusColors.ts` helper — that helper requires a non-optional
 * `method` and falls back to `colors.methodOther`, while mock rules can have
 * an undefined method (the "ANY" case) and fall back to `colors.textMuted`.
 */
import type { MockRule } from 'hakka-core'
import React, { useCallback } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useTheme } from '../../styles'
import { createStyleSheet } from '../../styles/createStyleSheet'

function getMethodColor(method: string | undefined, colors: ReturnType<typeof useTheme>['colors']): string {
  switch (method?.toUpperCase()) {
    case 'GET':
      return colors.methodGet
    case 'POST':
      return colors.methodPost
    case 'PUT':
      return colors.methodPut
    case 'PATCH':
      return colors.methodPatch
    case 'DELETE':
      return colors.methodDelete
    default:
      return colors.textMuted
  }
}

export interface MockRuleCardProps {
  rule: MockRule
  onToggleRule: (id: string, enabled: boolean) => void
  onDeleteRule: (id: string) => void
}

export const MockRuleCard = React.memo(function MockRuleCard({ rule, onToggleRule, onDeleteRule }: MockRuleCardProps) {
  const theme = useTheme()
  const { colors } = theme
  const styles = createStyles(theme)

  const handleToggle = useCallback(() => onToggleRule(rule.id, !rule.enabled), [onToggleRule, rule.enabled, rule.id])
  const handleDelete = useCallback(() => onDeleteRule(rule.id), [onDeleteRule, rule.id])

  const isRewrite = rule.mode === 'rewrite'

  return (
    <View style={[styles.ruleCard, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
      <View style={styles.ruleTop}>
        <View style={styles.ruleInfo}>
          <Text style={[styles.ruleMethod, { color: getMethodColor(rule.method, colors) }]}>
            {rule.method ?? 'ANY'}
          </Text>
          <Text style={[styles.rulePattern, { color: colors.text }]} numberOfLines={1}>
            {String(rule.pattern)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: rule.enabled }}
          onPress={handleToggle}
          style={[styles.switchTrack, { backgroundColor: rule.enabled ? colors.success : colors.border }]}
        >
          <View
            style={[
              styles.switchThumb,
              {
                backgroundColor: colors.background,
                alignSelf: rule.enabled ? 'flex-end' : 'flex-start',
              },
            ]}
          />
        </Pressable>
      </View>

      <View style={styles.ruleMeta}>
        <View style={[styles.modeBadge, { backgroundColor: isRewrite ? colors.warning : colors.accent }]}>
          <Text style={[styles.modeBadgeText, { color: colors.background }]}>{isRewrite ? 'REWRITE' : 'MOCK'}</Text>
        </View>
        <View
          style={[styles.statusBadge, { backgroundColor: rule.response.status < 400 ? colors.success : colors.error }]}
        >
          <Text style={[styles.statusBadgeText, { color: colors.background }]}>{rule.response.status}</Text>
        </View>
        {rule.response.delay ? (
          <Text style={[styles.ruleDelay, { color: colors.textMuted }]}>{rule.response.delay}ms</Text>
        ) : null}
        <Text style={[styles.hitCount, { color: colors.textSubtle }]}>
          {rule.hitCount} hit{rule.hitCount !== 1 ? 's' : ''}
        </Text>
      </View>

      {isRewrite ? (
        <Text style={[styles.bodyPreview, { color: colors.textSubtle, backgroundColor: colors.codeBackground }]}>
          {rule.response.body
            ? `body override: ${typeof rule.response.body === 'object' ? JSON.stringify(rule.response.body) : rule.response.body}`
            : 'body: (keep real response)'}
        </Text>
      ) : (
        <Text
          style={[styles.bodyPreview, { color: colors.textSubtle, backgroundColor: colors.codeBackground }]}
          numberOfLines={2}
        >
          {typeof rule.response.body === 'object' ? JSON.stringify(rule.response.body) : rule.response.body}
        </Text>
      )}

      <Pressable accessibilityRole="button" style={styles.deleteButton} onPress={handleDelete}>
        <Text style={[styles.deleteText, { color: colors.error }]}>Delete</Text>
      </Pressable>
    </View>
  )
})

export const EmptyRules = React.memo(function EmptyRules() {
  const theme = useTheme()
  const { colors } = theme
  const styles = createStyles(theme)

  return (
    <View style={styles.emptyState}>
      <Text style={[styles.emptyText, { color: colors.textMuted }]}>No mock rules yet.</Text>
      <Text style={[styles.emptySubtext, { color: colors.textSubtle }]}>Tap "+ Add Rule" to intercept a request.</Text>
    </View>
  )
})

const createStyles = createStyleSheet(({ spacing, radius, fontSize, controlHeight }) => ({
  emptyState: {
    padding: spacing.xxxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  ruleCard: {
    margin: spacing.xl,
    marginBottom: 0,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  ruleTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ruleInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginRight: spacing.md,
  },
  ruleMethod: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    minWidth: 36,
  },
  rulePattern: {
    flex: 1,
    fontSize: fontSize.sm,
    fontFamily: 'Courier New',
  },
  ruleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  modeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.sm,
  },
  modeBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  ruleDelay: {
    fontSize: fontSize.xs,
  },
  hitCount: {
    fontSize: fontSize.xs,
    marginLeft: 'auto',
  },
  bodyPreview: {
    fontSize: fontSize.xs,
    fontFamily: 'Courier New',
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  deleteButton: {
    alignSelf: 'flex-end',
    padding: spacing.sm,
  },
  deleteText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  switchTrack: {
    width: 40,
    height: controlHeight.chip,
    borderRadius: controlHeight.chip / 2,
    padding: spacing.xxs,
    justifyContent: 'center',
  },
  switchThumb: {
    width: 18,
    height: controlHeight.badge,
    borderRadius: controlHeight.badge / 2,
  },
}))
