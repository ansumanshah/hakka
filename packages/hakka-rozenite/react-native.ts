/**
 * React Native entry point — what `rozenite build` bundles into
 * `dist/react-native/index.{js,cjs,d.ts}`.
 *
 * Lazy-required and a no-op outside dev/RN: an RN app is expected to call
 * `useHakkaRozeniteDevTools()` unconditionally (alongside `useHakka()`), so
 * this import must stay inert in production bundles, on web, and under SSR
 * rather than requiring the caller to gate it themselves.
 */
export let useHakkaRozeniteDevTools: typeof import('./src/react-native/useHakkaRozeniteDevTools').useHakkaRozeniteDevTools

const isWeb = typeof window !== 'undefined' && window.navigator?.product !== 'ReactNative'
const isDev = process.env.NODE_ENV !== 'production'
const isServer = typeof window === 'undefined'

if (isDev && !isWeb && !isServer) {
  useHakkaRozeniteDevTools = require('./src/react-native/useHakkaRozeniteDevTools').useHakkaRozeniteDevTools
} else {
  useHakkaRozeniteDevTools = () => undefined
}
