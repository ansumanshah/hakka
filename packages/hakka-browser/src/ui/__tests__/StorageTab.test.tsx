/**
 * Per-item delete + refresh for StorageTab are covered elsewhere; this file
 * covers add-entry rows and click-to-edit value behaviour for localStorage,
 * sessionStorage, and cookies.
 */
import { render, fireEvent } from '@solidjs/testing-library'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { StorageTab } from '../StorageTab'

/** Let a Solid 2 microtask-batched signal write settle before asserting —
 * same helper `elements/testHarness.ts`, `panels.test.tsx`, and
 * `Inspector.tabs.test.tsx` already use. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// happy-dom does not provide localStorage/sessionStorage unless
// --localstorage-file is set — stub minimal in-memory implementations
// (same shape as settings.test.tsx's harness).
function makeStorageMock(): Storage {
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

function clearAllCookies(): void {
  const raw = document.cookie
  if (!raw) return
  for (const part of raw.split(';')) {
    const key = part.split('=')[0]?.trim()
    if (key) document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

const lsMock = makeStorageMock()
const ssMock = makeStorageMock()

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  vi.stubGlobal('sessionStorage', ssMock)
  lsMock.clear()
  ssMock.clear()
  clearAllCookies()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function q(container: HTMLElement, sel: string): Element | null {
  return container.querySelector(sel)
}

function qa(container: HTMLElement, sel: string): Element[] {
  return Array.from(container.querySelectorAll(sel))
}

describe('StorageTab — add entry (localStorage)', () => {
  it('disables the Add button while the key is empty', () => {
    const { container } = render(() => <StorageTab active={true} />)
    const btn = q(container, '[aria-label="Add localStorage entry"]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  // Guards a Solid 2 crash: adding the first entry to an empty area (items
  // 0 -> 1) hit the insertExpression null-firstChild bug in
  // @solidjs/web 2.0.0-rc.0, fixed by patches/@solidjs%2Fweb@2.0.0-rc.0.patch.
  it('adds a new entry via the Add button and shows it in the table', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    const keyInput = q(container, '[aria-label="New localStorage key"]') as HTMLInputElement
    const valueInput = q(container, '[aria-label="New localStorage value"]') as HTMLInputElement

    fireEvent.input(keyInput, { target: { value: 'token' } })
    fireEvent.input(valueInput, { target: { value: 'abc123' } })
    // Solid 2 microtask-batches signal writes — flush before reading disabled state.
    await flush()

    const btn = q(container, '[aria-label="Add localStorage entry"]') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await flush()

    expect(localStorage.getItem('token')).toBe('abc123')
    expect(container.textContent).toContain('token')
    expect(container.textContent).toContain('abc123')
  })

  it('adds a new entry via Enter in the value input', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    const keyInput = q(container, '[aria-label="New localStorage key"]') as HTMLInputElement
    const valueInput = q(container, '[aria-label="New localStorage value"]') as HTMLInputElement

    fireEvent.input(keyInput, { target: { value: 'flag' } })
    fireEvent.input(valueInput, { target: { value: 'on' } })
    await flush()
    fireEvent.keyDown(valueInput, { key: 'Enter' })
    await flush()

    expect(localStorage.getItem('flag')).toBe('on')
  })

  it('clears the draft key/value after adding', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    const keyInput = q(container, '[aria-label="New localStorage key"]') as HTMLInputElement
    const valueInput = q(container, '[aria-label="New localStorage value"]') as HTMLInputElement

    fireEvent.input(keyInput, { target: { value: 'a' } })
    fireEvent.input(valueInput, { target: { value: 'b' } })
    await flush()
    fireEvent.click(q(container, '[aria-label="Add localStorage entry"]') as HTMLButtonElement)
    await flush()

    expect(keyInput.value).toBe('')
    expect(valueInput.value).toBe('')
  })

  it('ignores whitespace-only keys', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    const keyInput = q(container, '[aria-label="New localStorage key"]') as HTMLInputElement
    fireEvent.input(keyInput, { target: { value: '   ' } })
    await flush()
    const btn = q(container, '[aria-label="Add localStorage entry"]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

describe('StorageTab — add entry (sessionStorage)', () => {
  it('adds a new sessionStorage entry', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    const keyInput = q(container, '[aria-label="New sessionStorage key"]') as HTMLInputElement
    const valueInput = q(container, '[aria-label="New sessionStorage value"]') as HTMLInputElement

    fireEvent.input(keyInput, { target: { value: 'sid' } })
    fireEvent.input(valueInput, { target: { value: 'xyz' } })
    await flush()
    fireEvent.click(q(container, '[aria-label="Add sessionStorage entry"]') as HTMLButtonElement)
    await flush()

    expect(sessionStorage.getItem('sid')).toBe('xyz')
    // Should not leak into localStorage.
    expect(localStorage.getItem('sid')).toBeNull()
  })
})

describe('StorageTab — add entry (cookies)', () => {
  it('adds a new cookie with the default path', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    const keyInput = q(container, '[aria-label="New Cookies key"]') as HTMLInputElement
    const valueInput = q(container, '[aria-label="New Cookies value"]') as HTMLInputElement

    fireEvent.input(keyInput, { target: { value: 'theme' } })
    fireEvent.input(valueInput, { target: { value: 'dark' } })
    await flush()
    fireEvent.click(q(container, '[aria-label="Add Cookies entry"]') as HTMLButtonElement)
    await flush()

    expect(document.cookie).toContain('theme=dark')
  })

  it('does not expose an HttpOnly control in the cookie add row', () => {
    const { container } = render(() => <StorageTab active={true} />)
    const httpOnlyControls = qa(container, '[aria-label*="HttpOnly" i]')
    expect(httpOnlyControls.length).toBe(0)
  })

  it('exposes only name/value/path/expiry fields for cookies', () => {
    const { container } = render(() => <StorageTab active={true} />)
    expect(q(container, '[aria-label="New Cookies key"]')).toBeTruthy()
    expect(q(container, '[aria-label="New Cookies value"]')).toBeTruthy()
    expect(q(container, '[aria-label="New cookie path"]')).toBeTruthy()
    expect(q(container, '[aria-label*="New cookie expiry"]')).toBeTruthy()
  })
})

describe('StorageTab — inline edit (localStorage)', () => {
  beforeEach(() => {
    lsMock.setItem('existing', 'old-value')
  })

  it('clicking a value cell reveals an input pre-filled with the current value', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    const cell = q(container, '.hakka-kv-value-editable') as HTMLElement
    expect(cell.textContent).toContain('old-value')

    fireEvent.click(cell)
    // Solid 2 microtask-batches signal writes — flush before querying the input.
    await flush()

    const input = q(container, '[aria-label="Edit value for existing"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('old-value')
  })

  it('pressing Enter commits the edited value and persists it', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    fireEvent.click(q(container, '.hakka-kv-value-editable') as HTMLElement)
    await flush()

    const input = q(container, '[aria-label="Edit value for existing"]') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'new-value' } })
    await flush()
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()

    expect(localStorage.getItem('existing')).toBe('new-value')
    expect(q(container, '[aria-label="Edit value for existing"]')).toBeNull()
    expect(container.textContent).toContain('new-value')
  })

  it('pressing Escape cancels the edit and leaves the stored value untouched', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    fireEvent.click(q(container, '.hakka-kv-value-editable') as HTMLElement)
    await flush()

    const input = q(container, '[aria-label="Edit value for existing"]') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'discarded' } })
    await flush()
    fireEvent.keyDown(input, { key: 'Escape' })
    await flush()

    expect(localStorage.getItem('existing')).toBe('old-value')
    expect(q(container, '[aria-label="Edit value for existing"]')).toBeNull()
    expect(container.textContent).toContain('old-value')
  })

  it('blurring the input commits the edited value', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    fireEvent.click(q(container, '.hakka-kv-value-editable') as HTMLElement)
    await flush()

    const input = q(container, '[aria-label="Edit value for existing"]') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'blurred-value' } })
    await flush()
    fireEvent.blur(input)
    await flush()

    expect(localStorage.getItem('existing')).toBe('blurred-value')
  })
})

describe('StorageTab — inline edit (cookies)', () => {
  beforeEach(() => {
    document.cookie = 'session=abc; path=/'
  })

  it('editing a cookie value updates document.cookie', async () => {
    const { container } = render(() => <StorageTab active={true} />)
    const cells = qa(container, '.hakka-kv-value-editable')
    const sessionCell = cells.find((c) => c.textContent?.includes('abc')) as HTMLElement
    expect(sessionCell).toBeTruthy()

    fireEvent.click(sessionCell)
    await flush()
    const input = q(container, '[aria-label="Edit value for session"]') as HTMLInputElement
    expect(input.value).toBe('abc')

    fireEvent.input(input, { target: { value: 'def' } })
    await flush()
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()

    expect(document.cookie).toContain('session=def')
    expect(document.cookie).not.toContain('session=abc')
  })
})
