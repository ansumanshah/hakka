import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { mockEngine } from '../../engine/MockEngine'
import { HAKKA_TRACE_HEADER, configureTrace, setTraceProvider } from '../../engine/trace'
import { deriveTraceId } from '../../engine/traceparent'
import { TRACEPARENT_HEADER } from '../../engine/traceparent'
import type { NetworkRequest } from '../../model/types'
import { enableFetchInterceptor } from '../fetch'

// Regression coverage: the browser fetch interceptor previously injected ONLY
// `x-hakka-trace`, never a W3C `traceparent`, so an OTel-instrumented next hop had no
// incoming trace-id to continue and minted an unrelated one — breaking the
// `FrameworkSpan.traceId === deriveTraceId(NetworkRequest.correlationId)` join.

const REAL_FETCH = globalThis.fetch
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

function stubLocation(origin: string): void {
  ;(globalThis as Record<string, unknown>).location = { href: `${origin}/`, origin }
}

beforeEach(() => {
  mockEngine.clearRules()
})

afterEach(() => {
  mockEngine.clearRules()
  globalThis.fetch = REAL_FETCH
  configureTrace({ enabled: false, propagateOrigins: undefined })
  setTraceProvider(null)
  delete (globalThis as Record<string, unknown>).location
})

describe('fetch interceptor — trace propagation', () => {
  test('client-originated fetch emits BOTH x-hakka-trace and a matching traceparent', async () => {
    stubLocation('https://app.test')
    configureTrace({ enabled: true })

    let seenHeaders: Headers | undefined
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers)
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch

    const records: NetworkRequest[] = []
    const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
    try {
      await globalThis.fetch('https://app.test/api/products')

      expect(seenHeaders).toBeDefined()
      const hakkaTrace = seenHeaders!.get(HAKKA_TRACE_HEADER)
      expect(hakkaTrace).toBeTruthy()

      const traceparent = seenHeaders!.get(TRACEPARENT_HEADER)
      expect(traceparent).toBeTruthy()
      const match = TRACEPARENT_RE.exec(traceparent!)
      expect(match).not.toBeNull()

      // The invariant this fix establishes: the traceparent's trace-id segment is the SAME correlationId run through the shared derivation.
      expect(match?.[2]).toBe(deriveTraceId(hakkaTrace!))

      // The captured record's correlationId matches the x-hakka-trace header sent on the wire.
      expect(records[0]?.correlationId).toBe(hakkaTrace!)
    } finally {
      dispose()
    }
  })

  test('a server context (inherited trace provider) also gets a traceparent, not just x-hakka-trace', async () => {
    setTraceProvider(() => 'server-inherited-id')

    let seenHeaders: Headers | undefined
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers)
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch

    const dispose = enableFetchInterceptor(() => {}, 1_000_000, [])
    try {
      await globalThis.fetch('https://upstream.test/x')
      expect(seenHeaders?.get(HAKKA_TRACE_HEADER)).toBe('server-inherited-id')
      const traceparent = seenHeaders?.get(TRACEPARENT_HEADER)
      expect(TRACEPARENT_RE.exec(traceparent ?? '')?.[2]).toBe(deriveTraceId('server-inherited-id'))
    } finally {
      dispose()
    }
  })

  test('never overwrites a caller-supplied traceparent', async () => {
    stubLocation('https://app.test')
    configureTrace({ enabled: true })

    let seenHeaders: Headers | undefined
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers)
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch

    const dispose = enableFetchInterceptor(() => {}, 1_000_000, [])
    try {
      await globalThis.fetch('https://app.test/api/x', {
        headers: { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' },
      })
      expect(seenHeaders?.get(TRACEPARENT_HEADER)).toBe('00-11111111111111111111111111111111-2222222222222222-01')
    } finally {
      dispose()
    }
  })

  test('no trace context / not enabled: no traceparent header is added', async () => {
    let seenHeaders: Headers | undefined
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers)
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch

    const dispose = enableFetchInterceptor(() => {}, 1_000_000, [])
    try {
      await globalThis.fetch('https://app.test/api/x')
      expect(seenHeaders?.has(TRACEPARENT_HEADER)).toBe(false)
      expect(seenHeaders?.has(HAKKA_TRACE_HEADER)).toBe(false)
    } finally {
      dispose()
    }
  })
})
