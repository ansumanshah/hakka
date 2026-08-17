import React from 'react'
import { Pressable, Text } from 'react-native'

import { useTheme } from '../styles'

export interface ChipProps {
  label: string
  accessibilityLabel?: string
  /** Selected/on. Only an active chip is allowed to use colour. */
  active?: boolean
  /** Optional leading glyph, sized by the caller. */
  icon?: React.ReactNode
  onPress: () => void
}

/**
 * The interactive chip. One implementation, used by the filter disclosure, the
 * Monitor domain rail, and anywhere else a small toggle is needed.
 *
 * Quiet at rest — `controlHeight.chip` tall, small radius, hairline border,
 * tertiary text, no fill. The accent only speaks when the chip is active.
 */
export const Chip = React.memo(function Chip({ label, accessibilityLabel, active = false, icon, onPress }: ChipProps) {
  const theme = useTheme()
  const { colors } = theme

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: theme.controlHeight.chip,
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          gap: theme.spacing.xxs,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: active ? colors.accent + '66' : colors.border,
          backgroundColor: active ? colors.accent + '1A' : 'transparent',
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      {icon}
      <Text
        numberOfLines={1}
        style={{
          fontSize: theme.fontSize.xs,
          fontWeight: theme.fontWeight.semibold,
          color: active ? colors.accent : colors.textSubtle,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
})
