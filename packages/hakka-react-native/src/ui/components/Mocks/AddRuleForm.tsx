/**
 * AddRuleForm — the "New Rule" form panel rendered above the rule list when
 * "+ Add Rule" is toggled. Mock mode fills in a fixed response; rewrite mode
 * sends the real request and transforms the response via the fields below.
 */
import { FlashList } from '@shopify/flash-list'
import React, { useCallback } from 'react'
import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'

import { useTheme } from '../../styles'
import { createStyleSheet } from '../../styles/createStyleSheet'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']

export type RuleMode = 'mock' | 'rewrite'

export interface AddRuleFormState {
  pattern: string
  method: string
  status: string
  body: string
  delay: string
  mode: RuleMode
  /** rewrite: override status (blank = keep real status) */
  rewriteStatus: string
  /** rewrite: replacement body (blank = keep real body) */
  rewriteBody: string
}

export const DEFAULT_FORM: AddRuleFormState = {
  pattern: '',
  method: 'ANY',
  status: '200',
  body: '{}',
  delay: '0',
  mode: 'mock',
  rewriteStatus: '',
  rewriteBody: '',
}

type FormStyles = ReturnType<typeof createStyles>
type FormColors = ReturnType<typeof useTheme>['colors']

const MethodChip = React.memo(function MethodChip({
  method,
  selected,
  backgroundColor,
  textColor,
  methodChipStyle,
  methodChipTextStyle,
  onSelect,
}: {
  method: string
  selected: boolean
  backgroundColor: string
  textColor: string
  methodChipStyle: StyleProp<ViewStyle>
  methodChipTextStyle: StyleProp<TextStyle>
  onSelect: (method: string) => void
}) {
  const handlePress = useCallback(() => onSelect(method), [method, onSelect])

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[methodChipStyle, { backgroundColor }]}
      onPress={handlePress}
    >
      <Text style={[methodChipTextStyle, { color: textColor }]}>{method}</Text>
    </Pressable>
  )
})

interface ModeToggleProps {
  mode: RuleMode
  styles: FormStyles
  colors: FormColors
  onChangeMode: (mode: RuleMode) => void
}

const ModeToggle = React.memo(function ModeToggle({ mode, styles, colors, onChangeMode }: ModeToggleProps) {
  const handleMock = useCallback(() => onChangeMode('mock'), [onChangeMode])
  const handleRewrite = useCallback(() => onChangeMode('rewrite'), [onChangeMode])

  return (
    <View style={styles.modeToggleRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: mode === 'mock' }}
        style={[
          styles.modeTab,
          { borderColor: colors.border },
          mode === 'mock' && { backgroundColor: colors.accent, borderColor: colors.accent },
        ]}
        onPress={handleMock}
      >
        <Text style={[styles.modeTabText, { color: mode === 'mock' ? colors.background : colors.textMuted }]}>
          Mock
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: mode === 'rewrite' }}
        style={[
          styles.modeTab,
          { borderColor: colors.border },
          mode === 'rewrite' && { backgroundColor: colors.warning, borderColor: colors.warning },
        ]}
        onPress={handleRewrite}
      >
        <Text style={[styles.modeTabText, { color: mode === 'rewrite' ? colors.background : colors.textMuted }]}>
          Rewrite
        </Text>
      </Pressable>
    </View>
  )
})

export interface AddRuleFormProps {
  form: AddRuleFormState
  onAddRule: () => void
  onFieldChange: (field: keyof AddRuleFormState, value: string) => void
}

