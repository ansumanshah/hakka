import React from 'react'
import { Svg, Path } from 'react-native-svg'

export const SlidersHorizontal = ({
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
    <Path strokeWidth={strokeWidth} d="M21 4H14m-4 0H3m18 8h-5m-4 0H3m18 8h-7m-4 0H3M14 2v4m-4 6v4m-3 6v4" />
  </Svg>
)
