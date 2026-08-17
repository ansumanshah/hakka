// ui/presets.ts applies curated presets + panel opacity/height as `--hakka-*`
// CSS custom properties on a "theme root" via inline style — the same
// mechanism a host page uses to override any of these vars itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { loadUiState, saveUiState } from '../persist'
import {
  registerThemeRoot,
  setPreset,
  setPanelOpacity,
  setPanelHeightPx,
  normalizePreset,
  isPresetName,
  clampPanelOpacity,
  clampPanelHeightPx,
  PRESET_NAMES,
  PRESET_LABELS,
  MIN_PANEL_OPACITY,
  MIN_PANEL_HEIGHT_PX,
  MAX_PANEL_HEIGHT_PX,
} from '../presets'

// happy-dom does not provide localStorage unless --localstorage-file is set
// (matches settings.test.tsx).
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

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('presets — data', () => {
  it('exposes exactly the 6 required curated presets, navy first (default)', () => {
    expect(PRESET_NAMES).toEqual(['navy', 'light', 'high-contrast', 'amber', 'matrix', 'paper'])
  })

  it('every preset has a human label', () => {
    for (const p of PRESET_NAMES) {
      expect(typeof PRESET_LABELS[p]).toBe('string')
      expect(PRESET_LABELS[p].length).toBeGreaterThan(0)
    }
  })

  it('isPresetName / normalizePreset narrow to a known preset, defaulting to navy', () => {
    expect(isPresetName('amber')).toBe(true)
    expect(isPresetName('sepia')).toBe(false)
    expect(normalizePreset('matrix')).toBe('matrix')
    expect(normalizePreset('not-a-preset')).toBe('navy')
    expect(normalizePreset(undefined)).toBe('navy')
    expect(normalizePreset(42)).toBe('navy')
  })
})

describe('presets — clamping helpers', () => {
  it('clampPanelOpacity clamps to [MIN_PANEL_OPACITY, 1]', () => {
    expect(clampPanelOpacity(2)).toBe(1)
    expect(clampPanelOpacity(0)).toBe(MIN_PANEL_OPACITY)
    expect(clampPanelOpacity(0.7)).toBe(0.7)
    expect(clampPanelOpacity(Number.NaN)).toBe(1)
  })

  it('clampPanelHeightPx clamps to [MIN_PANEL_HEIGHT_PX, maxPx] when maxPx >= MIN_PANEL_HEIGHT_PX', () => {
    expect(clampPanelHeightPx(10, 900)).toBe(MIN_PANEL_HEIGHT_PX)
    expect(clampPanelHeightPx(5000, 900)).toBe(900)
    expect(clampPanelHeightPx(500, 900)).toBe(500)
  })

  it('clampPanelHeightPx never returns above maxPx, even when maxPx < MIN_PANEL_HEIGHT_PX (e.g. a very short viewport)', () => {
    // A tiny viewport can put maxPx below the soft MIN_PANEL_HEIGHT_PX
    // floor — the caller's ceiling must still win.
    expect(clampPanelHeightPx(150, 100)).toBe(100)
    expect(clampPanelHeightPx(5000, 100)).toBe(100)
    expect(clampPanelHeightPx(Number.NaN, 100)).toBe(100)
  })
})

