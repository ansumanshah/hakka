// Runtime timing/heap sampling primitives for the floating monitor's JS-thread
// health readout (event-loop lag, FPS, Hermes heap). Kept dependency-free
// (no React) so `useMonitorRuntimeMetrics` can sample them from timers/RAF.

export function monotonicNowMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance
  return typeof perf?.now === 'function' ? perf.now() : Date.now()
}

export function requestFrame(callback: () => void): number | null {
  const scheduler = globalThis as {
    requestAnimationFrame?: (callback: () => void) => number
  }
  return typeof scheduler.requestAnimationFrame === 'function' ? scheduler.requestAnimationFrame(callback) : null
}

export function cancelFrame(id: number | null): void {
  if (id === null) return
  const scheduler = globalThis as {
    cancelAnimationFrame?: (id: number) => void
  }
  if (typeof scheduler.cancelAnimationFrame === 'function') scheduler.cancelAnimationFrame(id)
}

export function getHermesHeapBytes(): number | null {
  const runtime = globalThis as {
    HermesInternal?: {
      getRuntimeProperties?: () => Record<string, unknown>
    }
  }
  const properties = runtime.HermesInternal?.getRuntimeProperties?.()
  if (!properties) return null

  const preferredKeys = ['JSVMHeapSize', 'JSVMAllocatedBytes', 'HermesHeapSize', 'heapSize']
  for (const key of preferredKeys) {
    const value = finiteRuntimeNumber(properties[key])
    if (value !== null && value > 0) return value
  }

  for (const [key, raw] of Object.entries(properties)) {
    const normalized = key.toLowerCase()
    if (!normalized.includes('heap')) continue
    if (!normalized.includes('size') && !normalized.includes('allocated') && !normalized.includes('used')) continue
    const value = finiteRuntimeNumber(raw)
    if (value !== null && value > 0) return value
  }

  return null
}

function finiteRuntimeNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(numberValue) ? numberValue : null
}

export function percentile(values: readonly number[], rank: number): number | null {
  if (values.length === 0) return null
  const sorted = Array.from(values).sort((a, b) => a - b)
  const index = Math.ceil(sorted.length * rank) - 1
  return Math.round(sorted[Math.max(0, Math.min(sorted.length - 1, index))])
}
