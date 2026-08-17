import React from 'react'
import { Svg, Circle, Path } from 'react-native-svg'

export const Search = ({
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
}: {
  size?: number
  color?: string
  strokeWidth?: number
}) => (
  <Svg
    fill="none"
    stroke={color}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    width={size}
    height={size}
  >
    <Circle cx={11} cy={11} r={8} strokeWidth={strokeWidth} />
    <Path strokeWidth={strokeWidth} d="m21 21-4.3-4.3" />
  </Svg>
)