describe('presets — applying tokens to a registered theme root', () => {
  it('navy (default) applies no color overrides — pixel-identical to the built-in :host defaults', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    expect(el.style.getPropertyValue('--hakka-bg')).toBe('')
    expect(el.style.getPropertyValue('--hakka-accent')).toBe('')
    expect(el.style.getPropertyValue('--hakka-text')).toBe('')
  })

  it('registerThemeRoot applies an already-persisted preset immediately on registration', () => {
    saveUiState({ preset: 'amber' })
    const el = document.createElement('div')
    registerThemeRoot(el)
    expect(el.style.getPropertyValue('--hakka-accent')).toBe('#FFB000')
    expect(el.style.getPropertyValue('--hakka-bg')).toBe('#160F00')
  })

  it('setPreset applies tokens to a registered root and persists the choice', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    setPreset('matrix')
    expect(el.style.getPropertyValue('--hakka-text')).toBe('#00FF41')
    expect(el.style.getPropertyValue('--hakka-accent')).toBe('#00FF41')
    expect(loadUiState().preset).toBe('matrix')
  })

  it('setPreset applies to every currently registered root (multi-instance)', () => {
    const elA = document.createElement('div')
    const elB = document.createElement('div')
    registerThemeRoot(elA)
    registerThemeRoot(elB)
    setPreset('paper')
    expect(elA.style.getPropertyValue('--hakka-bg')).toBe('#F5F0E1')
    expect(elB.style.getPropertyValue('--hakka-bg')).toBe('#F5F0E1')
  })

  it('light preset matches the existing theme="light" attribute token values', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    setPreset('light')
    expect(el.style.getPropertyValue('--hakka-bg')).toBe('#FAF8F4')
    expect(el.style.getPropertyValue('--hakka-surface-raised')).toBe('#FFFFFF')
    expect(el.style.getPropertyValue('--hakka-accent')).toBe('#E0761A')
    expect(el.style.getPropertyValue('--hakka-code-string')).toBe('#B4552A')
  })

  it('high-contrast/amber/matrix leave status/method/timing tokens untouched (DESIGN.md: they survive every ground)', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    for (const preset of ['high-contrast', 'amber', 'matrix'] as const) {
      setPreset(preset)
      expect(el.style.getPropertyValue('--hakka-status-error')).toBe('')
      expect(el.style.getPropertyValue('--hakka-method-post')).toBe('')
      expect(el.style.getPropertyValue('--hakka-timing-ttfb')).toBe('')
    }
  })

  it('switching back to navy clears a previously applied preset entirely', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    setPreset('paper')
    expect(el.style.getPropertyValue('--hakka-bg')).not.toBe('')
    setPreset('navy')
    expect(el.style.getPropertyValue('--hakka-bg')).toBe('')
    expect(el.style.getPropertyValue('--hakka-accent')).toBe('')
    expect(el.style.getPropertyValue('--hakka-code-string')).toBe('')
  })

  it('an unregistered root no longer receives later setPreset calls', () => {
    const el = document.createElement('div')
    const unregister = registerThemeRoot(el)
    unregister()
    setPreset('amber')
    expect(el.style.getPropertyValue('--hakka-accent')).toBe('')
    // ...but the choice is still persisted for the next mount.
    expect(loadUiState().preset).toBe('amber')
  })
})

describe('presets — panel opacity', () => {
  it('applies --hakka-panel-opacity and persists, clamped to [MIN_PANEL_OPACITY, 1]', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    setPanelOpacity(0.6)
    expect(el.style.getPropertyValue('--hakka-panel-opacity')).toBe('0.6')
    expect(loadUiState().panelOpacity).toBe(0.6)

    setPanelOpacity(0.1)
    expect(loadUiState().panelOpacity).toBe(MIN_PANEL_OPACITY)
  })

  it('opacity 1 clears the override — pixel-identical to the default', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    setPanelOpacity(0.5)
    expect(el.style.getPropertyValue('--hakka-panel-opacity')).not.toBe('')
    setPanelOpacity(1)
    expect(el.style.getPropertyValue('--hakka-panel-opacity')).toBe('')
  })
})

describe('presets — panel height', () => {
  it('applies --hakka-panel-height in px and persists', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    setPanelHeightPx(500)
    expect(el.style.getPropertyValue('--hakka-panel-height')).toBe('500px')
    expect(loadUiState().panelHeightPx).toBe(500)
  })

  it('0 clears the override — pixel-identical to the CSS default (80vh)', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    setPanelHeightPx(500)
    setPanelHeightPx(0)
    expect(el.style.getPropertyValue('--hakka-panel-height')).toBe('')
    expect(loadUiState().panelHeightPx).toBe(0)
  })

  it('applies and persists, clamped to MAX_PANEL_HEIGHT_PX (mirrors setPanelOpacity clamping to [MIN_PANEL_OPACITY, 1])', () => {
    const el = document.createElement('div')
    registerThemeRoot(el)
    setPanelHeightPx(50000)
    expect(el.style.getPropertyValue('--hakka-panel-height')).toBe(`${MAX_PANEL_HEIGHT_PX}px`)
    expect(loadUiState().panelHeightPx).toBe(MAX_PANEL_HEIGHT_PX)
  })

  it('registerThemeRoot clamps an already-persisted out-of-range height on mount, not just on setPanelHeightPx', () => {
    // applyPanelHeightToEl is the single DOM-apply layer used both here and by
    // setPanelHeightPx — it must clamp a malformed/hand-edited persisted value too.
    saveUiState({ panelHeightPx: 999999 })
    const el = document.createElement('div')
    registerThemeRoot(el)
    expect(el.style.getPropertyValue('--hakka-panel-height')).toBe(`${MAX_PANEL_HEIGHT_PX}px`)
  })
})
