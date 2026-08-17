/**
 * Shared UI primitives — build pages out of these instead of restyling a bare
 * `View`. `scripts/ui-token-check.mjs` fails the build on raw numeric
 * literals in `src/ui` styles, so there's nowhere for a one-off to hide.
 *
 * `Chip` lives in ./Chip.tsx (predates this file, has more consumers).
 */
import React from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native'

import { createStyleSheet, useTheme } from '../styles'

export interface SectionTitleProps {
  children: string
}

/** Uppercase caption above a group. One type size, one gutter, everywhere. */
export const SectionTitle = React.memo(function SectionTitle({ children }: SectionTitleProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  return <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>{children}</Text>
})

export interface SectionProps {
  title?: string
  /** Draw a hairline under the section. */
  divided?: boolean
  style?: ViewStyle
  children: React.ReactNode
}

/** A gutter-aligned block, optionally captioned and rule-separated. */
export const Section = React.memo(function Section({ title, divided = false, style, children }: SectionProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  return (
    <View
      style={[
        styles.section,
        divided && { borderBottomColor: theme.colors.border },
        divided && styles.sectionDivided,
        style,
      ]}
    >
      {title ? <SectionTitle>{title}</SectionTitle> : null}
      {children}
    </View>
  )
})

export interface ToolbarProps {
  style?: ViewStyle
  children: React.ReactNode
}

/** A `controlHeight.bar` row at the page gutter with a bottom hairline — the
 * standard home for a page's search field and its inline actions. */
export const Toolbar = React.memo(function Toolbar({ style, children }: ToolbarProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  return <View style={[styles.toolbar, { borderBottomColor: theme.colors.border }, style]}>{children}</View>
})

export type FieldProps = React.ComponentProps<typeof TextInput> & { style?: ViewStyle }

/** Text input at `controlHeight.field`, with the one border/radius/type combo. */
export const Field = React.memo(function Field({ style, ...rest }: FieldProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  return (
    <TextInput
      placeholderTextColor={theme.colors.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
      style={[
        styles.field,
        { color: theme.colors.text, backgroundColor: theme.colors.background, borderColor: theme.colors.border },
        style,
      ]}
    />
  )
})

export type ButtonTone = 'primary' | 'secondary' | 'danger'

export interface ButtonProps {
  label: string
  accessibilityLabel?: string
  tone?: ButtonTone
  testID?: string
  disabled?: boolean
  style?: ViewStyle
  onPress: () => void
}

/** Text button at `controlHeight.field`, so it sits on the baseline of any
 * `Field` beside it. Three tones and no fourth. */
export const Button = React.memo(function Button({
  label,
  accessibilityLabel,
  tone = 'primary',
  testID,
  disabled = false,
  style,
  onPress,
}: ButtonProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const skin =
    tone === 'primary'
      ? { backgroundColor: colors.accent, borderColor: colors.accent, textColor: colors.background }
      : tone === 'danger'
        ? { backgroundColor: colors.chili + '14', borderColor: colors.chili + '4D', textColor: colors.chili }
        : { backgroundColor: colors.backgroundAlt, borderColor: colors.border, textColor: colors.text }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: skin.backgroundColor, borderColor: skin.borderColor },
        disabled && { opacity: theme.opacity.disabled },
        pressed && { opacity: theme.opacity.pressed },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: skin.textColor }]}>{label}</Text>
    </Pressable>
  )
})

export interface IconButtonProps {
  accessibilityLabel: string
  testID?: string
  children: React.ReactNode
  style?: ViewStyle
  onPress: () => void
}

/** Bare glyph button at `controlHeight.icon`, lifted to a 44pt target by hitSlop. */
export const IconButton = React.memo(function IconButton({
  accessibilityLabel,
  testID,
  children,
  style,
  onPress,
}: IconButtonProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      hitSlop={ICON_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: theme.opacity.pressed }, style]}
    >
      {children}
    </Pressable>
  )
})

const ICON_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const

export interface SegmentedItem<T extends string> {
  id: T
  label: string
}

export interface SegmentedProps<T extends string> {
  items: readonly SegmentedItem<T>[]
  value: T
  accessibilityLabel: string
  testIDPrefix?: string
  onChange: (id: T) => void
}

/** The sub-view switch used by Rules (Mock/Breakpoints/Throttle) and Logs (Console/Structured). */
export function Segmented<T extends string>({
  items,
  value,
  accessibilityLabel,
  testIDPrefix,
  onChange,
}: SegmentedProps<T>) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  return (
    <View
      style={[styles.segmented, { backgroundColor: colors.background, borderColor: colors.border }]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {items.map((item) => {
        const isActive = item.id === value
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={item.label}
            testID={testIDPrefix ? `${testIDPrefix}-${item.id}` : undefined}
            onPress={() => onChange(item.id)}
            style={[styles.segment, isActive && { backgroundColor: colors.accent + '29' }]}
          >
            <Text style={[styles.segmentText, { color: isActive ? colors.accent : colors.textMuted }]}>
              {item.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: theme.spacing.sm,
  },
  section: {
    paddingLeft: theme.layout.gutter,
    paddingRight: theme.layout.gutter,
    paddingVertical: theme.layout.rowGap,
  },
  sectionDivided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    minHeight: theme.controlHeight.bar,
    paddingLeft: theme.layout.gutter,
    paddingRight: theme.layout.gutter,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  field: {
    flex: 1,
    minWidth: 0,
    height: theme.controlHeight.field,
    paddingVertical: 0,
    paddingHorizontal: theme.spacing.ml,
    fontSize: theme.fontSize.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
  },
  button: {
    height: theme.controlHeight.field,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
  },
  buttonText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  iconButton: {
    width: theme.controlHeight.icon,
    height: theme.controlHeight.icon,
    borderRadius: theme.radius.md,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  segmented: {
    flexDirection: 'row' as const,
    alignSelf: 'flex-start' as const,
    height: theme.controlHeight.field,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    overflow: 'hidden' as const,
  },
  segment: {
    justifyContent: 'center' as const,
    paddingHorizontal: theme.spacing.lg,
  },
  segmentText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
}))
