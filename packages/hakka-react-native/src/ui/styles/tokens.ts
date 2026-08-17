/**
 * Design Tokens - styling values for the Hakka RN UI.
 *
 * COLORS are sourced from ./tokens.generated.ts (mirrored from the repo-root
 * design-tokens.json by `just sync-tokens`) so RN, iOS, and Android share one
 * palette. Spacing/radii/type below are RN-specific (tuned to this layout).
 */

import { codeDark, codeLight, method, paletteDark, paletteLight, status } from './tokens.generated'

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  ml: 10,
  lg: 12,
  ll: 14,
  xl: 16,
  xxl: 20,
  xxxl: 24,
} as const

/** 4/6/10/14, matching iOS/Android/web. `md` is the radius DESIGN.md assigns to interactive controls. */
export const radius = {
  /** Hairline rounding on rails and bars, where a visible corner would read as a gap. */
  xs: 2,
  sm: 4,
  md: 6,
  lg: 10,
  xl: 14,
  // Non-interactive badges/tags/counts only — never an interactive control.
  pill: 999,
} as const

/**
 * Named page geometry — reach for `layout.gutter`, never a raw `spacing`
 * step, when setting a top-level page edge, so every screen shares one edge.
 */
export const layout = {
  /** The panel's left/right edge. Every top-level row, section title, and list row aligns here. */
  gutter: 16,
  /** Inner padding of a card or grouped box that already sits inside the gutter. */
  cardPadding: 12,
  /** Vertical gap between stacked sections. */
  sectionGap: 16,
  /** Vertical rhythm between rows inside one section. */
  rowGap: 8,
  /** Trailing space under a scroll view's content, so the last row clears the sheet edge. */
  scrollBottomInset: 40,
} as const

/**
 * The height scale every interactive control snaps to. Six steps, each with
 * a job — a control needing a height not on this list is the control that's
 * wrong, not the list.
 */
export const controlHeight = {
  /** Non-interactive count/status badge. */
  badge: 18,
  /** Interactive chip; also the track height of a switch. */
  chip: 24,
  /** Glyph button living inside a row (toolbar, list row, filter bar). */
  icon: 28,
  /** Mirrors web's `--hakka-ctl-h-md` (28px), the devtools-tight default height. */
  md: 28,
  /** Text field, and any button that sits beside one. */
  field: 36,
  /** Back/action button in a screen header. */
  nav: 40,
  /** Full-bleed row that hosts controls; also the minimum comfortable tap target. */
  bar: 44,
} as const

export const fontSize = {
  /** Micro-labels inside a pill (NATIVE, WS) — never body text. */
  xxs: 9,
  xs: 10,
  sm: 12,
  md: 13,
  lg: 15,
  xl: 16,
  xxl: 18,
  /** Display numerals — a stat card's value, not a label. */
  display: 22,
  hero: 26,
} as const

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
}

// Neutrals/status/method/code come from the shared design tokens; only the few
// RN-specific semantic aliases (badge, tabs) are defined here.

const black = '#1e1e1e'

export const lightColors = {
  background: paletteLight.background,
  backgroundAlt: paletteLight.surface,

  text: paletteLight.text,
  textMuted: paletteLight.textSecondary,
  textSubtle: paletteLight.textTertiary,

  border: paletteLight.border,

  active: paletteLight.textSecondary,

  success: status.success,
  error: status.error,
  info: status.info,
  // Wok Hei semantic aliases — jade (success) / chili (error, 5xx) / turmeric (warning, 4xx)
  jade: status.success,
  chili: status.error,
  turmeric: status.warning,

  methodGet: method.get,
  methodPost: method.post,
  methodPut: method.put,
  methodPatch: method.patch,
  methodDelete: method.delete,
  methodOther: method.other,

  warning: status.warning,
  pending: status.pending,

  badgeBg: status.error,
  badgeText: paletteLight.background,

  // Accent (flame) — active tabs, selected states, primary buttons, focus. Never info blue.
  accent: paletteLight.accent,

  tabActive: paletteLight.accent,
  tabInactive: paletteLight.textTertiary,

  headerBg: paletteLight.surface,

  codeBackground: paletteLight.surface,
  codeText: paletteLight.text,
  codeKey: paletteLight.text, // Bold weight distinguishes keys
  codeString: codeLight.string,
  codeNumber: codeLight.number,
  codeBoolean: codeLight.boolean,
  codeNull: codeLight.null,
  codePunctuation: paletteLight.textSecondary,
  codeHighlight: codeLight.highlight,
} as const

// Dark theme — navy palette, matching iOS/Android
export const darkColors = {
  background: paletteDark.background,
  backgroundAlt: paletteDark.surface,

  text: paletteDark.text,
  textMuted: paletteDark.textSecondary,
  textSubtle: paletteDark.textTertiary,

  border: paletteDark.border,

  active: paletteDark.textSecondary,

  success: status.success,
  error: status.error,
  info: status.info,
  // Wok Hei semantic aliases — jade (success) / chili (error, 5xx) / turmeric (warning, 4xx)
  jade: status.success,
  chili: status.error,
  turmeric: status.warning,

  methodGet: method.get,
  methodPost: method.post,
  methodPut: method.put,
  methodPatch: method.patch,
  methodDelete: method.delete,
  methodOther: method.other,

  warning: status.warning,
  pending: status.pending,

  badgeBg: status.error,
  badgeText: paletteDark.background,

  // Accent (flame) — active tabs, selected states, primary buttons, focus. Never info blue.
  accent: paletteDark.accent,

  tabActive: paletteDark.accent,
  tabInactive: paletteDark.textTertiary,

  headerBg: paletteDark.surfaceRaised,

  codeBackground: paletteDark.background,
  codeText: paletteDark.text,
  codeKey: paletteDark.text, // Bold weight distinguishes keys
  codeString: codeDark.string,
  codeNumber: codeDark.number,
  codeBoolean: codeDark.boolean,
  codeNull: codeDark.null,
  codePunctuation: paletteDark.textSecondary,
  codeHighlight: codeDark.highlight,
} as const

export const shadow = {
  sm: {
    shadowColor: black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
} as const

export const animation = {
  fast: 150,
  normal: 250,
  slow: 350,
} as const

export const opacity = {
  disabled: 0.4,
  hover: 0.8,
  pressed: 0.6,
} as const

export function statusColor(status_: number | undefined): string {
  if (status_ == null) return status.pending
  if (status_ < 300) return status.success
  if (status_ < 400) return status.warning
  return status.error
}
