import React from 'react'
import { Pressable } from 'react-native'

import { Copy } from '../icons'
import { useTheme } from '../styles'

interface CopyButtonProps {
  onCopy: () => void
  size?: number
  color?: string
}

export const CopyButton: React.FC<CopyButtonProps> = ({ onCopy, size = 10, color }) => {
  const theme = useTheme()
  const iconColor = color || theme.colors.textMuted

  return (
    <Pressable onPress={onCopy} style={({ pressed }) => ({ padding: 2, opacity: pressed ? 0.5 : 0.3 })}>
      <Copy size={size} color={iconColor} />
    </Pressable>
  )
}
