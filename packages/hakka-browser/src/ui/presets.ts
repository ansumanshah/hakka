/**
 * Hakka-web theme API — CSS custom properties crossing the Shadow DOM boundary.
 *
 * Every visual token is a `--hakka-*` custom property, defaulted on `:host`
 * in tokens.css (generated). An INLINE style on the host element always wins
 * over the shadow tree's own `:host{}` rule, so a host page can override any
 * token without touching this package's CSS:
 *
 *   const el = document.querySelector('hakka-inspector')
 *   el.style.setProperty('--hakka-accent', '#ff3366')
 *
 * A plain page-level CSS rule (`hakka-inspector { --hakka-accent: ... }`)
 * also works, UNLESS a preset below is active — presets use the same
 * inline-style mechanism and inline always beats a stylesheet rule. Call
 * `setPreset('navy')` (the default) to fall back to plain CSS-rule overrides.
 *
 * Presets are curated bundles over the "Surfaces + text" and "JSON syntax
 * colors" token groups ONLY — status/method/timing stay constant across every
 * preset by design (DESIGN.md: picked mid-luminance to survive any ground,
 * so a request's meaning reads the same whichever preset is active).
 */
import { loadUiState, saveUiState } from './persist'

const MANAGED_KEYS = [
  'bg',
  'surface',
  'surface-raised',
  'border',
  'text',
  'text-secondary',
  'text-tertiary',
  'accent',
  'code-string',
  'code-number',
  'code-boolean',
  'code-null',
  'code-highlight',
] as const
type ManagedKey = (typeof MANAGED_KEYS)[number]
type PresetTokens = Partial<Record<ManagedKey, string>>

export type PresetName = 'navy' | 'light' | 'high-contrast' | 'amber' | 'matrix' | 'paper'

export const PRESET_NAMES: readonly PresetName[] = ['navy', 'light', 'high-contrast', 'amber', 'matrix', 'paper']

export const PRESET_LABELS: Record<PresetName, string> = {
  navy: 'Navy (default)',
  light: 'Light',
  'high-contrast': 'High contrast',
  amber: 'Amber',
  matrix: 'Matrix',
  paper: 'Paper',
}

const PRESET_COLOR_SCHEME: Record<PresetName, 'dark' | 'light'> = {
  navy: 'dark',
  light: 'light',
  'high-contrast': 'dark',
  amber: 'dark',
  matrix: 'dark',
  paper: 'light',
}

// navy = {} (no overrides) so switching back to navy is pixel-identical to
// tokens.css's built-in :host block. light mirrors tokens.css's existing
// :host([theme='light']) block verbatim.
const PRESETS: Record<PresetName, PresetTokens> = {
  navy: {},
  light: {
    bg: '#FAF8F4',
    surface: '#F2EFE8',
    'surface-raised': '#FFFFFF',
    border: '#E2DDD2',
    text: '#21201C',
    'text-secondary': '#57534A',
    'text-tertiary': '#8B857A',
    accent: '#E0761A',
    'code-string': '#B4552A',
    'code-number': '#2B6CB0',
    'code-boolean': '#8548AB',
    'code-null': '#8548AB',
    'code-highlight': '#F5E5C0',
  },
  'high-contrast': {
    bg: '#000000',
    surface: '#0D0D0D',
    'surface-raised': '#1A1A1A',
    border: '#5C5C5C',
    text: '#FFFFFF',
    'text-secondary': '#E6E6E6',
    'text-tertiary': '#B3B3B3',
    accent: '#FF9500',
  },
  amber: {
    bg: '#160F00',
    surface: '#211700',
    'surface-raised': '#2C1F00',
    border: '#4D3900',
    text: '#FFC864',
    'text-secondary': '#E0AC5C',
    'text-tertiary': '#8C6A2E',
    accent: '#FFB000',
  },
  matrix: {
    bg: '#000000',
    surface: '#040A04',
    'surface-raised': '#081208',
    border: '#1A3D1A',
    text: '#00FF41',
    'text-secondary': '#00CC33',
    'text-tertiary': '#227A2E',
    accent: '#00FF41',
  },
  paper: {
    bg: '#F5F0E1',
    surface: '#EDE6D3',
    'surface-raised': '#FFFDF7',
    border: '#D9CFB0',
    text: '#2B2620',
    'text-secondary': '#5C5340',
    'text-tertiary': '#8A8066',
    accent: '#B5651D',
    'code-string': '#A2603A',
    'code-number': '#3D6A94',
    'code-boolean': '#7A5A8C',
    'code-null': '#7A5A8C',
    'code-highlight': '#EDE0BE',
  },
}

