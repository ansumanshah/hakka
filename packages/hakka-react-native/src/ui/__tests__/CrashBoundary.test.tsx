/**
 * CrashBoundary — root-level crash containment for the JS inspector.
 *
 * Mirrors `hakka-browser/src/ui/__tests__/CrashBoundary.test.tsx`'s intent:
 * `ThrowingChild` is a synthetic, deterministic stand-in for "a panel that
 * throws during render" so these tests don't depend on which real panel has
 * a bug on a given day. `hakka-core` is NOT mocked in this package's jest
 * config (`moduleNameMapper` points `hakka-core` at its real source), so the
 * store-survival test below exercises the real `Hakka` singleton rather
 * than a stand-in.
 */
import { Hakka } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import React from 'react'
import { Text } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'

import { CrashBoundary } from '../CrashBoundary'
import { ThemeProvider } from '../styles'

// react-test-renderer's `act()` needs this flag set or every update emits an
// "environment not configured to support act(...)" console warning (same
// setup as Header.test.tsx / Timing.test.tsx).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A child whose throw behavior is controlled from outside — flip
 * `stopThrowing()` to simulate the crash condition clearing before a fresh
 * mount, and `mountCount()` proves Reload actually re-invoked the
 * component rather than reusing a stale instance. */
function makeThrowingChild(): {
  ThrowingChild: React.FC
  stopThrowing: () => void
  mountCount: () => number
} {
  let shouldThrow = true
  let mounts = 0
  const ThrowingChild: React.FC = () => {
    mounts += 1
    if (shouldThrow) throw new Error('boom: panel crashed')
    return <Text testID="ok-child">panel ok</Text>
  }
  return {
    ThrowingChild,
    stopThrowing: () => {
      shouldThrow = false
    },
    mountCount: () => mounts,
  }
}

function renderTree(children: React.ReactNode): TestRenderer.ReactTestRenderer {
  let root!: TestRenderer.ReactTestRenderer
  act(() => {
    root = TestRenderer.create(
      <ThemeProvider theme="dark">
        <CrashBoundary>{children}</CrashBoundary>
      </ThemeProvider>,
    )
  })
  return root
}

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'before-crash',
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    endTime: Date.now() + 100,
    duration: 100,
    ...overrides,
  }
}

describe('CrashBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    // An error boundary catching a real throw logs it (this component's own
    // componentDidCatch, plus React's own dev-mode "above error occurred"
    // notice) — expected noise for every "catches a throw" test here, not a
    // real failure.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    // 'store' mode runs the ingest pipeline (`running = true`) with no
    // interceptors installed — `Hakka.ingest()` below is a no-op while
    // `running` is false, and this test file never mounts `useHakka` (only
    // `CrashBoundary` + a synthetic child), so nothing else starts it.
    Hakka.start({ mode: 'store' })
    Hakka.clearLogs()
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    Hakka.clearLogs()
    Hakka.stop()
  })

  it('renders children normally when nothing throws', () => {
    const root = renderTree(<Text testID="ok-child">fine</Text>)
    expect(root.root.findByProps({ testID: 'ok-child' }).props.children).toBe('fine')
    expect(root.root.findAllByProps({ testID: 'hakka-crash-bar' })).toHaveLength(0)
  })

  it('a child that throws renders the fallback bar instead of propagating', () => {
    const { ThrowingChild } = makeThrowingChild()
    const root = renderTree(<ThrowingChild />)

    expect(root.root.findByProps({ testID: 'hakka-crash-bar' })).toBeTruthy()
    expect(root.root.findAllByProps({ testID: 'ok-child' })).toHaveLength(0)
  })

  it('Reload tears down and remounts — a working child replaces the fallback', () => {
    const { ThrowingChild, stopThrowing, mountCount } = makeThrowingChild()
    const root = renderTree(<ThrowingChild />)
    expect(root.root.findByProps({ testID: 'hakka-crash-bar' })).toBeTruthy()
    // React's dev-mode error path re-invokes a throwing render for a clean
    // stack trace, so the initial count is >1, not exactly 1 — the
    // meaningful assertion is the *increase* after Reload, checked below.
    const mountsBeforeReload = mountCount()

    stopThrowing()
    const reloadBtn = root.root.findByProps({ testID: 'hakka-crash-reload' })
    act(() => {
      reloadBtn.props.onPress()
    })

    // A real additional mount, not a no-op local retry re-rendering the same instance.
    expect(mountCount()).toBeGreaterThan(mountsBeforeReload)
    expect(root.root.findByProps({ testID: 'ok-child' }).props.children).toBe('panel ok')
    expect(root.root.findAllByProps({ testID: 'hakka-crash-bar' })).toHaveLength(0)
  })

  it('Reload on a still-broken child re-attempts the mount (crashes again, not stuck)', () => {
    const { ThrowingChild, mountCount } = makeThrowingChild()
    const root = renderTree(<ThrowingChild />)
    expect(root.root.findByProps({ testID: 'hakka-crash-bar' })).toBeTruthy()
    const mountsBeforeReload = mountCount()

    act(() => {
      root.root.findByProps({ testID: 'hakka-crash-reload' }).props.onPress()
    })

    expect(mountCount()).toBeGreaterThan(mountsBeforeReload)
    expect(root.root.findByProps({ testID: 'hakka-crash-bar' })).toBeTruthy()
  })

  it('the capture store is untouched across a crash + reload', () => {
    const { ThrowingChild, stopThrowing } = makeThrowingChild()
    Hakka.ingest(makeRequest())
    expect(Hakka.getLogCount()).toBe(1)

    const root = renderTree(<ThrowingChild />)
    expect(root.root.findByProps({ testID: 'hakka-crash-bar' })).toBeTruthy()
    // The crash itself must not touch the store — it's a module-level
    // singleton (`hakka-core`'s `Hakka`) living outside the crashed tree.
    expect(Hakka.getLogCount()).toBe(1)
    expect(Hakka.getLog('before-crash')).toBeDefined()

    stopThrowing()
    act(() => {
      root.root.findByProps({ testID: 'hakka-crash-reload' }).props.onPress()
    })

    // Reload tears down and remounts the React tree, but never the store —
    // the request captured before the crash is still there afterward.
    expect(Hakka.getLogCount()).toBe(1)
    expect(Hakka.getLog('before-crash')).toBeDefined()
    expect(root.root.findByProps({ testID: 'ok-child' })).toBeTruthy()
  })
})
