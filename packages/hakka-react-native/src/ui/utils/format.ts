/**
 * Display-string formatters for the floating bubble and stats views — pure
 * number/label → string conversions, no aggregation logic.
 */

export function formatCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return `${count}`
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 10000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value / 1000)}s`
}

export function formatFps(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return `${Math.round(value)} fps`
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatNullablePercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return `${Math.round(value)}%`
}

export function readableMonitorLabel(label: string): string {
  switch (label) {
    case 'ERR':
      return 'Errors'
    case 'FRZ':
      return 'Frozen'
    case 'JNK':
      return 'Jank'
    case 'P95':
    case 'JS':
    case 'UX':
      return label
    default:
      return label
  }
}