export function isPresetName(v: unknown): v is PresetName {
  return typeof v === 'string' && (PRESET_NAMES as readonly string[]).includes(v)
}

/** Narrow an arbitrary (e.g. persisted) value to a known preset, defaulting to 'navy'. */
export function normalizePreset(v: unknown): PresetName {
  return isPresetName(v) ? v : 'navy'
}

export const MIN_PANEL_OPACITY = 0.4
export const MIN_PANEL_HEIGHT_PX = 240
/** Fixed ceiling applied in `applyPanelHeightToEl`, independent of any
 * caller-supplied `maxPx` — guards against a malformed persisted value (or a
 * direct `setPanelHeightPx` call) blowing the panel up to an unusable size. */
export const MAX_PANEL_HEIGHT_PX = 2000

export function clampPanelOpacity(v: number): number {
  if (Number.isNaN(v)) return 1
  return Math.min(1, Math.max(MIN_PANEL_OPACITY, v))
}

/** `maxPx` is the caller-supplied ceiling (typically a fraction of
 * window.innerHeight); the result never exceeds it, even when `maxPx` is
 * below `MIN_PANEL_HEIGHT_PX` — the caller's ceiling always wins over the
 * soft minimum. */
export function clampPanelHeightPx(v: number, maxPx: number): number {
  if (Number.isNaN(v)) return Math.min(MIN_PANEL_HEIGHT_PX, maxPx)
  return Math.min(maxPx, Math.max(MIN_PANEL_HEIGHT_PX, v))
}

// All three appliers set `--hakka-*` as an inline style on the theme root
// element; clearing a property (rather than setting it) restores its built-in
// default.

function applyPresetToEl(el: HTMLElement, preset: PresetName): void {
  for (const key of MANAGED_KEYS) el.style.removeProperty(`--hakka-${key}`)
  const tokens = PRESETS[preset]
  for (const key of Object.keys(tokens) as ManagedKey[]) {
    el.style.setProperty(`--hakka-${key}`, tokens[key]!)
  }
  el.style.colorScheme = PRESET_COLOR_SCHEME[preset]
}

function applyPanelOpacityToEl(el: HTMLElement, opacity: number): void {
  if (opacity >= 1) el.style.removeProperty('--hakka-panel-opacity')
  else el.style.setProperty('--hakka-panel-opacity', String(clampPanelOpacity(opacity)))
}

function applyPanelHeightToEl(el: HTMLElement, px: number): void {
  if (px <= 0) el.style.removeProperty('--hakka-panel-height')
  else el.style.setProperty('--hakka-panel-height', `${clampPanelHeightPx(px, MAX_PANEL_HEIGHT_PX)}px`)
}

// A page can have more than one Hakka instance live at once (the floating
// overlay plus one or more mount() embeds) — every registered root is kept in
// sync with the same persisted preset/opacity/height.
const activeRoots = new Set<HTMLElement>()

/** Register a theme root (called once per Inspector mount); returns the matching unregister function. */
export function registerThemeRoot(el: HTMLElement): () => void {
  activeRoots.add(el)
  const state = loadUiState()
  applyPresetToEl(el, normalizePreset(state.preset))
  applyPanelOpacityToEl(el, state.panelOpacity)
  applyPanelHeightToEl(el, state.panelHeightPx)
  return () => {
    activeRoots.delete(el)
  }
}

/** Select a preset (persists + applies to every currently registered theme root). */
export function setPreset(preset: PresetName): void {
  saveUiState({ preset })
  for (const el of activeRoots) applyPresetToEl(el, preset)
}

/** Set the floating panel's opacity (0.4-1; persists + applies to every registered theme root). */
export function setPanelOpacity(opacity: number): void {
  const clamped = clampPanelOpacity(opacity)
  saveUiState({ panelOpacity: clamped })
  for (const el of activeRoots) applyPanelOpacityToEl(el, clamped)
}

/** Set the floating panel's height in px (0 = unset/CSS default; persists +
 * applies), clamped to [MIN_PANEL_HEIGHT_PX, MAX_PANEL_HEIGHT_PX]. */
export function setPanelHeightPx(px: number): void {
  const clamped = px <= 0 ? 0 : clampPanelHeightPx(px, MAX_PANEL_HEIGHT_PX)
  saveUiState({ panelHeightPx: clamped })
  for (const el of activeRoots) applyPanelHeightToEl(el, clamped)
}
