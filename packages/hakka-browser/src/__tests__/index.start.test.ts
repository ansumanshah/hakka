/**
 * Tests for start() re-applying settings persisted by the Settings tab, so a
 * developer's previous toggles take effect even when the overlay is never opened.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { start, destroy, isConsoleMirrorEnabled, saveUiState } from '../index'

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

// Capture-only options keep start() lightweight and deterministic.
const QUIET = { overlay: false as const, resourceTiming: false, captureBeacons: false, console: false }

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
})

afterEach(() => {
  destroy()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('start() — settings rehydration', () => {
  it('enables the console mirror from a persisted logToConsole', () => {
    saveUiState({ logToConsole: true })
    start(QUIET)
    expect(isConsoleMirrorEnabled()).toBe(true)
  })

  it('leaves the console mirror off when nothing is persisted and nothing is passed', () => {
    start(QUIET)
    expect(isConsoleMirrorEnabled()).toBe(false)
  })

  it('lets an explicit logToConsole:false override a persisted true', () => {
    saveUiState({ logToConsole: true })
    start({ ...QUIET, logToConsole: false })
    expect(isConsoleMirrorEnabled()).toBe(false)
  })

  it('honours an explicit logToConsole:true even with nothing persisted', () => {
    start({ ...QUIET, logToConsole: true })
    expect(isConsoleMirrorEnabled()).toBe(true)
  })
})
