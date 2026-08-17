import type { NetworkRequest } from '../model/types'
import type { RequestFilter } from './types'

/**
 * Returns true if `request` matches every non-undefined field in `filter`.
 */
export function matchesFilter(request: NetworkRequest, filter: RequestFilter): boolean {
  if (filter.url !== undefined) {
    if (!request.url.includes(filter.url)) return false
  }

  if (filter.method !== undefined) {
    if (request.method.toUpperCase() !== filter.method.toUpperCase()) return false
  }

  if (filter.status !== undefined) {
    if (request.status !== filter.status) return false
  }

  if (filter.mocked !== undefined) {
    if (Boolean(request.mocked) !== filter.mocked) return false
  }

  if (filter.contentType !== undefined) {
    const ct =
      request.contentType ??
      request.responseHeaders?.['content-type'] ??
      request.responseHeaders?.['Content-Type'] ??
      ''
    if (!ct.includes(filter.contentType)) return false
  }

  return true
}

/**
 * Returns all requests in `logs` that match `filter`.
 */
export function filterRequests(logs: NetworkRequest[], filter: RequestFilter): NetworkRequest[] {
  return logs.filter((r) => matchesFilter(r, filter))
}

/**
 * Returns the first request in `logs` that matches `filter`, or `undefined`.
 */
export function findRequest(logs: NetworkRequest[], filter: RequestFilter): NetworkRequest | undefined {
  return logs.find((r) => matchesFilter(r, filter))
}
