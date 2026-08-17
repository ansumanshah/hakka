/**
 * Pure color-resolution helpers for method/status-class chips. Kept JSX-free
 * (and out of components/Badge.tsx) so they're directly unit-testable —
 * Badge.tsx re-exports both for existing call sites.
 */
import type { Theme } from '../styles/createStyleSheet'

/** Resolve a method to its Wok Hei semantic color token. */
export function getMethodColor(method: string, colors: Theme['colors']): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return colors.methodGet
    case 'POST':
      return colors.methodPost
    case 'PUT':
      return colors.methodPut
    case 'PATCH':
      return colors.methodPatch
    case 'DELETE':
      return colors.methodDelete
    default:
      return colors.methodOther
  }
}

/**
 * Resolve a status-class filter chip ('all' | '1xx'..'5xx') to its Wok Hei
 * semantic tone. Mirrors the web reference (Inspector.tsx STATUS_TONES):
 * 1xx=pending, 2xx=jade(success), 3xx=steel(info), 4xx=turmeric(warning),
 * 5xx=chili(error), all=neutral. Returns a token color, never a raw hex —
 * callers render it as text/border on transparent bg when inactive, and as
 * background+contrast text when active (see Filters.tsx status chip strip).
 */
export function getStatusGroupColors(group: string, colors: Theme['colors']): { bg: string; text: string } {
  switch (group) {
    case '1xx':
      return { bg: colors.pending, text: colors.background }
    case '2xx':
      return { bg: colors.jade, text: colors.background }
    case '3xx':
      return { bg: colors.info, text: colors.background }
    case '4xx':
      return { bg: colors.turmeric, text: colors.background }
    case '5xx':
      return { bg: colors.chili, text: colors.background }
    default:
      return { bg: colors.textMuted, text: colors.background }
  }
}
