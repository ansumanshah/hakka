import React from 'react'
import { Svg, Rect } from 'react-native-svg'

export const Pause = ({
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
    <Rect x={14} y={4} width={4} height={16} rx={1} strokeWidth={strokeWidth} />
    <Rect x={6} y={4} width={4} height={16} rx={1} strokeWidth={strokeWidth} />
  </Svg>
)
