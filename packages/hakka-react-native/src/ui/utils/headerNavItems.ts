/**
 * Pure nav-item data for Header.tsx's TabStrip — kept JSX-free (mirrors
 * statusColors.ts/rowSeverity.ts) so it's unit-testable without pulling a
 * .tsx component's react-native-svg imports into this package's JSX-less
 * test transform.
 *
 * Five fixed destinations: Network / Stats / Logs / Rules / Storage. Mock/
 * Breakpoints/Throttle live under "Rules"; Console/Structured under "Logs";
 * Info lives under Settings. Settings itself is deliberately NOT a
 * HeaderNavKey — it's the persistent header gear button, not routed through
 * TabStrip, so it never competes with these four for strip width.
 */
import type { TabStripItem } from '../components/TabStrip'

export type HeaderNavKey = 'network' | 'stats' | 'appLogs' | 'rules' | 'storage'

export const NAV_ITEMS: readonly TabStripItem<HeaderNavKey>[] = [
  { key: 'network', label: 'Network' },
  { key: 'stats', label: 'Stats' },
  { key: 'appLogs', label: 'Logs' },
  { key: 'rules', label: 'Rules' },
  { key: 'storage', label: 'Storage' },
]
