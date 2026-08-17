import React from 'react'
import { Svg, Path } from 'react-native-svg'

export const ArrowDown = ({
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
    <Path strokeWidth={strokeWidth} d="M12 5v14m7-7-7 7-7-7" />
  </Svg>
)
