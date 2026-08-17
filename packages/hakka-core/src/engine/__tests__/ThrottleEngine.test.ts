import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

import { enableFetchInterceptor } from '../../capture/fetch'
import { ThrottleEngine } from '../ThrottleEngine'

// These tests verify that ThrottleEngine is actually applied through the
// fetch interceptor — not just chip selection, but real delay + offline error.

const REAL_FETCH = globalThis.fetch
const MAX_BODY = 1_000_000

/** Stub that resolves instantly with a 200 OK. */
function makeInstantStub() {
  return (_input: unknown, _init: RequestInit | undefined): Promise<Response> =>
    Promise.resolve(new Response('ok', { status: 200 }))
}

/** Install a stub as the underlying network, then enable the interceptor. */
function withInterceptor(stub: (input: unknown, init: RequestInit | undefined) => Promise<Response>): {
  dispose: () => void
} {
  globalThis.fetch = ((input: unknown, init?: RequestInit) => stub(input, init)) as typeof globalThis.fetch
  const dispose = enableFetchInterceptor(() => {}, MAX_BODY, [])
  return { dispose }
}

beforeEach(() => {
  ThrottleEngine.setProfile('none')
})

afterEach(() => {
  ThrottleEngine.setProfile('none')
  globalThis.fetch = REAL_FETCH
})

describe('ThrottleEngine.throttleResponse', () => {
  it('returns original response when downloadKbps is 0', async () => {
    const original = new Response('hello', { status: 200 })
    const result = ThrottleEngine.throttleResponse(original, 0)
    expect(result).toBe(original)
  })

  it('returns original response when body is null', async () => {
    const original = new Response(null, { status: 204 })
    const result = ThrottleEngine.throttleResponse(original, 1000)
    expect(result).toBe(original)
  })

  it('wrapped response body is fully readable and preserves status/headers', async () => {
    const body = 'hello world from throttle'
    const original = new Response(body, {
      status: 201,
      headers: { 'content-type': 'text/plain', 'x-custom': 'yes' },
    })
    // Use a very high bandwidth so the test isn't slow
    const wrapped = ThrottleEngine.throttleResponse(original, 100_000)
    expect(wrapped.status).toBe(201)
    expect(wrapped.headers.get('content-type')).toBe('text/plain')
    expect(wrapped.headers.get('x-custom')).toBe('yes')
    const text = await wrapped.text()
    expect(text).toBe(body)
  })

  it('dripped body takes measurably longer than instant (low bandwidth)', async () => {
    // 512 bytes at 100 kbps ≈ 41ms — small/fast enough to keep the test quick
    // but still measurable against a generous 20ms lower bound.
    const body = 'x'.repeat(512)
    const original = new Response(body, { status: 200 })
    const t0 = Date.now()
    const wrapped = ThrottleEngine.throttleResponse(original, 100) // 100 kbps
    const text = await wrapped.text()
    const elapsed = Date.now() - t0
    expect(text).toBe(body)
    expect(elapsed).toBeGreaterThanOrEqual(20)
  }, 5000)
})

describe('ThrottleEngine applied through fetch interceptor', () => {
  it('custom 120ms latency is measured as >= ~100ms elapsed', async () => {
    ThrottleEngine.setCustom(120, 0)
    const { dispose } = withInterceptor(makeInstantStub())
    try {
      const t0 = Date.now()
      await globalThis.fetch('https://api.example.com/data')
      const elapsed = Date.now() - t0
      // Allow generous margin: should be at least 90ms (accounts for timer jitter)
      expect(elapsed).toBeGreaterThanOrEqual(90)
    } finally {
      dispose()
    }
  })

  it('offline profile rejects the fetch with TypeError', async () => {
    ThrottleEngine.setProfile('offline')
    const { dispose } = withInterceptor(makeInstantStub())
    try {
      let caught: unknown
      try {
        await globalThis.fetch('https://api.example.com/data')
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(TypeError)
    } finally {
      dispose()
    }
  })

  it('none profile completes in < 50ms (no artificial delay)', async () => {
    ThrottleEngine.setProfile('none')
    const { dispose } = withInterceptor(makeInstantStub())
    try {
      const t0 = Date.now()
      await globalThis.fetch('https://api.example.com/data')
      const elapsed = Date.now() - t0
      expect(elapsed).toBeLessThan(50)
    } finally {
      dispose()
    }
  })
})
