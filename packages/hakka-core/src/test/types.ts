import type { NetworkRequest } from '../model/types'

/** Filter criteria for finding requests in a captured log; all fields are optional and AND-ed together. */
export interface RequestFilter {
  /** Substring or exact URL to match against `request.url`. */
  url?: string
  /** HTTP method (case-insensitive). */
  method?: string
  /** Expected HTTP status code. */
  status?: number
  /** Expected content-type substring (matches against responseHeaders or contentType). */
  contentType?: string
  /** Whether the request should have been intercepted by MockEngine. */
  mocked?: boolean
}

/** Options for the `captureWith` harness. */
export interface CaptureOptions {
  /** Maximum milliseconds to wait for async work after fn() resolves. Default: 0 (no extra wait). */
  flushMs?: number
}

/** The result returned by `captureWith`. */
export interface CaptureResult {
  /** All NetworkRequest objects captured during the fn() call. */
  requests: NetworkRequest[]
}
