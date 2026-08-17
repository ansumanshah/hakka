// Stats-page-local formatters. Distinct from the `formatMonitor*` helpers in
// `../utils/format`, which format the shared MonitorSummary fields — these
// cover the domain-stats/top-requests values computed inside Stats.tsx.

export const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`

export const formatMs = (value: number) => `${value.toFixed(0)}ms`

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function formatUrl(url: string): string {
  try {
    const match = url.match(/^https?:\/\/[^/]+(.*)/)
    return match && match[1] ? match[1].substring(0, 40) : url.substring(0, 40)
  } catch {
    return url.substring(0, 40)
  }
}
