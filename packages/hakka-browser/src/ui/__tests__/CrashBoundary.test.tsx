/**
 * CrashBoundary — the root `<Errored>` guard `register.ts`/`mount.tsx` wrap
 * around `<Inspector>`, guarding against the 2026-08-16 REACTIVITY_HALTED
 * incident where an uncaught error deep in one tab froze the whole overlay's
 * reactive queue. `ThrowingPanel` is a synthetic, deterministic stand-in for
 * "a panel that throws during render/update" so these tests don't depend on
 * which real panel has a bug on a given day. `InspectorRoot` gets its own
 * smoke test at the bottom, proving production wiring didn't change
 * Inspector's normal behavior.
 */
import { render, fireEvent } from '@solidjs/testing-library'
import type { JSX } from '@solidjs/web'
import { createSignal, flush, Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { destroyStore, initStore } from '../../worker'
import { CrashBoundary, InspectorRoot } from '../CrashBoundary'

function q(container: HTMLElement, selector: string): Element | null {
  return container.querySelector(selector)
}

/** A "panel" whose throw behavior is controlled from outside — flip
 * `stopThrowing()` to simulate the crash condition clearing before a
 * fresh mount. */
function makeThrowingPanel(): { Panel: () => JSX.Element; stopThrowing: () => void } {
  let shouldThrow = true
  return {
    Panel: () => {
      if (shouldThrow) throw new Error('boom: panel crashed')
      return <div class="test-panel">panel ok</div>
    },
    stopThrowing: () => {
      shouldThrow = false
    },
  }
}

describe('CrashBoundary', () => {
  it('renders children normally when nothing throws', () => {
    const { container } = render(() => <CrashBoundary>{() => <div class="test-panel">fine</div>}</CrashBoundary>)
    expect(q(container, '.test-panel')?.textContent).toBe('fine')
    expect(q(container, '.hakka-crash-bar')).toBeNull()
  })

  it('catches a throw during initial render and shows the fallback bar', () => {
    const { Panel } = makeThrowingPanel()
    const { container } = render(() => <CrashBoundary>{() => <Panel />}</CrashBoundary>)

    expect(q(container, '.hakka-crash-bar')).toBeTruthy()
    expect(q(container, '.hakka-crash-bar-text')?.textContent).toBe('Inspector crashed — reload')
    expect(q(container, '.test-panel')).toBeNull()
  })

  it('catches a throw during an update, not just the initial render', async () => {
    // Throws once a reactive read flips true, not on the initial render —
    // the "crash arrives later, mid-session" case the incident actually hit.
    function Reactive(): JSX.Element {
      const [armed, setArmed] = createSignal(false)
      return (
        <div>
          <button type="button" class="arm-btn" onClick={() => setArmed(true)}>
            arm
          </button>
          <Show when={armed()} fallback={<div class="test-panel">still fine</div>}>
            {(_armed) => {
              throw new Error('boom: crashed on update')
            }}
          </Show>
        </div>
      )
    }

    const { container } = render(() => <CrashBoundary>{() => <Reactive />}</CrashBoundary>)

    expect(q(container, '.test-panel')?.textContent).toBe('still fine')
    expect(q(container, '.hakka-crash-bar')).toBeNull()

    fireEvent.click(q(container, '.arm-btn') as Element)
    await flush()

    expect(q(container, '.hakka-crash-bar')).toBeTruthy()
    expect(q(container, '.test-panel')).toBeNull()
  })

  it('does not leak past its own subtree — the host page is unaffected', () => {
    const sentinel = document.createElement('div')
    sentinel.id = 'host-content'
    sentinel.textContent = 'host page content'
    document.body.appendChild(sentinel)

    const onWindowError = vi.fn()
    window.addEventListener('error', onWindowError)

    const { Panel } = makeThrowingPanel()
    render(() => <CrashBoundary>{() => <Panel />}</CrashBoundary>)

    expect(onWindowError).not.toHaveBeenCalled()
    expect(document.getElementById('host-content')?.textContent).toBe('host page content')

    window.removeEventListener('error', onWindowError)
    sentinel.remove()
  })

  it('Reload fully tears down and re-mounts — a working panel replaces the fallback', async () => {
    const { Panel, stopThrowing } = makeThrowingPanel()
    const { container } = render(() => <CrashBoundary>{() => <Panel />}</CrashBoundary>)

    expect(q(container, '.hakka-crash-bar')).toBeTruthy()

    stopThrowing()

    const reloadBtn = q(container, '.hakka-crash-bar-btn') as HTMLElement
    expect(reloadBtn.textContent).toBe('Reload')
    fireEvent.click(reloadBtn)
    await flush()

    expect(q(container, '.hakka-crash-bar')).toBeNull()
    expect(q(container, '.test-panel')?.textContent).toBe('panel ok')
  })

  it('Reload on a still-broken panel re-attempts the mount (crashes again, not stuck on stale DOM)', async () => {
    let attempts = 0
    const AlwaysThrows = (): JSX.Element => {
      attempts++
      throw new Error(`boom: attempt ${attempts}`)
    }
    const { container } = render(() => <CrashBoundary>{() => <AlwaysThrows />}</CrashBoundary>)
    expect(attempts).toBe(1)
    expect(q(container, '.hakka-crash-bar')).toBeTruthy()

    fireEvent.click(q(container, '.hakka-crash-bar-btn') as Element)
    await flush()

    // Guards against a stuck no-op retry: a real second attempt must happen,
    // even though it crashes again since the underlying bug is still there.
    expect(attempts).toBe(2)
    expect(q(container, '.hakka-crash-bar')).toBeTruthy()
  })

  it('embedded mode renders the fallback as a contained banner, not a fixed viewport bar', () => {
    const { Panel } = makeThrowingPanel()
    const { container } = render(() => <CrashBoundary embedded>{() => <Panel />}</CrashBoundary>)
    const bar = q(container, '.hakka-crash-bar')
    expect(bar?.classList.contains('hakka-crash-bar-embedded')).toBe(true)
    expect(bar?.classList.contains('hakka-crash-bar-floating')).toBe(false)
  })

  it('floating mode (default) renders the fixed viewport bar', () => {
    const { Panel } = makeThrowingPanel()
    const { container } = render(() => <CrashBoundary>{() => <Panel />}</CrashBoundary>)
    const bar = q(container, '.hakka-crash-bar')
    expect(bar?.classList.contains('hakka-crash-bar-floating')).toBe(true)
    expect(bar?.classList.contains('hakka-crash-bar-embedded')).toBe(false)
  })
})

describe('InspectorRoot — production wiring smoke test', () => {
  beforeEach(() => {
    initStore({ forceInProcess: true })
  })

  afterEach(() => {
    destroyStore()
  })

  it('renders the real Inspector unchanged when nothing crashes', () => {
    const { container } = render(() => <InspectorRoot />)
    expect(q(container, '.hakka-toggle')).toBeTruthy()
    expect(q(container, '.hakka-crash-bar')).toBeNull()
  })
})
