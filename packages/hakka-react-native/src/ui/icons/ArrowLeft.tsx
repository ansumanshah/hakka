import React from 'react'
import { Svg, Path } from 'react-native-svg'

export const ArrowLeft = ({
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
    <Path strokeWidth={strokeWidth} d="m12 19-7-7 7-7m7 7H5" />
  </Svg>
)
