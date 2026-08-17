import React from 'react'
import { Svg, Path, Rect } from 'react-native-svg'

export const Copy = ({
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
    <Rect width={14} height={14} x={8} y={8} rx={2} ry={2} strokeWidth={strokeWidth} />
    <Path strokeWidth={strokeWidth} d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Svg>
)
