import React from 'react'
import { Text, View, type ViewStyle } from 'react-native'

import { useTheme } from '../styles'
import { getMethodColor, getStatusGroupColors } from '../utils/statusColors'

export { getMethodColor, getStatusGroupColors }

function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export interface BadgeProps {
  /** Numeric count (renders formatted). Ignored if `text` is provided. */
  count?: number
  text?: string
  backgroundColor?: string
  textColor?: string
  fontSize?: number
  minWidth?: number
  height?: number
  style?: ViewStyle
}

export const Badge = React.memo(function Badge({
  count,
  text,
  backgroundColor,
  textColor,
  fontSize,
  minWidth,
  height,
  style,
}: BadgeProps) {
  const theme = useTheme()
  const { colors, fontSize: f } = theme

  const label = text ?? (count != null ? formatCount(count) : '')
  if (!label) return null

  const h = height ?? theme.controlHeight.badge
  const fs = fontSize ?? f.xs
  const minW = minWidth ?? (label.length > 2 ? 24 : 18)

  return (
    <View
      style={[
        {
          minWidth: minW,
          height: h,
          borderRadius: h / 2,
          backgroundColor: backgroundColor ?? colors.badgeBg,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.xs,
        },
        style,
      ]}
    >
      <Text style={{ color: textColor ?? colors.badgeText, fontSize: fs, fontWeight: '700' }}>{label}</Text>
    </View>
  )
})

export interface MethodLabelProps {
  method: string
  /** Fixed width so list columns align — matches MethodChip's default. */
  width?: number
  style?: ViewStyle
}

/**
 * Plain colored uppercase mono text — no border/background. Rows are data,
 * not controls: chips stay reserved for interactive contexts (filter bar,
 * Detail header pill, Mock/Breakpoint chips) — a row's method is read, never
 * tapped. Fixed width keeps the path column's left edge aligned row to row,
 * same as the chip it replaces in Row.tsx.
 */
export const MethodLabel = React.memo(function MethodLabel({ method, width = 46, style }: MethodLabelProps) {
  const theme = useTheme()
  const color = getMethodColor(method, theme.colors)

  return (
    <View style={[{ width, alignItems: 'flex-start' as const, justifyContent: 'center' as const }, style]}>
      <Text
        style={{
          fontSize: theme.fontSize.xs,
          fontWeight: '700',
          fontFamily: 'monospace',
          color,
        }}
        numberOfLines={1}
      >
        {method.toUpperCase()}
      </Text>
    </View>
  )
})

export interface MethodChipProps {
  method: string
  /** Fixed width so list columns align. Default 46. */
  width?: number
  style?: ViewStyle
}

/**
 * Outlined method chip — mono, method-colored text, ~40% opacity border,
 * ~10% opacity tint background, small radius. Fixed width for column alignment.
 */
export const MethodChip = React.memo(function MethodChip({ method, width = 46, style }: MethodChipProps) {
  const theme = useTheme()
  const color = getMethodColor(method, theme.colors)

  return (
    <View
      style={[
        {
          width,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: theme.spacing.xxs,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: color + '66',
          backgroundColor: color + '1A',
        },
        style,
      ]}
    >
      <Text
        style={{
          fontSize: theme.fontSize.xs,
          fontWeight: '700',
          fontFamily: 'monospace',
          color,
        }}
        numberOfLines={1}
      >
        {method.toUpperCase()}
      </Text>
    </View>
  )
})
