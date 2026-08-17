import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

import { mockEngine } from '../../engine/MockEngine'
import type { NetworkRequest } from '../../model/types'
import { enableFetchInterceptor } from '../fetch'

// Verify maxBodySize truncation: bodies exceeding the limit are stored as null, while
// responseBodySize / requestBodySize always reflects the true byte length.
const REAL_FETCH = globalThis.fetch
const SMALL_MAX = 100 // deliberately tiny so a >100-char body is trimmed

/** Build a stub fetch that returns a canned text body. */
function makeStubFetch(body: string, status = 200) {
  return async (_input: unknown, _init?: RequestInit): Promise<Response> => {
    return new Response(body, {
      status,
      headers: { 'content-type': 'text/plain' },
    })
  }
}

/** Install stub as the underlying fetch, enable interceptor with SMALL_MAX. */
function withInterceptor(stub: (input: unknown, init?: RequestInit) => Promise<Response>): {
  records: NetworkRequest[]
  dispose: () => void
} {
  const records: NetworkRequest[] = []
  globalThis.fetch = stub as typeof globalThis.fetch
  const dispose = enableFetchInterceptor((r) => records.push(r), SMALL_MAX, [])
  return { records, dispose }
}

/** Wait for the background body-read to emit the second (updated) record. */
async function waitForBodyRecord(records: NetworkRequest[], timeout = 200): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    // Two records means the background body-read completed.
    if (records.length >= 2) return
    await new Promise((resolve) => setTimeout(resolve as () => void, 10))
  }
}

beforeEach(() => {
  mockEngine.clearRules()
})

afterEach(() => {
  mockEngine.clearRules()
  globalThis.fetch = REAL_FETCH
})

describe('maxBodySize — response body truncation', () => {
  it('retains a SHORT response body verbatim', async () => {
    const shortBody = 'hello' // 5 chars, well under 100
    const { records, dispose } = withInterceptor(makeStubFetch(shortBody))
    try {
      await globalThis.fetch('https://example.com/short')
      await waitForBodyRecord(records)

      // Final record is the second emission (background body read)
      const final = records[records.length - 1]
      expect(final.responseBodySize).toBe(shortBody.length)
      expect(final.responseBody).toBe(shortBody)
      expect(final.responseBodyTruncated).toBeFalsy()
    } finally {
      dispose()
    }
  })

  it('sets responseBody to null when response body exceeds maxBodySize', async () => {
    // Build a body longer than SMALL_MAX (100)
    const longBody = 'x'.repeat(200)
    const { records, dispose } = withInterceptor(makeStubFetch(longBody))
    try {
      await globalThis.fetch('https://example.com/large')
      await waitForBodyRecord(records)

      const final = records[records.length - 1]
      // readCappedBody cancels the stream at the cap rather than decoding the rest just to
      // size it, so size is best-known (>= cap) here. The stub carries no Content-Length
      // (Bun doesn't set one for a plain string body), exercising the decoded-so-far fallback.
      expect(final.responseBodySize).toBeGreaterThanOrEqual(SMALL_MAX)
      // Body must be null (not stored) when it exceeds the limit
      expect(final.responseBody).toBeNull()
      expect(final.responseBodyTruncated).toBe(true)
    } finally {
      dispose()
    }
  })
})

describe('maxBodySize — request body truncation', () => {
  it('retains a SHORT request body verbatim', async () => {
    const shortBody = 'short=yes' // 9 chars, well under 100
    const { records, dispose } = withInterceptor(makeStubFetch('ok'))
    try {
      await globalThis.fetch('https://example.com/api', { method: 'POST', body: shortBody })
      await waitForBodyRecord(records)

      const final = records[records.length - 1]
      expect(final.requestBodySize).toBe(shortBody.length)
      expect(final.requestBody).toBe(shortBody)
    } finally {
      dispose()
    }
  })

  it('sets requestBody to null when request body exceeds maxBodySize', async () => {
    const largeBody = 'b'.repeat(200)
    const { records, dispose } = withInterceptor(makeStubFetch('ok'))
    try {
      await globalThis.fetch('https://example.com/upload', { method: 'POST', body: largeBody })
      await waitForBodyRecord(records)

      const final = records[records.length - 1]
      // Size always reflects the actual byte count
      expect(final.requestBodySize).toBe(largeBody.length)
      // Body itself is dropped
      expect(final.requestBody).toBeNull()
    } finally {
      dispose()
    }
  })
})

describe('maxBodySize — boundary conditions', () => {
  it('body exactly at the limit is retained', async () => {
    const exactBody = 'e'.repeat(SMALL_MAX) // exactly 100 chars
    const { records, dispose } = withInterceptor(makeStubFetch(exactBody))
    try {
      await globalThis.fetch('https://example.com/boundary')
      await waitForBodyRecord(records)

      const final = records[records.length - 1]
      expect(final.responseBodySize).toBe(SMALL_MAX)
      expect(final.responseBody).toBe(exactBody)
      expect(final.responseBodyTruncated).toBeFalsy()
    } finally {
      dispose()
    }
  })

  it('body one char over the limit is suppressed', async () => {
    const overBody = 'f'.repeat(SMALL_MAX + 1)
    const { records, dispose } = withInterceptor(makeStubFetch(overBody))
    try {
      await globalThis.fetch('https://example.com/overby1')
      await waitForBodyRecord(records)

      const final = records[records.length - 1]
      expect(final.responseBodySize).toBeGreaterThanOrEqual(SMALL_MAX)
      expect(final.responseBody).toBeNull()
      expect(final.responseBodyTruncated).toBe(true)
    } finally {
      dispose()
    }
  })
})
