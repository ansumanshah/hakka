export interface FlatWindow<T> {
  slice: T[]
  padTop: number
  padBottom: number
}

/**
 * Windows an array of variable-height items by pixel offset rather than row
 * count — needed once grouped items mix fixed-height rows with taller
 * headers. Binary-searches a prefix sum of `heights` for the window start
 * (O(log n)); `heights[i]` is `items[i]`'s rendered height, missing = 0.
 */
export function windowFlatItems<T>(
  items: readonly T[],
  heights: readonly number[],
  scrollTop: number,
  viewportH: number,
  overscanPx: number,
): FlatWindow<T> {
  const n = items.length
  if (n === 0) return { slice: [], padTop: 0, padBottom: 0 }

  // prefix[i] = total height of items[0..i-1]; prefix[n] = grand total.
  const prefix: number[] = Array.from({ length: n + 1 }, () => 0)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + (heights[i] ?? 0)
  const total = prefix[n]!

  const windowTop = Math.max(0, scrollTop - overscanPx)
  const windowBottom = scrollTop + viewportH + overscanPx

  // Binary search: first index whose item extends past windowTop.
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (prefix[mid + 1]! <= windowTop) lo = mid + 1
    else hi = mid
  }
  const start = lo

  let end = start
  while (end < n && prefix[end]! < windowBottom) end++

  return {
    slice: items.slice(start, end),
    padTop: prefix[start]!,
    padBottom: total - prefix[end]!,
  }
}
