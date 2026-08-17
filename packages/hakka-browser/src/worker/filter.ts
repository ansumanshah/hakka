/**
 * Pure request filter/search — shared by the Worker's `snapshot` query and any
 * caller that wants the identical matching semantics. No DOM, no side effects.
 */
import type { NetworkRequest } from 'hakka-core'

import type { StoreQuery } from './protocol'

function responseContentType(req: NetworkRequest): string {
  const headers = req.responseHeaders
  if (headers) {
    for (const key in headers) {
      if (key.toLowerCase() === 'content-type') return (headers[key] ?? '').toLowerCase()
    }
  }
  return (req.contentType ?? '').toLowerCase()
}

/** True when `req` satisfies every set field of `query`. */
export function matchesQuery(req: NetworkRequest, query: StoreQuery): boolean {
  const text = query.text?.toLowerCase().trim()
  if (text && !req.url.toLowerCase().includes(text) && !req.method.toLowerCase().includes(text)) {
    return false
  }

  const method = query.method?.toUpperCase()
  if (method && req.method.toUpperCase() !== method) return false

  if (query.statusRange && req.status != null) {
    const [lo, hi] = query.statusRange
    if (req.status < lo || req.status > hi) return false
  }

  const ct = query.contentType?.toLowerCase().trim()
  if (ct && !responseContentType(req).includes(ct)) return false

  const runtime = query.runtime?.toLowerCase().trim()
  if (runtime) {
    // Records without a runtime tag are client-side (browser capture).
    const reqRuntime = req.runtime ?? 'client'
    if (reqRuntime !== runtime) return false
  }

  return true
}

/** Filter a request list by a query. Returns the input untouched when the query is empty. */
export function filterRequests(requests: NetworkRequest[], query?: StoreQuery): NetworkRequest[] {
  if (!query) return requests
  const hasFilter = Boolean(query.text || query.method || query.statusRange || query.contentType || query.runtime)
  if (!hasFilter) return requests
  return requests.filter((req) => matchesQuery(req, query))
}
