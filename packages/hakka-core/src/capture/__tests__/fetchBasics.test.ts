import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { mockEngine } from '../../engine/MockEngine'
import type { NetworkRequest } from '../../model/types'
import { enableFetchInterceptor } from '../fetch'

// Core basics of enableFetchInterceptor not covered by fetchSafety.test.ts (return timing
// + fail-open), maxBodySize.test.ts (truncation), or rewrite.test.ts (rewrite/mock/breakpoints):
// the two-phase emission shape, a genuine network rejection, a static mock short-circuit,
// and that teardown() restores the pre-enable fetch reference.
const REAL_FETCH = globalThis.fetch

beforeEach(() => {
  mockEngine.clearRules()
})

afterEach(() => {
  mockEngine.clearRules()
  globalThis.fetch = REAL_FETCH
})

describe('fetch interceptor — success two-phase emission', () => {
  test('emits a headers-only record immediately, then a body-carrying update for the same id', async () => {
    globalThis.fetch = (async (_input: unknown, _init?: RequestInit) =>
      new Response('{"ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch

    const records: NetworkRequest[] = []
    const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, ['authorization'])
    try {
      await globalThis.fetch('https://api.example.com/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
        body: '{"q":"test"}',
      })

      // Wait for the detached background body-read to emit the second record.
      const deadline = Date.now() + 500
      while (records.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      expect(records).toHaveLength(2)

      const phase1 = records[0]!
      expect(phase1.url).toBe('https://api.example.com/data')
      expect(phase1.method).toBe('POST')
      expect(phase1.status).toBe(201)
      expect(phase1.source).toBe('fetch')
      expect(phase1.requestHeaders?.authorization).toBe('[REDACTED]')
      expect(phase1.requestBody).toBe('{"q":"test"}')
      // Headers-received phase never has the body yet.
      expect(phase1.responseBody).toBeNull()
      expect(phase1.responseBodySize).toBe(0)

      const phase2 = records[1]!
      expect(phase2.id).toBe(phase1.id)
      expect(phase2.responseBody).toBe('{"ok":true}')
      expect(phase2.responseBodySize).toBe('{"ok":true}'.length)
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — error capture', () => {
  test('a genuine network-level rejection (not a Hakka prologue throw) is captured with status null', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Network failure')
    }) as typeof globalThis.fetch

    const records: NetworkRequest[] = []
    const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
    try {
      await expect(globalThis.fetch('https://api.example.com/fail')).rejects.toThrow('Network failure')

      expect(records).toHaveLength(1)
      expect(records[0]!.error).toBe('Network failure')
      expect(records[0]!.status).toBeNull()
      expect(records[0]!.responseBody).toBeNull()
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — mock short-circuit via mockEngine', () => {
  test('a static (non-bodyProvider) mock rule serves its response without ever calling the real fetch', async () => {
    let realFetchCalls = 0
    globalThis.fetch = (async () => {
      realFetchCalls++
      return new Response('real-network-body', { status: 200 })
    }) as typeof globalThis.fetch

    mockEngine.addRule({
      pattern: '/mocked',
      method: 'GET',
      response: {
        status: 202,
        headers: { 'x-hakka-mock': 'yes' },
        body: { mocked: true },
      },
      enabled: true,
    })

    const records: NetworkRequest[] = []
    const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
    try {
      const response = await globalThis.fetch('https://api.example.com/mocked')
      const body = await response.text()

      expect(realFetchCalls).toBe(0)
      expect(response.status).toBe(202)
      expect(response.headers.get('x-hakka-mock')).toBe('yes')
      expect(body).toBe('{"mocked":true}')

      expect(records).toHaveLength(1)
      expect(records[0]?.mocked).toBe(true)
      expect(records[0]?.status).toBe(202)
      expect(records[0]?.responseBody).toBe('{"mocked":true}')
    } finally {
      dispose()
    }
  })

  // Regression: promoting a capture with two Set-Cookie values into a mock rule (see
  // `apps/hakka/Sources/Core/Rules/CapturedMockConverter.swift`'s `headerValues` widening)
  // must survive capture -> mock -> applied response with both cookies distinct, never
  // comma-folded into one (RFC 6265 §3 forbids folding Set-Cookie).
  test('a mock rule with two headerValues Set-Cookie entries serves both distinctly, not comma-joined', async () => {
    globalThis.fetch = (async () => new Response('real-network-body', { status: 200 })) as typeof globalThis.fetch

    mockEngine.addRule({
      pattern: '/mocked-cookies',
      method: 'GET',
      response: {
        status: 200,
        headers: { 'set-cookie': 'session=abc' },
        headerValues: { 'set-cookie': ['session=abc; Path=/', 'consent=yes; Path=/'] },
        body: '',
      },
      enabled: true,
    })

    const dispose = enableFetchInterceptor(() => {}, 1_000_000, [])
    try {
      const response = await globalThis.fetch('https://api.example.com/mocked-cookies')

      expect(response.headers.getSetCookie()).toEqual(['session=abc; Path=/', 'consent=yes; Path=/'])
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — teardown restores the original fetch', () => {
  test('teardown() puts back the exact fetch reference that was active before enable', () => {
    const preEnableFetch = globalThis.fetch
    const dispose = enableFetchInterceptor(() => {}, 1_000_000, [])

    expect(globalThis.fetch).not.toBe(preEnableFetch)

    dispose()

    expect(globalThis.fetch).toBe(preEnableFetch)
  })

  test('a second enable call after teardown intercepts again (not a stale no-op)', async () => {
    globalThis.fetch = (async () => new Response('ok', { status: 200 })) as typeof globalThis.fetch
    const preEnableFetch = globalThis.fetch

    const firstDispose = enableFetchInterceptor(() => {}, 1_000_000, [])
    firstDispose()
    expect(globalThis.fetch).toBe(preEnableFetch)

    const records: NetworkRequest[] = []
    const secondDispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
    try {
      await globalThis.fetch('https://api.example.com/again')
      expect(records.length).toBeGreaterThan(0)
    } finally {
      secondDispose()
    }
  })
})
