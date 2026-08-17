import { FlashList } from '@shopify/flash-list'
import type { MockRule, MockRuleInput } from 'hakka-core'
import { mockEngine } from 'hakka-core'
/**
 * Mocks Screen — manage mock rules for request interception. Mock mode
 * intercepts and returns a fixed response; rewrite mode sends the real
 * request and transforms the response.
 */
import React, { useCallback, useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'

import { saveMockRules } from '../../storage/mockStorage'
import { AddRuleForm, DEFAULT_FORM, type AddRuleFormState } from '../components/Mocks/AddRuleForm'
import { EmptyRules, MockRuleCard } from '../components/Mocks/MockRuleCard'
import { useSheetScrollable } from '../hooks/useSheetScrollable'
import { X } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import { lightImpact } from '../utils/haptics'

interface MocksProps {
  onClose?: () => void
  /** Hide the "Request Mocks" title — used when embedded under the merged
   * Rules screen's shared header + segmented switch. The Add Rule action
   * stays visible either way. Default true. */
  showTitle?: boolean
}

export const Mocks: React.FC<MocksProps> = ({ onClose, showTitle = true }) => {
  const theme = useTheme()
  const { colors } = theme
  const styles = createStyles(theme)
  const renderScrollComponent = useSheetScrollable()

  const [rules, setRules] = useState<MockRule[]>(() => mockEngine.getRules())
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState<AddRuleFormState>(DEFAULT_FORM)

  // MockEngine was hydrated from storage on init.
  const refreshRules = useCallback(() => {
    setRules(mockEngine.getRules())
  }, [])

  const persistRules = useCallback(async () => {
    await saveMockRules(mockEngine.serialize())
  }, [])

  const handleToggleRule = useCallback(
    (id: string, enabled: boolean) => {
      if (enabled) {
        mockEngine.enableRule(id)
      } else {
        mockEngine.disableRule(id)
      }
      refreshRules()
      persistRules()
    },
    [refreshRules, persistRules],
  )

  const handleDeleteRule = useCallback(
    (id: string) => {
      Alert.alert('Delete Rule', 'Remove this mock rule?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            mockEngine.removeRule(id)
            refreshRules()
            persistRules()
          },
        },
      ])
    },
    [refreshRules, persistRules],
  )

  const handleAddRule = useCallback(() => {
    const pattern = form.pattern.trim()
    if (!pattern) {
      Alert.alert('Validation', 'URL pattern is required.')
      return
    }

    const method = form.method === 'ANY' ? undefined : form.method

    if (form.mode === 'mock') {
      const status = parseInt(form.status, 10)
      if (isNaN(status) || status < 100 || status > 599) {
        Alert.alert('Validation', 'Status must be a valid HTTP code (100–599).')
        return
      }

      let parsedBody: string | object
      try {
        parsedBody = JSON.parse(form.body)
      } catch {
        parsedBody = form.body
      }

      const delay = parseInt(form.delay, 10)

      const rule: MockRuleInput = {
        pattern,
        method,
        mode: 'mock',
        response: {
          status,
          body: parsedBody,
          delay: isNaN(delay) || delay <= 0 ? undefined : delay,
        },
        enabled: true,
      }

      mockEngine.addRule(rule)
    } else {
      const overrideStatusRaw = form.rewriteStatus.trim()
      let overrideStatus: number
      if (overrideStatusRaw === '') {
        // no override — use a sentinel; the engine's rewriteResponse fn will keep the real status
        overrideStatus = 0
      } else {
        overrideStatus = parseInt(overrideStatusRaw, 10)
        if (isNaN(overrideStatus) || overrideStatus < 100 || overrideStatus > 599) {
          Alert.alert('Validation', 'Override status must be a valid HTTP code (100–599) or left blank.')
          return
        }
      }

      const bodyOverride = form.rewriteBody.trim()
      let parsedBodyOverride: string | object = bodyOverride
      if (bodyOverride) {
        try {
          parsedBodyOverride = JSON.parse(bodyOverride)
        } catch {
          parsedBodyOverride = bodyOverride
        }
      }

      const rule: MockRuleInput = {
        pattern,
        method,
        mode: 'rewrite',
        response: {
          // status 0 = sentinel meaning "keep real status" for UI-created rewrite rules
          status: overrideStatus,
          body: parsedBodyOverride,
        },
        rewriteResponse: (res) => ({
          ...res,
          status: overrideStatus > 0 ? overrideStatus : res.status,
          body: bodyOverride
            ? typeof parsedBodyOverride === 'object'
              ? JSON.stringify(parsedBodyOverride)
              : (parsedBodyOverride as string)
            : res.body,
        }),
        enabled: true,
      }

      mockEngine.addRule(rule)
    }

    lightImpact()
    refreshRules()
    persistRules()
    setForm(DEFAULT_FORM)
    setShowAddForm(false)
  }, [form, refreshRules, persistRules])

  const handleToggleAddForm = useCallback(() => setShowAddForm((value) => !value), [])

  const handleFieldChange = useCallback((field: keyof AddRuleFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }, [])

  const renderRule = useCallback(
    ({ item: rule }: { item: MockRule }) => (
      <MockRuleCard rule={rule} onToggleRule={handleToggleRule} onDeleteRule={handleDeleteRule} />
    ),
    [handleDeleteRule, handleToggleRule],
  )

  const listHeader = showAddForm ? (
    <AddRuleForm form={form} onAddRule={handleAddRule} onFieldChange={handleFieldChange} />
  ) : null

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {showTitle && <Text style={[styles.title, { color: colors.text }]}>Request Mocks</Text>}
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            style={[styles.addButton, { backgroundColor: colors.accent }]}
            onPress={handleToggleAddForm}
          >
            <Text style={[styles.addButtonText, { color: colors.background }]}>
              {showAddForm ? 'Cancel' : '+ Add Rule'}
            </Text>
          </Pressable>
          {onClose && (
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <X size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      <FlashList
        data={rules}
        keyExtractor={(rule) => rule.id}
        renderItem={renderRule}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={<EmptyRules />}
        keyboardShouldPersistTaps="handled"
        renderScrollComponent={renderScrollComponent}
      />
    </View>
  )
}

const createStyles = createStyleSheet(({ spacing, radius, fontSize }) => ({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  addButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  closeButton: {
    padding: spacing.sm,
  },
}))
