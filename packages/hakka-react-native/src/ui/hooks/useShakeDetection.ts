import { useEffect, useRef } from 'react'
import { DeviceEventEmitter } from 'react-native'

interface ShakeDetectionOptions {
  timeWindow?: number
  onShake: () => void
  enabled?: boolean
  sensitivity?: number
  minShakes?: number
}

const DEFAULT_TIME_WINDOW = 1000

/**
 * Shake detection via RN's DeviceEventEmitter 'shake' event, fired on both
 * iOS and Android. Falls back gracefully if never fired (e.g. simulator
 * without Hardware > Shake Gesture).
 *
 * triggerShake() can always be called manually for testing, or wired into
 * __DEV__ tooling via globalThis.__HAKKA_SHAKE__.
 */
export const useShakeDetection = ({
  timeWindow = DEFAULT_TIME_WINDOW,
  onShake,
  enabled = true,
  sensitivity: _sensitivity = 1.0,
  minShakes: _minShakes = 1,
}: ShakeDetectionOptions) => {
  const lastShakeTime = useRef<number>(0)
  const onShakeRef = useRef(onShake)
  const enabledRef = useRef(enabled)
  onShakeRef.current = onShake
  enabledRef.current = enabled

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('shake', () => {
      if (!enabledRef.current) return

      const now = Date.now()
      if (now - lastShakeTime.current > timeWindow) {
        lastShakeTime.current = now
        onShakeRef.current()
      }
    })

    return () => {
      subscription.remove()
    }
  }, [timeWindow])

  return {
    isEnabled: enabled,
    triggerShake: () => {
      const now = Date.now()
      if (now - lastShakeTime.current > timeWindow) {
        lastShakeTime.current = now
        onShakeRef.current()
      }
    },
  }
}
