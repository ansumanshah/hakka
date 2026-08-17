import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'
import { register as registerFilterBar } from 'hakka-browser/elements/filter-bar'
import { register as registerRequestDetail, TAG as REQUEST_DETAIL_TAG } from 'hakka-browser/elements/request-detail'
import { register as registerRequestList, TAG as REQUEST_LIST_TAG } from 'hakka-browser/elements/request-list'
import type { NetworkRequest } from 'hakka-core'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HakkaRozeniteEventMap } from '../../shared/protocol'
import App from '../App'

/** `App.tsx` calls Rozenite's own `useRozeniteDevToolsClient`, whose real
 * channel needs a CDP domain (device) or a `postMessage`-connected parent
 * frame (panel) — neither exists under happy-dom, so it's mocked here.
 * Vitest hoists `vi.mock` above every import, so `App`'s own import resolves
 * to this mock too. */
vi.mock('@rozenite/plugin-bridge', () => ({
  useRozeniteDevToolsClient: vi.fn(),
}))

const mockedUseClient = vi.mocked(useRozeniteDevToolsClient)

/** In-memory stand-in for `RozeniteDevToolsClient` — same shape used by
 * `panelStore.test.ts`/`react-native/bridge.test.ts`, plus a `listenerCount`
 * escape hatch so the unmount test can confirm subscriptions were torn down
 * without reaching into `App.tsx`'s internals. */
function createFakeClient() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const sent: Array<{ type: string; payload: unknown }> = []

  return {
    sent,
    send(type: string, payload: unknown) {
      sent.push({ type, payload })
    },
    onMessage(type: string, listener: (payload: unknown) => void) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
      return {
        remove: () => {
          set.delete(listener)
        },
      }
    },
    fire<TType extends keyof HakkaRozeniteEventMap>(type: TType, payload: HakkaRozeniteEventMap[TType]) {
      const set = listeners.get(type as string)
      if (!set) return
      for (const listener of set) listener(payload)
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0
    },
    close: vi.fn(),
  }
}

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://example.com/api',
    method: 'GET',
    startTime: 0,
    ...overrides,
  } as NetworkRequest
}

/** Minimal in-memory `localStorage` — `hakka-filter-bar`'s `FilterViewModel`
 * persists recent filters through it, and happy-dom doesn't reliably provide
 * one (same gap `hakka-browser/react`'s own tests work around). */
function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? (store[key] as string) : null),
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mount(): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(App))
  })
  await flush()
  return { container, root }
}

async function unmount(container: HTMLElement, root: Root): Promise<void> {
  await act(async () => root.unmount())
  container.remove()
}

const lsMock = makeLocalStorageMock()

beforeAll(() => {
  // Pre-registered before any mount — happy-dom's `CustomElementRegistry`
  // doesn't upgrade nodes created before their tag is defined (see
  // `hakka-browser/react`'s own `RequestList.test.tsx` for the identical note).
  registerFilterBar()
  registerRequestList()
  registerRequestDetail()
})

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  mockedUseClient.mockReset()
})

describe('<App>', () => {
  it('shows a connecting state before the Rozenite client is ready', async () => {
    mockedUseClient.mockReturnValue(null)
    const { container, root } = await mount()

    expect(container.textContent).toContain('Connecting to the app')
    expect(container.querySelector(REQUEST_LIST_TAG)).toBeNull()

    await unmount(container, root)
  })

  it('renders the filter bar, request list, and request detail once the client is ready', async () => {
    const client = createFakeClient()
    mockedUseClient.mockReturnValue(client as never)
    const { container, root } = await mount()

    expect(container.querySelector('hakka-filter-bar')).toBeTruthy()
    expect(container.querySelector(REQUEST_LIST_TAG)).toBeTruthy()
    expect(container.querySelector(REQUEST_DETAIL_TAG)).toBeTruthy()
    // The panel store asks the RN side to resend its backlog as soon as it's built.
    expect(client.sent).toContainEqual({ type: 'get-snapshot', payload: {} })

    await unmount(container, root)
  })

  it('selecting a request in the list shows it in the detail pane', async () => {
    const client = createFakeClient()
    mockedUseClient.mockReturnValue(client as never)
    const { container, root } = await mount()

    const request = makeRequest({ id: 'selected-one' })
    act(() => {
      client.fire('request', request)
    })
    await flush()

    const list = container.querySelector(REQUEST_LIST_TAG) as HTMLElement
    act(() => {
      list.dispatchEvent(new CustomEvent('hakka:select', { detail: { id: 'selected-one' }, bubbles: true }))
    })
    await flush()

    const detail = container.querySelector(REQUEST_DETAIL_TAG) as HTMLElement & { request: NetworkRequest | null }
    expect(detail.request).toEqual(request)

    await unmount(container, root)
  })

  it("unmount tears down the panel store's message listeners", async () => {
    const client = createFakeClient()
    mockedUseClient.mockReturnValue(client as never)
    const { container, root } = await mount()

    expect(client.listenerCount('request')).toBeGreaterThan(0)
    expect(client.listenerCount('cleared')).toBeGreaterThan(0)

    await unmount(container, root)

    expect(client.listenerCount('request')).toBe(0)
    expect(client.listenerCount('cleared')).toBe(0)
  })
})
