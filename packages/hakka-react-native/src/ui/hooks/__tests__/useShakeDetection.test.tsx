/**
 * useShakeDetection — minShakes/sensitivity gating.
 *
 * Both options used to be destructured into unused `_sensitivity`/`_minShakes`
 * and never read, so `onShake` fired on every single native 'shake' event
 * regardless of configuration. These tests pin the fix: `minShakes` gates how
 * many pulses are required within the (sensitivity-widened) window before
 * `onShake` actually fires.
 */
import React from 'react'
import { DeviceEventEmitter } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'

import { useShakeDetection } from '../useShakeDetection'

// react-test-renderer's `act()` needs this flag set or every update emits an
// "environment not configured to support act(...)" console warning (same
// setup as CrashBoundary.test.tsx / Header.test.tsx / Timing.test.tsx).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type DeviceEventEmitterLike = { emit: (eventType: string, ...args: unknown[]) => void }

function emitShake(): void {
  act(() => {
    ;(DeviceEventEmitter as unknown as DeviceEventEmitterLike).emit('shake')
  })
}

interface HarnessProps {
  onShake: () => void
  timeWindow?: number
  sensitivity?: number
  minShakes?: number
}

function Harness({ onShake, timeWindow, sensitivity, minShakes }: HarnessProps): null {
  useShakeDetection({ onShake, timeWindow, sensitivity, minShakes })
  return null
}

describe('useShakeDetection — minShakes / sensitivity', () => {
  let root: TestRenderer.ReactTestRenderer | null = null

  function mount(props: HarnessProps): void {
    act(() => {
      root = TestRenderer.create(<Harness {...props} />)
    })
  }

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount()
      })
      root = null
    }
    jest.useRealTimers()
  })

  it('fires on a single shake by default (minShakes=1)', () => {
    const onShake = jest.fn()
    mount({ onShake })

    emitShake()

    expect(onShake).toHaveBeenCalledTimes(1)
  })

  it('does not fire until minShakes pulses arrive within the window', () => {
    const onShake = jest.fn()
    mount({ onShake, minShakes: 3, timeWindow: 1000 })

    emitShake()
    expect(onShake).not.toHaveBeenCalled()
    emitShake()
    expect(onShake).not.toHaveBeenCalled()
    emitShake()
    expect(onShake).toHaveBeenCalledTimes(1)
  })

  it('resets the pulse count when pulses arrive further apart than the window', () => {
    jest.useFakeTimers()
    const onShake = jest.fn()
    mount({ onShake, minShakes: 2, timeWindow: 100 })

    emitShake()
    act(() => {
      jest.advanceTimersByTime(200) // > timeWindow — breaks the sequence
    })
    emitShake()

    // Each shake landed in its own, separately-reset window — only 1 pulse
    // counted each time, never reaching minShakes=2.
    expect(onShake).not.toHaveBeenCalled()
  })

  it('a higher sensitivity widens the window, letting slower pulses still count together', () => {
    jest.useFakeTimers()
    const onShake = jest.fn()
    mount({ onShake, minShakes: 2, timeWindow: 100, sensitivity: 3 })

    emitShake()
    act(() => {
      jest.advanceTimersByTime(200) // > timeWindow, but < timeWindow * sensitivity (300)
    })
    emitShake()

    expect(onShake).toHaveBeenCalledTimes(1)
  })

  it('debounces rapid-fire pulses at the default minShakes=1 (cooldown, not per-pulse fire)', () => {
    // Two native 'shake' events landing milliseconds apart is a realistic
    // DeviceEventEmitter artifact — each would independently satisfy the
    // default minShakes=1 gate, so without a cooldown onShake fires twice.
    const onShake = jest.fn()
    mount({ onShake })

    emitShake()
    emitShake()

    expect(onShake).toHaveBeenCalledTimes(1)
  })

  it('fires again once the cooldown window has elapsed', () => {
    jest.useFakeTimers()
    const onShake = jest.fn()
    mount({ onShake, timeWindow: 100 })

    emitShake()
    act(() => {
      jest.advanceTimersByTime(150) // > timeWindow — cooldown has cleared
    })
    emitShake()

    expect(onShake).toHaveBeenCalledTimes(2)
  })

  it('triggerShake respects the same minShakes gate as a real shake', () => {
    const onShake = jest.fn()
    let triggerShake: (() => void) | null = null

    function Capture(props: HarnessProps) {
      const result = useShakeDetection(props)
      // Capture in an effect — assigning during render is a lint-banned side effect.
      React.useEffect(() => {
        triggerShake = result.triggerShake
      })
      return null
    }

    act(() => {
      root = TestRenderer.create(<Capture onShake={onShake} minShakes={2} />)
    })

    act(() => triggerShake?.())
    expect(onShake).not.toHaveBeenCalled()
    act(() => triggerShake?.())
    expect(onShake).toHaveBeenCalledTimes(1)
  })
})
