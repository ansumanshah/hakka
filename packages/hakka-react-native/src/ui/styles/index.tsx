/**
 * Theme System
 * Centralized design tokens for the entire SDK
 */

import type { ReactNode } from 'react'
import React, { createContext, use, useMemo } from 'react'

import * as tokens from './tokens'
import { darkColors, lightColors } from './tokens'

export { controlHeight, fontSize, radius, spacing, statusColor } from './tokens'

export { createStyleSheet } from './createStyleSheet'

type ThemeMode = 'light' | 'dark'

type ThemeColors = typeof lightColors | typeof darkColors

interface Theme {
  spacing: typeof tokens.spacing
  radius: typeof tokens.radius
  controlHeight: typeof tokens.controlHeight
  layout: typeof tokens.layout
  fontSize: typeof tokens.fontSize
  fontWeight: typeof tokens.fontWeight
  opacity: typeof tokens.opacity
  shadow: typeof tokens.shadow
  animation: typeof tokens.animation
  colors: ThemeColors
}

interface ThemeContextValue {
  theme: Theme
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: {
    ...tokens,
    colors: darkColors,
  },
})

export const useTheme = () => use(ThemeContext).theme

interface ThemeProviderProps {
  theme?: ThemeMode
  children: ReactNode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ theme: mode = 'dark', children }) => {
  const colors = mode === 'dark' ? darkColors : lightColors

  const theme = useMemo(
    () => ({
      ...tokens,
      colors,
    }),
    [colors],
  )

  const contextValue = useMemo(() => ({ theme }), [theme])

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
}