export const AddRuleForm = React.memo(function AddRuleForm({ form, onAddRule, onFieldChange }: AddRuleFormProps) {
  const theme = useTheme()
  const { colors } = theme
  const styles = createStyles(theme)

  const handleSelectMethod = useCallback((method: string) => onFieldChange('method', method), [onFieldChange])
  const handleChangeMode = useCallback((m: RuleMode) => onFieldChange('mode', m), [onFieldChange])

  const renderMethodItem = useCallback(
    ({ item: method }: { item: string }) => {
      const selected = form.method === method

      return (
        <MethodChip
          method={method}
          selected={selected}
          backgroundColor={selected ? colors.accent : colors.border}
          textColor={selected ? colors.background : colors.textMuted}
          methodChipStyle={styles.methodChip}
          methodChipTextStyle={styles.methodChipText}
          onSelect={handleSelectMethod}
        />
      )
    },
    [
      colors.background,
      colors.border,
      colors.accent,
      colors.textMuted,
      form.method,
      handleSelectMethod,
      styles.methodChip,
      styles.methodChipText,
    ],
  )

  const handlePatternChange = useCallback((value: string) => onFieldChange('pattern', value), [onFieldChange])
  const handleStatusChange = useCallback((value: string) => onFieldChange('status', value), [onFieldChange])
  const handleDelayChange = useCallback((value: string) => onFieldChange('delay', value), [onFieldChange])
  const handleBodyChange = useCallback((value: string) => onFieldChange('body', value), [onFieldChange])
  const handleRewriteStatusChange = useCallback(
    (value: string) => onFieldChange('rewriteStatus', value),
    [onFieldChange],
  )
  const handleRewriteBodyChange = useCallback((value: string) => onFieldChange('rewriteBody', value), [onFieldChange])

  const isMock = form.mode === 'mock'

  return (
    <View style={[styles.form, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
      <Text style={[styles.formTitle, { color: colors.text }]}>New Rule</Text>

      <Text style={[styles.label, { color: colors.textMuted }]}>Mode</Text>
      <ModeToggle mode={form.mode} styles={styles} colors={colors} onChangeMode={handleChangeMode} />
      {!isMock && (
        <Text style={[styles.modeHint, { color: colors.textSubtle }]}>
          Rewrite: real request is sent, then the response is transformed by the fields below.
        </Text>
      )}

      <Text style={[styles.label, { color: colors.textMuted }]}>URL Pattern (substring or exact)</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        value={form.pattern}
        onChangeText={handlePatternChange}
        placeholder="e.g. /api/users or https://example.com/api"
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.label, { color: colors.textMuted }]}>HTTP Method</Text>
      <FlashList
        horizontal
        data={HTTP_METHODS}
        keyExtractor={(method) => method}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.methodRow}
        renderItem={renderMethodItem}
      />

      {isMock ? (
        <>
          <Text style={[styles.label, { color: colors.textMuted }]}>Status Code</Text>
          <TextInput
            style={[
              styles.input,
              styles.inputSmall,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
            ]}
            value={form.status}
            onChangeText={handleStatusChange}
            keyboardType="number-pad"
            placeholder="200"
            placeholderTextColor={colors.textSubtle}
          />

          <Text style={[styles.label, { color: colors.textMuted }]}>Delay (ms, optional)</Text>
          <TextInput
            style={[
              styles.input,
              styles.inputSmall,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
            ]}
            value={form.delay}
            onChangeText={handleDelayChange}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.textSubtle}
          />

          <Text style={[styles.label, { color: colors.textMuted }]}>Response Body (JSON or string)</Text>
          <TextInput
            style={[
              styles.input,
              styles.inputBody,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
            ]}
            value={form.body}
            onChangeText={handleBodyChange}
            multiline
            placeholder='{ "message": "mocked" }'
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: colors.textMuted }]}>Override Status Code (blank = keep real)</Text>
          <TextInput
            style={[
              styles.input,
              styles.inputSmall,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
            ]}
            value={form.rewriteStatus}
            onChangeText={handleRewriteStatusChange}
            keyboardType="number-pad"
            placeholder="e.g. 200"
            placeholderTextColor={colors.textSubtle}
          />

          <Text style={[styles.label, { color: colors.textMuted }]}>Replace Body (blank = keep real body)</Text>
          <TextInput
            style={[
              styles.input,
              styles.inputBody,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
            ]}
            value={form.rewriteBody}
            onChangeText={handleRewriteBodyChange}
            multiline
            placeholder='{ "injected": true }'
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}

      <Pressable
        accessibilityRole="button"
        style={[styles.submitButton, { backgroundColor: isMock ? colors.success : colors.warning }]}
        onPress={onAddRule}
      >
        <Text style={[styles.submitButtonText, { color: colors.background }]}>
          {isMock ? 'Add Mock Rule' : 'Add Rewrite Rule'}
        </Text>
      </Pressable>
    </View>
  )
})

const createStyles = createStyleSheet(({ spacing, radius, fontSize }) => ({
  form: {
    margin: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  formTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  modeTab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  modeTabText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  modeHint: {
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
  },
  inputSmall: {
    width: 120,
  },
  inputBody: {
    minHeight: 80, // ui-token-check-ignore: multi-line mock body input
    textAlignVertical: 'top',
    fontFamily: 'Courier New',
    fontSize: fontSize.sm,
  },
  methodRow: {
    flexDirection: 'row',
    marginVertical: spacing.sm,
  },
  methodChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.xl,
    marginRight: spacing.sm,
  },
  methodChipText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  submitButton: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  submitButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
}))
