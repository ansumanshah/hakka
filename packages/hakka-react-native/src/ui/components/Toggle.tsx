import React from 'react'
import { Pressable, View } from 'react-native'

import { createStyleSheet, spacing, useTheme } from '../styles'
import type { Theme } from '../styles/createStyleSheet'
import { Badge } from './Badge'

interface ToggleOption {
  value: string
  label: string
}

export interface ToggleProps<T extends string = string> {
  options: readonly ToggleOption[]
  value: T
  onValueChange: (value: T) => void
  theme?: Theme
}

export const Toggle = <T extends string = string>({
  options,
  value,
  onValueChange,
  theme: customTheme,
}: ToggleProps<T>) => {
  const fallbackTheme = useTheme()
  const theme = customTheme || fallbackTheme
  const styles = createStyles(theme)
  const { colors } = theme

  return (
    <View style={styles.container}>
      {options.map((option) => (
        <Pressable key={option.value} onPress={() => onValueChange(option.value as T)}>
          <Badge
            text={option.label}
            backgroundColor={value === option.value ? colors.active : colors.backgroundAlt}
            textColor={value === option.value ? '#fff' : colors.textMuted}
            fontSize={9}
            height={20}
          />
        </Pressable>
      ))}
    </View>
  )
}

const createStyles = createStyleSheet(() => ({
  container: {
    flexDirection: 'row' as const,
    gap: spacing.xs,
  },
}))
