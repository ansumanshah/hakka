/**
 * React Native entry point — what `rozenite build` bundles into
 * `dist/react-native/react-native.{js,d.ts}` plus the nested CommonJS build.
 *
 * Lazy-required and a no-op outside dev/RN: an RN app is expected to call
 * `useHakkaRozeniteDevTools()` unconditionally (alongside `useHakka()`), so
 * this import must stay inert in production bundles, on web, and under SSR
 * rather than requiring the caller to gate it themselves.
 */
import type { useHakkaRozeniteDevTools as useHakkaRozeniteDevToolsType } from './src/react-native/useHakkaRozeniteDevTools'

type UseHakkaRozeniteDevTools = typeof useHakkaRozeniteDevToolsType

export let useHakkaRozeniteDevTools: UseHakkaRozeniteDevTools

// Rozenite 2 compiles this entry with an isolated TypeScript program that
// does not load host Node typings. Metro still provides both globals at
// runtime, so keep their declarations scoped to this entry point.
declare const process: { env: { NODE_ENV?: string } }
declare function require(moduleId: './src/react-native/useHakkaRozeniteDevTools'): {
  useHakkaRozeniteDevTools: UseHakkaRozeniteDevTools
}

const isWeb = typeof window !== 'undefined' && window.navigator?.product !== 'ReactNative'
const isDev = process.env.NODE_ENV !== 'production'
const isServer = typeof window === 'undefined'

if (isDev && !isWeb && !isServer) {
  useHakkaRozeniteDevTools = require('./src/react-native/useHakkaRozeniteDevTools').useHakkaRozeniteDevTools
} else {
  useHakkaRozeniteDevTools = () => undefined
}
