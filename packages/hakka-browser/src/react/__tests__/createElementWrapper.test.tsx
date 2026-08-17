import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createElementWrapper } from '../createElementWrapper'
import { flush } from '../testHarness'

/**
 * Isolated unit test for `createElementWrapper`, against a hand-rolled fake
 * element rather than a real `hakka-browser/elements` one — see
 * `RequestList.test.tsx`/`JsonTree.test.tsx` for integration coverage. Kept
 * separate because happy-dom's `CustomElementRegistry.upgrade()` is a no-op
 * (a node created before `register()` runs never becomes a real instance
 * here, unlike a real browser). What's testable regardless of upgrade timing:
 * `register` runs lazily, from an effect, after mount — not during render.
 */

let roots: Root[] = []
let containers: HTMLElement[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount()
  })
  for (const c of containers) c.remove()
  roots = []
  containers = []
  vi.restoreAllMocks()
})

async function mount(el: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(el)
  })
  await flush()
  return container
}

describe('createElementWrapper', () => {
  it('calls register() lazily, after mount, not synchronously during render', () => {
    const register = vi.fn()
    createElementWrapper('fake-widget', register, {})
    // Must not fire synchronously during render — only mount's later
    // flush() (which lets effects run) should. Runs before any render/effect
    // fires, isolating the "not during render" half of the claim.
    expect(register).not.toHaveBeenCalled()
  })

  it('invokes register() once mounted', async () => {
    const register = vi.fn()
    const Widget = createElementWrapper<{ label?: string }>('fake-widget-2', register, {})

    await mount(createElement(Widget, { label: 'hi' }))

    expect(register).toHaveBeenCalledTimes(1)
  })
})
