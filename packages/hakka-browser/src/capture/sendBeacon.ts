import { type NetworkRequest } from 'hakka-core'

import type { StoreClient } from '../worker'

/**
 * `navigator.sendBeacon()` bypasses fetch/XHR, so analytics and crash beacons
 * are invisible to the core interceptors. Patch it to capture the url + payload
 * (fire-and-forget — no response body) and feed it into the same store.
 */
export function enableSendBeaconCapture(client: StoreClient): () => void {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return () => {}
  }

  const original = navigator.sendBeacon.bind(navigator)
  let counter = 0

  navigator.sendBeacon = function patched(url: string | URL, data?: BodyInit | null): boolean {
    const urlStr = typeof url === 'string' ? url : url.toString()
    const startTime = Date.now()
    const id = `beacon_${++counter}_${startTime}`
    let ok = false
    try {
      ok = original(url, data ?? undefined)
      return ok
    } finally {
      try {
        const body = typeof data === 'string' ? data : null
        client.ingest({
          id,
          url: urlStr,
          method: 'POST',
          status: ok ? 202 : 0,
          startTime,
          endTime: startTime,
          duration: 0,
          requestHeaders: {},
          responseHeaders: {},
          requestBody: body,
          requestBodySize: typeof data === 'string' ? data.length : 0,
          responseBody: null,
          error: ok ? null : 'sendBeacon returned false',
          source: 'fetch',
          library: 'sendBeacon',
        } as NetworkRequest)
      } catch {
        /* never let capture break a beacon */
      }
    }
  }

  return () => {
    navigator.sendBeacon = original
  }
}
