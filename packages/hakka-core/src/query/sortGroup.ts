/**
 * Sort and group helpers for NetworkRequest arrays.
 * Pure functions, no side effects, no DOM.
 */

import type { NetworkRequest } from '../model/types'
import type { GroupBy, SortField, SortOrder } from './types'

function getSortValue(req: NetworkRequest, field: SortField): number {
  switch (field) {
    case 'time':
      return req.startTime
    case 'duration':
      return req.duration ?? (req.endTime != null ? req.endTime - req.startTime : 0)
    case 'size':
      return (req.requestBodySize ?? 0) + (req.responseBodySize ?? 0)
    case 'status':
      return req.status ?? 0
  }
}

/**
 * Return a stable-sorted copy of `reqs` by `field` in `order`.
 * The original array is not mutated.
 */
export function sortRequests(reqs: NetworkRequest[], field: SortField, order: SortOrder): NetworkRequest[] {
  // Copy for stability (preserve relative order of equal elements)
  const indexed = reqs.map((req, i) => ({ req, i }))

  indexed.sort((a, b) => {
    const av = getSortValue(a.req, field)
    const bv = getSortValue(b.req, field)
    if (av !== bv) {
      const diff = av - bv
      return order === 'asc' ? diff : -diff
    }
    // Stable: preserve original index order
    return a.i - b.i
  })

  return indexed.map(({ req }) => req)
}

// Caches url→host lookups: a capture's distinct URL set is small relative to
// its request count, so this turns most `new URL(req.url).host` calls into a
// Map read instead of a parse. Capped at HOST_CACHE_MAX with oldest-entry
// eviction (insertion order, not LRU) so unbounded unique-URL sessions can't
// grow it forever.
const HOST_CACHE_MAX = 2000
const hostCache = new Map<string, string>()

function extractHost(url: string): string {
  const cached = hostCache.get(url)
  if (cached !== undefined) return cached
  let host: string
  try {
    host = new URL(url).host
  } catch {
    host = url
  }
  if (hostCache.size >= HOST_CACHE_MAX) {
    const oldestKey = hostCache.keys().next().value
    if (oldestKey !== undefined) hostCache.delete(oldestKey)
  }
  hostCache.set(url, host)
  return host
}

/** Extract the grouping key for a request. */
function getGroupKey(req: NetworkRequest, by: GroupBy): string {
  switch (by) {
    case 'host':
      return extractHost(req.url)
    case 'status': {
      const status = req.status
      if (status == null) return 'pending'
      const cls = Math.floor(status / 100)
      return `${cls}xx`
    }
    case 'method':
      return req.method.toUpperCase()
    case 'error':
      return req.error ? 'error' : 'ok'
    case 'trace':
      return req.correlationId ?? ''
    case 'none':
      return ''
  }
}

/** Human-readable label for a group key. */
function getGroupLabel(key: string, by: GroupBy): string {
  switch (by) {
    case 'host':
      return key || 'unknown host'
    case 'status':
      switch (key) {
        case '1xx':
          return '1xx Informational'
        case '2xx':
          return '2xx Success'
        case '3xx':
          return '3xx Redirect'
        case '4xx':
          return '4xx Client Error'
        case '5xx':
          return '5xx Server Error'
        case 'pending':
          return 'Pending'
        default:
          return key
      }
    case 'method':
      return key
    case 'error':
      return key === 'error' ? 'Errors' : 'OK'
    case 'trace':
      return key ? `Trace ${key.slice(0, 8)}` : 'No trace'
    case 'none':
      return 'All'
  }
}

export interface RequestGroup {
  key: string
  label: string
  items: NetworkRequest[]
}

/**
 * Group `reqs` by `by`.
 *
 * Returns groups in the order their key first appears in the input,
 * preserving the input order of items within each group.
 *
 * When `by` is `'none'`, returns a single group containing all requests.
 */
export function groupRequests(reqs: NetworkRequest[], by: GroupBy): RequestGroup[] {
  if (by === 'none') {
    return [{ key: '', label: 'All', items: [...reqs] }]
  }

  const order: string[] = []
  const map = new Map<string, NetworkRequest[]>()

  for (const req of reqs) {
    const key = getGroupKey(req, by)
    if (!map.has(key)) {
      order.push(key)
      map.set(key, [])
    }
    map.get(key)!.push(req)
  }

  return order.map((key) => ({
    key,
    label: getGroupLabel(key, by),
    items: map.get(key)!,
  }))
}

/**
 * Wraps `groupRequests` with a `Map<key, RequestGroup>` across calls so a
 * group whose items are reference-equal to its previous items reuses the
 * same object, letting reference-keyed reconciliation (e.g. a `<For>`) skip
 * unchanged groups. Equality is per-index reference equality, not id
 * comparison — a request's second emit replaces the record object under the
 * same id, so an id-only check would keep serving a stale group. Resets the
 * cache whenever `by` changes (different key space).
 */
export function createGroupCache(): (reqs: NetworkRequest[], by: GroupBy) => RequestGroup[] {
  let cache = new Map<string, RequestGroup>()
  let lastBy: GroupBy | null = null

  return function regroup(reqs: NetworkRequest[], by: GroupBy): RequestGroup[] {
    if (by !== lastBy) {
      cache = new Map()
      lastBy = by
    }

    const fresh = groupRequests(reqs, by)
    const nextCache = new Map<string, RequestGroup>()

    const out = fresh.map((group) => {
      const prev = cache.get(group.key)
      const reused = prev && isShallowEqualItems(prev.items, group.items) ? prev : group
      nextCache.set(group.key, reused)
      return reused
    })

    cache = nextCache
    return out
  }
}

function isShallowEqualItems(a: NetworkRequest[], b: NetworkRequest[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
