import { useMemo } from 'react'
import { Platform, StatusBar, useWindowDimensions } from 'react-native'

export interface SafeAreaInsets {
  top: number
  bottom: number
  left: number
  right: number
}

let nativeSafeAreaHook: (() => SafeAreaInsets) | null = null
let hasAttemptedDetection = false

const detectNativeSafeAreaHook = () => {
  if (hasAttemptedDetection) {
    return
  }

  hasAttemptedDetection = true

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const safeAreaModule = require('react-native-safe-area-context')
    if (safeAreaModule?.useSafeAreaInsets) {
      nativeSafeAreaHook = safeAreaModule.useSafeAreaInsets as () => SafeAreaInsets
    }
  } catch {
    // Optional dependency not available
    nativeSafeAreaHook = null
  }
}

const DeviceDetection = {
  hasNotch: (height: number, width: number): boolean => {
    return height >= 812 || width >= 812
  },
  hasDynamicIsland: (height: number, width: number): boolean => {
    return height >= 932 || width >= 932
  },
  isCompactDevice: (height: number): boolean => {
    return height <= 667
  },
  isMiniDevice: (height: number, width: number): boolean => {
    return height === 812 && width === 375
  },
}

const calculateAndroidInsets = (): SafeAreaInsets => {
  const top = StatusBar.currentHeight || 24
  return { top, bottom: 0, left: 0, right: 0 }
}

const calculateIOSInsets = (height: number, width: number): SafeAreaInsets => {
  const hasNotch = DeviceDetection.hasNotch(height, width)
  const hasDynamicIsland = DeviceDetection.hasDynamicIsland(height, width)
  const isCompactDevice = DeviceDetection.isCompactDevice(height)
  const isMiniDevice = DeviceDetection.isMiniDevice(height, width)

  let top: number
  let bottom: number

  if (hasDynamicIsland) {
    top = 54
    bottom = 34
  } else if (hasNotch && !isMiniDevice) {
    top = 47
    bottom = 34
  } else if (isMiniDevice) {
    top = 50
    bottom = 34
  } else if (isCompactDevice) {
    top = 20
    bottom = 0
  } else {
    top = 20
    bottom = 0
  }

  return { top, bottom, left: 0, right: 0 }
}

const calculateSafeAreaInsets = (windowWidth: number, windowHeight: number): SafeAreaInsets => {
  if (Platform.OS === 'android') {
    return calculateAndroidInsets()
  } else if (Platform.OS === 'ios') {
    return calculateIOSInsets(windowHeight, windowWidth)
  }

  return { top: 0, bottom: 0, left: 0, right: 0 }
}

/** Estimated insets from window dimensions and device heuristics. */
const useCustomSafeAreaInsets = (): SafeAreaInsets => {
  const { width, height } = useWindowDimensions()

  return useMemo(() => {
    return calculateSafeAreaInsets(width, height)
  }, [width, height])
}

/**
 * Both the custom and (if present) native hook are called unconditionally on
 * every render to satisfy Rules of Hooks — nativeSafeAreaHook is fixed at
 * module load and never toggles mid-lifecycle, so the hook call count stays
 * stable. Native result wins when valid.
 */
export const useSafeAreaInsets = (): SafeAreaInsets => {
  detectNativeSafeAreaHook()
  const customInsets = useCustomSafeAreaInsets()

  let nativeInsets: SafeAreaInsets | null = null
  if (nativeSafeAreaHook) {
    try {
      const result = nativeSafeAreaHook()
      if (result && typeof result.top === 'number') {
        nativeInsets = result
      }
    } catch {
      // fall back to custom estimation
    }
  }

  return nativeInsets ?? customInsets
}
