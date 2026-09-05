/**
 * A standalone-elements equivalent of `setPreset()` — `hakka-browser/elements`
 * ships no such function itself, by design (docs' Theming section: "there's
 * no settings UI in these six elements; that lives in the Inspector shell").
 * This reproduces two of `ui/presets.ts`'s own curated bundles (`amber`,
 * `paper`) — token values copied verbatim from that file's `PRESETS` object,
 * not approximated — as direct per-element inline `--hakka-*` overrides, the
 * documented mechanism for theming elements outside the Inspector shell
 * (`el.style.setProperty('--hakka-accent', ...)`, ADR 0003 (d)).
 */
const ELEMENT_TAGS = [
  'hakka-request-list',
  'hakka-request-detail',
  'hakka-waterfall',
  'hakka-filter-bar',
  'hakka-stats',
  'hakka-json-tree',
] as const

export type ThemeName = 'navy' | 'amber' | 'paper'

export const THEME_NAMES: readonly ThemeName[] = ['navy', 'amber', 'paper']
export const THEME_LABELS: Record<ThemeName, string> = {
  navy: 'Navy (default)',
  amber: 'Amber',
  paper: 'Paper',
}

// 'navy' is intentionally empty — clearing every override restores the
// built-in default, same as ui/presets.ts's own `applyPresetToEl`.
const TOKENS: Record<ThemeName, Partial<Record<string, string>>> = {
  navy: {},
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

const ALL_KEYS = [
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
]

/**
 * Applies (or, for 'navy', clears) a token bundle directly on every one of
 * the six element hosts currently in the document — the standalone-elements
 * counterpart of `setPreset()` reaching every registered `<hakka-inspector>`
 * theme root. Elements created after this call (none, on this page — every
 * element mounts once) would need it re-applied; a longer-lived app with
 * elements mounting dynamically would call this again after each mount.
 */
export function applyTheme(name: ThemeName): void {
  const tokens = TOKENS[name]
  const els = document.querySelectorAll<HTMLElement>(ELEMENT_TAGS.join(', '))
  for (const el of els) {
    for (const key of ALL_KEYS) {
      const value = tokens[key]
      if (value) el.style.setProperty(`--hakka-${key}`, value)
      else el.style.removeProperty(`--hakka-${key}`)
    }
  }
}
