import type { NetworkRequest } from '../model/types'
import { filterRequests, findRequest } from './filter'
import { HakkaAssertionError } from './HakkaAssertionError'
import type { RequestFilter } from './types'

/**
 * Assert that `request` has a specific HTTP status code.
 */
export function assertStatus(request: NetworkRequest, expected: number): void {
  if (request.status !== expected) {
    throw new HakkaAssertionError(
      `Expected request to ${request.url} to have status ${expected}, got ${request.status ?? 'undefined'}`,
    )
  }
}

/**
 * Assert that the response body of `request` equals `expected` exactly.
 */
export function assertBody(request: NetworkRequest, expected: string): void {
  const actual = request.responseBody ?? ''
  if (actual !== expected) {
    throw new HakkaAssertionError(
      `Expected response body of ${request.url} to equal:\n  ${JSON.stringify(expected)}\ngot:\n  ${JSON.stringify(actual)}`,
    )
  }
}

/**
 * Assert that the response body contains `substring`.
 */
export function assertBodyContains(request: NetworkRequest, substring: string): void {
  const actual = request.responseBody ?? ''
  if (!actual.includes(substring)) {
    throw new HakkaAssertionError(
      `Expected response body of ${request.url} to contain ${JSON.stringify(substring)},\ngot: ${JSON.stringify(actual)}`,
    )
  }
}

/**
 * Assert that a response header exists and (optionally) has the expected value.
 */
export function assertResponseHeader(request: NetworkRequest, name: string, expected?: string): void {
  const headers = request.responseHeaders ?? {}
  const lowerName = name.toLowerCase()
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === lowerName)

  if (!entry) {
    throw new HakkaAssertionError(
      `Expected response header "${name}" to be present on ${request.url}, but it was missing.\nHeaders: ${JSON.stringify(headers)}`,
    )
  }

  if (expected !== undefined && entry[1] !== expected) {
    throw new HakkaAssertionError(
      `Expected response header "${name}" on ${request.url} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(entry[1])}`,
    )
  }
}

/**
 * Assert that a request header exists and (optionally) has the expected value.
 */
export function assertRequestHeader(request: NetworkRequest, name: string, expected?: string): void {
  const headers = request.requestHeaders ?? {}
  const lowerName = name.toLowerCase()
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === lowerName)

  if (!entry) {
    throw new HakkaAssertionError(
      `Expected request header "${name}" to be present on ${request.url}, but it was missing.\nHeaders: ${JSON.stringify(headers)}`,
    )
  }

  if (expected !== undefined && entry[1] !== expected) {
    throw new HakkaAssertionError(
      `Expected request header "${name}" on ${request.url} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(entry[1])}`,
    )
  }
}

/**
 * Assert that the request body matches `expected`.
 */
export function assertRequestBody(request: NetworkRequest, expected: string): void {
  const actual = request.requestBody ?? ''
  if (actual !== expected) {
    throw new HakkaAssertionError(
      `Expected request body of ${request.url} to equal:\n  ${JSON.stringify(expected)}\ngot:\n  ${JSON.stringify(actual)}`,
    )
  }
}

/**
 * Assert that the request errored (has an `error` field set).
 */
export function assertIsError(request: NetworkRequest): void {
  if (!request.error) {
    throw new HakkaAssertionError(
      `Expected request to ${request.url} to have failed with an error, but it succeeded (status ${request.status}).`,
    )
  }
}

/**
 * Assert that the request succeeded (no error, status 2xx or 3xx).
 */
export function assertIsSuccess(request: NetworkRequest): void {
  if (request.error) {
    throw new HakkaAssertionError(
      `Expected request to ${request.url} to have succeeded, but it errored: ${request.error}`,
    )
  }
  if (request.status != null && (request.status < 200 || request.status >= 400)) {
    throw new HakkaAssertionError(`Expected request to ${request.url} to have a success status, got ${request.status}`)
  }
}

/**
 * Assert that the request was intercepted by MockEngine.
 */
export function assertIsMocked(request: NetworkRequest): void {
  if (!request.mocked) {
    throw new HakkaAssertionError(`Expected request to ${request.url} to be mocked, but it was not.`)
  }
}

/**
 * Assert that at least one request in `logs` matches `filter`; throws with a clear message if none found.
 */
export function assertRequestMade(logs: NetworkRequest[], filter: RequestFilter): NetworkRequest {
  const match = findRequest(logs, filter)
  if (!match) {
    const desc = describeFilter(filter)
    throw new HakkaAssertionError(
      `Expected a request matching ${desc} to have been made, but none was found.\n` +
        `Captured ${logs.length} request(s):\n${summarizeLogs(logs)}`,
    )
  }
  return match
}

/**
 * Assert that no request in `logs` matches `filter`.
 */
export function assertRequestNotMade(logs: NetworkRequest[], filter: RequestFilter): void {
  const matches = filterRequests(logs, filter)
  if (matches.length > 0) {
    const desc = describeFilter(filter)
    throw new HakkaAssertionError(
      `Expected no request matching ${desc}, but found ${matches.length}:\n${summarizeLogs(matches)}`,
    )
  }
}

/**
 * Assert that exactly `count` requests match `filter`.
 */
export function assertRequestCount(logs: NetworkRequest[], filter: RequestFilter, count: number): void {
  const matches = filterRequests(logs, filter)
  if (matches.length !== count) {
    const desc = describeFilter(filter)
    throw new HakkaAssertionError(
      `Expected ${count} request(s) matching ${desc}, but found ${matches.length}:\n${summarizeLogs(matches)}`,
    )
  }
}

function describeFilter(filter: RequestFilter): string {
  const parts: string[] = []
  if (filter.method) parts.push(`method=${filter.method.toUpperCase()}`)
  if (filter.url) parts.push(`url~="${filter.url}"`)
  if (filter.status !== undefined) parts.push(`status=${filter.status}`)
  if (filter.contentType) parts.push(`contentType~="${filter.contentType}"`)
  if (filter.mocked !== undefined) parts.push(`mocked=${filter.mocked}`)
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : '{}'
}

function summarizeLogs(logs: NetworkRequest[]): string {
  if (logs.length === 0) return '  (none)'
  return logs
    .slice(0, 10)
    .map((r) => `  ${r.method.toUpperCase()} ${r.url} → ${r.status ?? r.error ?? 'pending'}`)
    .join('\n')
}
