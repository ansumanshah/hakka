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
import Svg, { G, Line, Path } from 'react-native-svg'

interface AppIconProps {
  size?: number
}

export function AppIcon({ size = 96 }: AppIconProps) {
  const pulse = useSharedValue(0)

  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })), -1)
    return () => cancelAnimation(pulse)
  }, [pulse])

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.5,
    transform: [{ scale: 0.85 + pulse.value * 0.23 }],
  }))

  return (
    <View accessibilityLabel="Hakka animated icon" style={{ width: size, height: size }}>
      <Reanimated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            width: size,
            height: size,
          },
          pulseStyle,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 96 96">
          <Path d="M29 34 A22 22 0 0 1 67 34" stroke="#22d3ee" strokeWidth="4" strokeLinecap="round" fill="none" />
          <Path d="M38 36 A11 11 0 0 1 58 36" stroke="#22d3ee" strokeWidth="4" strokeLinecap="round" fill="none" />
        </Svg>
      </Reanimated.View>
      <Svg width={size} height={size} viewBox="0 0 96 96">
        <G>
          <Line x1="63" y1="38" x2="77" y2="18" stroke="#a7b1be" strokeWidth="4" strokeLinecap="round" />
          <Line x1="70" y1="40" x2="83" y2="26" stroke="#a7b1be" strokeWidth="4" strokeLinecap="round" />
        </G>
        <Line x1="13" y1="47" x2="83" y2="47" stroke="#93c5fd" strokeWidth="6" strokeLinecap="round" />
        <Path d="M16 64 C16 52 30 42 48 42 C66 42 80 52 80 64 C80 76 66 86 48 86 C30 86 16 76 16 64 Z" fill="#2563eb" />
        <Path
          d="M31 61 C42 65 54 65 65 61"
          stroke="rgba(255,255,255,.55)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M31 68 C42 64 54 64 65 68"
          stroke="rgba(255,255,255,.45)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  )
}
