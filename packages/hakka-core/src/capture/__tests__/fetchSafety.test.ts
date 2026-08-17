import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

import { mockEngine } from '../../engine/MockEngine'
import type { NetworkRequest } from '../../model/types'
import { enableFetchInterceptor } from '../fetch'

// Safety guarantees of the fetch interceptor: (1) `await fetch()` resolves at
// headers-received time, not after the full body downloads; (2) a throw in Hakka's own
// prologue (redaction/mock-matching/header build) fails OPEN — the app's real request resolves.
const REAL_FETCH = globalThis.fetch

function makeStubFetch(body: string, status = 200) {
  return async (_input: unknown, _init?: RequestInit): Promise<Response> =>
    new Response(body, { status, headers: { 'content-type': 'text/plain' } })
}

/** A stub whose response body streams one chunk, then stays open until `closeAfterMs`. */
function makeSlowStreamStub(body: string, closeAfterMs: number) {
  return async (_input: unknown, _init?: RequestInit): Promise<Response> => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        setTimeout(() => controller.close(), closeAfterMs)
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } })
  }
}

/** A stub whose response is an SSE stream (text/event-stream) that stays open until `closeAfterMs`. */
function makeSseStub(chunks: string[], closeAfterMs: number) {
  return async (_input: unknown, _init?: RequestInit): Promise<Response> => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
        setTimeout(() => controller.close(), closeAfterMs)
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

beforeEach(() => {
  mockEngine.clearRules()
})

afterEach(() => {
  mockEngine.clearRules()
  globalThis.fetch = REAL_FETCH
})

describe('fetch interceptor — non-blocking return', () => {
  it('resolves at headers, not after the full body has downloaded', async () => {
    // Body stream stays open for 250ms — if the interceptor awaited the clone read before
    // returning, `await fetch()` would take ~250ms instead of resolving at headers-received.
    globalThis.fetch = makeSlowStreamStub('streamed-body', 250) as typeof globalThis.fetch
    const records: NetworkRequest[] = []
    const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
    try {
      const t0 = Date.now()
      const res = await globalThis.fetch('https://example.com/stream')
      const fetchMs = Date.now() - t0

      expect(fetchMs).toBeLessThan(120)
      // The app can still read the full body itself (clone left the original intact).
      expect(await res.text()).toBe('streamed-body')
    } finally {
      dispose()
    }
  })

  it('an SSE (text/event-stream) response also resolves at headers-time, not when the stream eventually closes', async () => {
    // The stream stays open for 250ms — sseCapture.ts reads a clone of it incrementally in a
    // detached task; `await fetch()` must not wait on that background read.
    globalThis.fetch = makeSseStub(['data: hello\n\n'], 250) as typeof globalThis.fetch
    const records: NetworkRequest[] = []
    const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
    try {
      const t0 = Date.now()
      const res = await globalThis.fetch('https://example.com/sse')
      const fetchMs = Date.now() - t0

      expect(fetchMs).toBeLessThan(120)
      // The app's own stream is untouched by the capture clone.
      expect(await res.text()).toBe('data: hello\n\n')
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — fail-open', () => {
  it('when the mock lookup throws, the real request still resolves and nothing is captured', async () => {
    globalThis.fetch = makeStubFetch('real-body') as typeof globalThis.fetch
    const records: NetworkRequest[] = []
    const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
    const origPeek = mockEngine.peek.bind(mockEngine)
    // Simulate a malformed mock matcher / internal bug.
    ;(mockEngine as unknown as { peek: () => never }).peek = () => {
      throw new Error('boom')
    }
    try {
      const res = await globalThis.fetch('https://example.com/x')
      // App received the real (stub) response — the request was NOT broken.
      expect(await res.text()).toBe('real-body')
      expect(records.length).toBe(0)
    } finally {
      ;(mockEngine as unknown as { peek: typeof origPeek }).peek = origPeek
      dispose()
    }
  })

  it('a redaction throw in the prologue also fails open', async () => {
    globalThis.fetch = makeStubFetch('ok') as typeof globalThis.fetch
    const records: NetworkRequest[] = []
    // The simplest deterministic prologue throw is a getter that explodes on the outgoing
    // headers object, iterated below.
    const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
    try {
      const evilHeaders = new Proxy(
        {},
        {
          get() {
            throw new Error('header access boom')
          },
        },
      )
      const res = await globalThis.fetch('https://example.com/y', {
        method: 'POST',
        // A headers object that throws when Hakka iterates it.
        headers: evilHeaders as HeadersInit,
      })
      expect(await res.text()).toBe('ok')
    } finally {
      dispose()
    }
  })
})
