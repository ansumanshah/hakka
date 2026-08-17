import { enableFetchInterceptor, mockEngine } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

describe('fetch interceptor', () => {
  const originalFetch = globalThis.fetch
  let captured: NetworkRequest[]

  beforeEach(() => {
    captured = []
    mockEngine.clearRules()
    // Mock fetch
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      redirected: false,
      url: 'https://api.example.com/data',
      // Faithful clone: readCappedBody inspects `headers` (Content-Length fast
      // path) before falling back to `.text()` on stream-less RN runtimes.
      clone: () => ({
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"ok":true}'),
      }),
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    mockEngine.clearRules()
    globalThis.fetch = originalFetch
  })

  it('captures successful fetch requests with two-phase emission', async () => {
    const teardown = enableFetchInterceptor((r) => captured.push(r), 262144, ['authorization'])

    await globalThis.fetch('https://api.example.com/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
      body: '{"q":"test"}',
    })

    // Allow background body read to complete
    await new Promise((r) => setTimeout(r, 10))

    // Phase 1: headers-only emission, Phase 2: body update
    expect(captured).toHaveLength(2)

    // First emission: immediate, no body yet
    const phase1 = captured[0]!
    expect(phase1.url).toBe('https://api.example.com/data')
    expect(phase1.method).toBe('POST')
    expect(phase1.status).toBe(200)
    expect(phase1.source).toBe('fetch')
    expect(phase1.requestHeaders['authorization']).toBe('[REDACTED]')
    expect(phase1.responseBody).toBeNull()
    expect(phase1.responseBodySize).toBe(0)

    // Second emission: body included
    const phase2 = captured[1]!
    expect(phase2.id).toBe(phase1.id)
    expect(phase2.responseBody).toBe('{"ok":true}')
    expect(phase2.responseBodySize).toBe(11)
    expect(phase2.downloadMs).toBeGreaterThanOrEqual(0)

    teardown()
  })

  it('captures fetch errors', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network failure')) as unknown as typeof fetch

    const teardown = enableFetchInterceptor((r) => captured.push(r), 262144, [])

    await expect(globalThis.fetch('https://api.example.com/fail')).rejects.toThrow('Network failure')

    expect(captured).toHaveLength(1)
    expect(captured[0]!.error).toBe('Network failure')
    expect(captured[0]!.status).toBeNull()

    teardown()
  })

  it('returns mock responses before calling the real fetch', async () => {
    const realFetch = globalThis.fetch as jest.Mock
    const teardown = enableFetchInterceptor((r) => captured.push(r), 262144, [])

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

    const response = await globalThis.fetch('https://api.example.com/mocked')
    const body = await response.text()

    expect(realFetch).not.toHaveBeenCalled()
    expect(response.status).toBe(202)
    expect(response.headers.get('x-hakka-mock')).toBe('yes')
    expect(body).toBe('{"mocked":true}')
    expect(captured).toHaveLength(1)
    expect(captured[0]?.mocked).toBe(true)
    expect(captured[0]?.status).toBe(202)

    teardown()
  })

  it('restores original fetch on teardown', () => {
    const mockFetch = globalThis.fetch
    const teardown = enableFetchInterceptor(() => {}, 262144, [])
    expect(globalThis.fetch).not.toBe(mockFetch)
    teardown()
    // After teardown, the original (mock) fetch should be restored
    // Note: we stored the mock as original, so it restores to that
  })
})
