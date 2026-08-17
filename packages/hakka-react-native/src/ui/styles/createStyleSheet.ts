import { StyleSheet } from 'react-native'

import type * as tokenImports from './tokens'

type NamedStyles<T> = StyleSheet.NamedStyles<T>
type ThemeColors = typeof tokenImports.lightColors | typeof tokenImports.darkColors

export interface Theme {
  spacing: typeof tokenImports.spacing
  radius: typeof tokenImports.radius
  controlHeight: typeof tokenImports.controlHeight
  layout: typeof tokenImports.layout
  fontSize: typeof tokenImports.fontSize
  fontWeight: typeof tokenImports.fontWeight
  opacity: typeof tokenImports.opacity
  shadow: typeof tokenImports.shadow
  animation: typeof tokenImports.animation
  colors: ThemeColors
}

/**
 * Simple stylesheet creator that receives theme (tokens + colors)
 *
 * @example
 * ```ts
 * import { createStyleSheet } from '../styles/createStyleSheet'
 * import { useTheme } from '../styles'
 *
 * // Define the stylesheet factory (runs once at module load)
 * const createStyles = createStyleSheet((theme) => ({
 *   container: {
 *     padding: theme.spacing.md,
 *     borderRadius: theme.radius.lg,
 *     backgroundColor: theme.colors.background,
 *   },
 *   text: {
 *     fontSize: theme.fontSize.md,
 *     fontWeight: theme.fontWeight.semibold,
 *     color: theme.colors.text,
 *   }
 * }))
 *
 * // In component - call it with theme
 * function MyComponent() {
 *   const theme = useTheme()
 *   const styles = createStyles(theme)
 *
 *   return (
 *     <View style={styles.container}>
 *       <Text style={styles.text}>Hello</Text>
 *     </View>
 *   )
 * }
 * ```
 */
export function createStyleSheet<T extends NamedStyles<T>>(factory: (theme: Theme) => T): (theme: Theme) => T {
  const cache = new WeakMap<Theme, T>()
  return (theme: Theme) => {
    const cached = cache.get(theme)
    if (cached) return cached

    const styles = StyleSheet.create(factory(theme))
    cache.set(theme, styles)
    return styles
  }
}
