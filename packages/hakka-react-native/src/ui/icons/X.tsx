import React from 'react'
import { Svg, Path } from 'react-native-svg'

export const X = ({
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
    <Path strokeWidth={strokeWidth} d="M18 6 6 18M6 6l12 12" />
  </Svg>
)
