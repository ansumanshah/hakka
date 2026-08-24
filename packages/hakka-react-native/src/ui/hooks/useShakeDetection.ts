import { useCallback, useEffect, useRef } from 'react'
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
  sensitivity = 1.0,
  minShakes = 1,
}: ShakeDetectionOptions) => {
  const lastShakeTime = useRef<number>(0)
  const shakeCount = useRef<number>(0)
  const lastFireTime = useRef<number>(0)
  const onShakeRef = useRef(onShake)
  const enabledRef = useRef(enabled)
  useEffect(() => {
    onShakeRef.current = onShake
    enabledRef.current = enabled
  })

  // Higher sensitivity (1.0 = normal) widens the gap allowed between
  // consecutive shake pulses while still counting toward the same gesture —
  // RN's native 'shake' event carries no magnitude, so this is the only lever
  // available at the JS layer. `minShakes` requires that many pulses inside
  // the (widened) window before `onShake` fires.
  const effectiveWindow = timeWindow * sensitivity
  const requiredShakes = Math.max(1, minShakes)

  const registerShake = useCallback(() => {
    const now = Date.now()
    if (now - lastShakeTime.current > effectiveWindow) {
      shakeCount.current = 0
    }
    lastShakeTime.current = now
    shakeCount.current += 1

    if (shakeCount.current < requiredShakes) return
    shakeCount.current = 0

    // Cooldown: caps a completed gesture to firing once per window, same as
    // the pre-minShakes debounce. Without this, two native 'shake' events
    // landing milliseconds apart (a realistic accelerometer artifact) each
    // independently satisfy the default minShakes=1 and fire onShake twice.
    if (now - lastFireTime.current <= effectiveWindow) return
    lastFireTime.current = now
    onShakeRef.current()
  }, [effectiveWindow, requiredShakes])

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('shake', () => {
      if (!enabledRef.current) return
      registerShake()
    })

    return () => {
      subscription.remove()
    }
  }, [registerShake])

  return {
    isEnabled: enabled,
    // Bypasses `enabledRef` deliberately, matching the pre-existing contract
    // ("triggerShake() can always be called manually for testing" above) —
    // but still respects the minShakes/sensitivity gate like a real shake.
    triggerShake: registerShake,
  }
}
