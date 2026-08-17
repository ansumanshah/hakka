import type { NetworkRequest } from 'hakka-core'
/**
 * Tests for ui/mount.tsx — the inline-embed API (`mount(target, { panel })`).
 * Verifies the embed mounts cleanly (reuses the same Inspector component tree,
 * fills its container, no floating chrome), that it stays interactive
 * (setPanel, live captures via the shared store), and that it tears down
 * cleanly on unmount — including running independently alongside another
 * mounted instance.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
import { mount } from '../mount'

// ── localStorage mock (matches settings.test.tsx / Inspector.test.tsx) ─────

function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? (store[key] as string) : null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

const lsMock = makeLocalStorageMock()

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: `req-${Math.random().toString(36).slice(2)}`,
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    endTime: Date.now() + 100,
    duration: 100,
    requestHeaders: { accept: 'application/json' },
    responseHeaders: { 'content-type': 'application/json' },
    ...overrides,
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** mount() attaches a Shadow DOM under a wrapper div appended into `target`. */
function shadowOf(target: HTMLElement): ShadowRoot {
  const wrapper = target.firstElementChild as HTMLElement | null
  if (!wrapper?.shadowRoot) throw new Error('expected a shadow-rooted wrapper inside the mount target')
  return wrapper.shadowRoot
}

let client: StoreClient
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
  client = initStore({ forceInProcess: true })
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
  destroyStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('mount() — embed mode', () => {
  it('mounts inline (embedded panel, no floating toggle/close chrome)', async () => {
    const handle = mount(container, { panel: 'network' })
    await flush()

    const shadow = shadowOf(container)
    const panel = shadow.querySelector('.hakka-panel')
    expect(panel).toBeTruthy()
    expect(panel?.classList.contains('embedded')).toBe(true)
    expect(shadow.querySelector('.hakka-toggle')).toBeNull()
    expect(shadow.querySelector('.hakka-btn-close')).toBeNull()

    handle.unmount()
  })

  it('fills its container (width/height 100%, not the floating fixed overlay)', async () => {
    const handle = mount(container, { panel: 'network' })
    await flush()
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.width).toBe('100%')
    expect(wrapper.style.height).toBe('100%')
    handle.unmount()
  })

  it('shows the requested initial panel', async () => {
    const handle = mount(container, { panel: 'console' })
    await flush()
    const activeTab = shadowOf(container).querySelector('.hakka-tab.active')
    expect(activeTab?.textContent).toContain('Logs')
    handle.unmount()
  })

  it('falls back to the default (network) tab for an unknown panel id', async () => {
    const handle = mount(container, { panel: 'not-a-real-panel' })
    await flush()
    const activeTab = shadowOf(container).querySelector('.hakka-tab.active')
    expect(activeTab?.textContent).toContain('Network')
    handle.unmount()
  })

  it('renders captured requests — the embedded panel shares the same store/component tree', async () => {
    client.ingest(makeRequest({ url: 'https://api.example.com/embedded-req' }))
    const handle = mount(container, { panel: 'network' })
    await flush()
    expect(shadowOf(container).querySelector('.hakka-row-path')?.textContent).toContain('/embedded-req')
    handle.unmount()
  })

  it('setPanel() switches the active tab programmatically', async () => {
    const handle = mount(container, { panel: 'network' })
    await flush()
    handle.setPanel('storage')
    await flush()
    expect(shadowOf(container).querySelector('.hakka-tab.active')?.textContent).toContain('Storage')
    handle.unmount()
  })

  it('setPanel() with an unknown id is a no-op (stays on the current tab)', async () => {
    const handle = mount(container, { panel: 'network' })
    await flush()
    handle.setPanel('does-not-exist')
    await flush()
    expect(shadowOf(container).querySelector('.hakka-tab.active')?.textContent).toContain('Network')
    handle.unmount()
  })

  it('unmount() removes every node the embed added to the target', async () => {
    const handle = mount(container, { panel: 'network' })
    await flush()
    expect(container.children.length).toBeGreaterThan(0)
    handle.unmount()
    expect(container.children.length).toBe(0)
  })

  it('unmount() is idempotent', async () => {
    const handle = mount(container, { panel: 'network' })
    await flush()
    handle.unmount()
    expect(() => handle.unmount()).not.toThrow()
  })

  it('two embedded instances mount and unmount independently', async () => {
    const containerB = document.createElement('div')
    document.body.appendChild(containerB)

    const handleA = mount(container, { panel: 'network' })
    const handleB = mount(containerB, { panel: 'console' })
    await flush()

    expect(shadowOf(container).querySelector('.hakka-tab.active')?.textContent).toContain('Network')
    expect(shadowOf(containerB).querySelector('.hakka-tab.active')?.textContent).toContain('Logs')

    handleA.unmount()
    expect(container.children.length).toBe(0)
    // B is unaffected by A's teardown.
    expect(containerB.children.length).toBeGreaterThan(0)

    handleB.unmount()
    expect(containerB.children.length).toBe(0)
    containerB.remove()
  })
})
