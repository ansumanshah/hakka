/**
 * useHakka — unmount must not stop capture started by a different instance.
 *
 * `Hakka` is a process-wide singleton. The hook only conditionally starts it
 * (`if (!Hakka.isActive) { Hakka.start() }`) but used to unconditionally call
 * `Hakka.stop()` in its cleanup — so a second `useHakka()` instance that found
 * capture already running would still kill it for everyone on unmount.
 */
import { Hakka } from 'hakka-core'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

import { useHakka } from '../useHakka'
import type { UseHakkaOptions } from '../useHakka'

// react-test-renderer's `act()` needs this flag set or every update emits an
// "environment not configured to support act(...)" console warning (same
// setup as CrashBoundary.test.tsx / Header.test.tsx / Timing.test.tsx).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ config }: { config?: UseHakkaOptions }): null {
  useHakka(config)
  return null
}

describe('useHakka — unmount only stops capture the instance itself started', () => {
  afterEach(() => {
    // 'store' mode (see below) never installs real interceptors, so a bare
    // stop() is enough to leave the singleton clean between tests.
    act(() => {
      Hakka.stop()
    })
  })

  it('a second instance that finds capture already active does not stop it on unmount', () => {
    expect(Hakka.isActive).toBe(false)

    // 'store' mode keeps this test to pure engine state — no XHR/fetch/WebSocket
    // interceptors installed, matching CrashBoundary.test.tsx's approach.
    let rootA!: TestRenderer.ReactTestRenderer
    act(() => {
      rootA = TestRenderer.create(<Harness config={{ mode: 'store' }} />)
    })
    expect(Hakka.isActive).toBe(true) // instance A started it

    let rootB!: TestRenderer.ReactTestRenderer
    act(() => {
      rootB = TestRenderer.create(<Harness />)
    })
    expect(Hakka.isActive).toBe(true) // instance B found it already active, did not start it

    // Unmount B first — the fix under test: B never started capture, so its
    // cleanup must not stop it out from under instance A.
    act(() => {
      rootB.unmount()
    })
    expect(Hakka.isActive).toBe(true)

    // Unmount A — the instance that actually started it — now it stops.
    act(() => {
      rootA.unmount()
    })
    expect(Hakka.isActive).toBe(false)
  })

  it('a single instance still stops capture on its own unmount (baseline, unchanged)', () => {
    expect(Hakka.isActive).toBe(false)

    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(<Harness config={{ mode: 'store' }} />)
    })
    expect(Hakka.isActive).toBe(true)

    act(() => {
      root.unmount()
    })
    expect(Hakka.isActive).toBe(false)
  })
})
