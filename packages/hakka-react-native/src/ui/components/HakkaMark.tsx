/**
 * HakkaMark — the bowl-and-signal brand mark as a compact inline SVG. Ported
 * from packages/hakka-browser/src/ui/HakkaMark.tsx (bowl + 3 broadcast arcs,
 * NO chopsticks — they turn to noise below 24px). Wok Hei tokens: bowl fill =
 * accent @ ~14%, stroke = textMuted, arcs = jade (success).
 *
 * Arcs pulse while capturing, doubling as the "recording" indicator — same
 * as web's `hakka-mark-live` class. Pulse follows AppIcon.tsx's pattern
 * (a Reanimated.View overlay animating opacity over the static SVG).
 */
import React, { useEffect } from 'react'
import { View } from 'react-native'
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { G, Path } from 'react-native-svg'

import { useTheme } from '../styles'

export interface HakkaMarkProps {
  /** Overall size (square). Default 18, matching the web inline mark. */
  size?: number
  /** Pulse the broadcast arcs (capturing indicator). Default false. */
  live?: boolean
}

/**
 * Bowl-and-signal brand mark. Use wherever the inspector shows an icon or
 * entry point today (floating bubble, panel headers) — never render the
 * "Hakka" wordmark in chrome; the mark carries the brand.
 */
export const HakkaMark = React.memo(function HakkaMark({ size = 18, live = false }: HakkaMarkProps) {
  const theme = useTheme()
  const { colors } = theme
  const pulse = useSharedValue(1)

  useEffect(() => {
    if (live) {
      pulse.value = withRepeat(
        withSequence(withTiming(0.4, { duration: 900 }), withTiming(1, { duration: 900 })),
        -1,
        true,
      )
    } else {
      cancelAnimation(pulse)
      pulse.value = withTiming(1, { duration: 150 })
    }
    return () => cancelAnimation(pulse)
  }, [live, pulse])

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }))

  const bowlFill = colors.accent + '24' // ~14% opacity tint
  const arcColor = colors.jade

  const arcs = (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G stroke={arcColor} strokeWidth={1.6} strokeLinecap="round" fill="none">
        <Path d="M9.9 7.4a3 3 0 0 1 4.2 0" />
        <Path d="M8.2 5a5.4 5.4 0 0 1 7.6 0" />
        <Path d="M6.4 2.7a7.9 7.9 0 0 1 11.2 0" />
      </G>
    </Svg>
  )

  return (
    <View accessibilityLabel="Hakka" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 0, top: 0 }}>
        <Path
          d="M3.5 12.5h17a8.5 8.5 0 0 1-6 7.3v0.7h-5v-0.7a8.5 8.5 0 0 1-6-7.3z"
          fill={bowlFill}
          stroke={colors.textMuted}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      </Svg>
      {live ? (
        <Reanimated.View style={[{ position: 'absolute', left: 0, top: 0 }, pulseStyle]}>{arcs}</Reanimated.View>
      ) : (
        <View style={{ position: 'absolute', left: 0, top: 0 }}>{arcs}</View>
      )}
    </View>
  )
})
