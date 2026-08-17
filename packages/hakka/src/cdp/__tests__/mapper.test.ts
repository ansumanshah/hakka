import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from 'hakka-core'

import { createCdpMapper, DEFAULT_MAX_BODY_SIZE } from '../mapper'
import type {
  CdpGetResponseBodyResult,
  CdpLoadingFailedParams,
  CdpLoadingFinishedParams,
  CdpRequestWillBeSentExtraInfoParams,
  CdpRequestWillBeSentParams,
  CdpResponseReceivedExtraInfoParams,
  CdpResponseReceivedParams,
} from '../types'

const WALL_TIME = 1_700_000_000 // epoch seconds
const START_MS = WALL_TIME * 1000

function recorder(): { records: NetworkRequest[]; onRequest: (req: NetworkRequest) => void } {
  const records: NetworkRequest[] = []
  return { records, onRequest: (req) => records.push(req) }
}

function requestWillBeSent(overrides: Partial<CdpRequestWillBeSentParams> = {}): CdpRequestWillBeSentParams {
  return {
    requestId: 'req-1',
    loaderId: 'loader-1',
    timestamp: 100.0,
    wallTime: WALL_TIME,
    request: {
      url: 'https://api.example.com/v1/items',
      method: 'GET',
      headers: { 'User-Agent': 'test-agent' },
    },
    type: 'XHR',
    ...overrides,
  }
}

function responseReceived(overrides: Partial<CdpResponseReceivedParams> = {}): CdpResponseReceivedParams {
  return {
    requestId: 'req-1',
    loaderId: 'loader-1',
    timestamp: 100.05, // 50ms after request start
    type: 'XHR',
    response: {
      url: 'https://api.example.com/v1/items',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      mimeType: 'application/json',
      protocol: 'h2',
      encodedDataLength: 256,
      timing: {
        requestTime: 100.0,
        proxyStart: -1,
        proxyEnd: -1,
        dnsStart: 0,
        dnsEnd: 5,
        connectStart: 5,
        connectEnd: 15,
        sslStart: 8,
        sslEnd: 15,
        sendStart: 15,
        sendEnd: 16,
        pushStart: 0,
        pushEnd: 0,
        receiveHeadersEnd: 50,
      },
    },
    ...overrides,
  }
}

function loadingFinished(overrides: Partial<CdpLoadingFinishedParams> = {}): CdpLoadingFinishedParams {
  return {
    requestId: 'req-1',
    timestamp: 100.12, // 120ms after request start
    encodedDataLength: 256,
    ...overrides,
  }
}

describe('createCdpMapper — happy path', () => {
  test('emits pending -> update -> final, and maps status/headers/timing/body', async () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({
      onRequest,
      fetchResponseBody: async (): Promise<CdpGetResponseBodyResult> => ({
        body: '{"ok":true}',
        base64Encoded: false,
      }),
    })

    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent())
    mapper.handleEvent('Network.responseReceived', responseReceived())
    await mapper.handleEvent('Network.loadingFinished', loadingFinished())

    expect(records.length).toBe(3)

    const [pending, updated, final] = records
    expect(pending?.status).toBeNull()
    expect(pending?.startTime).toBe(START_MS)
    expect(pending?.id).toBe('req-1')
    expect(pending?.source).toBe('xhr')

    expect(updated?.status).toBe(200)
    expect(updated?.responseHeaders?.['content-type']).toBe('application/json')
    expect(updated?.networkProtocol).toBe('h2')

    expect(final?.status).toBe(200)
    expect(final?.endTime).toBe(START_MS + 120)
    expect(final?.duration).toBe(120)
    expect(final?.responseBody).toBe('{"ok":true}')
    expect(final?.responseBodySize).toBe('{"ok":true}'.length)
    expect(final?.encoding).toBeUndefined()
    expect(final?.responseBodyTruncated).toBeUndefined()
    expect(final?.library).toBe('chrome-devtools-protocol')
    expect(final?.runtime).toBe('client')

    // Timing: dnsMs=5, connectMs=10, tlsMs=7, ttfbMs=34 (50-16), downloadMs=70 (120-50)
    expect(final?.dnsMs).toBe(5)
    expect(final?.connectMs).toBe(10)
    expect(final?.tlsMs).toBe(7)
    expect(final?.ttfbMs).toBe(34)
    expect(final?.downloadMs).toBe(70)
    expect(final?.timing?.total).toBe(120)
  })

  test('requestBodySize reflects postData byte length', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })
    mapper.handleEvent(
      'Network.requestWillBeSent',
      requestWillBeSent({
        request: { url: 'https://api.example.com', method: 'POST', headers: {}, postData: '{"a":1}' },
      }),
    )
    expect(records[0]?.requestBody).toBe('{"a":1}')
    expect(records[0]?.requestBodySize).toBe(Buffer.byteLength('{"a":1}'))
  })

  test('runtime and redactHeaders options are honored', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest, runtime: 'server', redactHeaders: ['x-custom-secret'] })
    mapper.handleEvent(
      'Network.requestWillBeSent',
      requestWillBeSent({
        request: {
          url: 'https://api.example.com',
          method: 'GET',
          headers: { 'x-custom-secret': 'abc', 'x-other': 'ok' },
        },
      }),
    )
    expect(records[0]?.runtime).toBe('server')
    expect(records[0]?.requestHeaders?.['x-custom-secret']).toBe('[REDACTED]')
    expect(records[0]?.requestHeaders?.['x-other']).toBe('ok')
  })
})

describe('createCdpMapper — redirects', () => {
  test('a redirect chain emits a separate finalized record per hop, linked via redirectChain/redirectUrls', async () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    // Hop 1: GET /old
    mapper.handleEvent(
      'Network.requestWillBeSent',
      requestWillBeSent({
        requestId: 'req-r',
        request: { url: 'https://api.example.com/old', method: 'GET', headers: {} },
      }),
    )

    // Hop 2 arrives as a SECOND requestWillBeSent on the SAME requestId, carrying the redirectResponse for hop 1.
    mapper.handleEvent('Network.requestWillBeSent', {
      ...requestWillBeSent({ requestId: 'req-r', timestamp: 100.03 }),
      request: { url: 'https://api.example.com/new', method: 'GET', headers: {} },
      redirectResponse: {
        url: 'https://api.example.com/old',
        status: 302,
        statusText: 'Found',
        headers: { location: 'https://api.example.com/new' },
        mimeType: 'text/plain',
      },
    })

    mapper.handleEvent(
      'Network.responseReceived',
      responseReceived({
        requestId: 'req-r',
        timestamp: 100.08,
        response: { ...responseReceived().response, url: 'https://api.example.com/new' },
      }),
    )
    await mapper.handleEvent('Network.loadingFinished', loadingFinished({ requestId: 'req-r', timestamp: 100.1 }))

    // Emissions: hop1 pending, hop1 final(redirect), hop2 pending, hop2 update, hop2 final = 5
    const finals = records.filter((r) => r.endTime !== undefined)
    expect(finals.length).toBe(2)

    const [redirectHop, finalHop] = finals
    expect(redirectHop?.id).toBe('req-r')
    expect(redirectHop?.status).toBe(302)
    expect(redirectHop?.url).toBe('https://api.example.com/old')
    expect(redirectHop?.redirectCount ?? 0).toBe(0)

    expect(finalHop?.id).toBe('req-r#2')
    expect(finalHop?.status).toBe(200)
    expect(finalHop?.url).toBe('https://api.example.com/new')
    expect(finalHop?.redirectCount).toBe(1)
    expect(finalHop?.redirectChain).toEqual(['req-r'])
    expect(finalHop?.redirectUrls).toEqual(['https://api.example.com/old'])
  })
})

describe('createCdpMapper — failure', () => {
  test('loadingFailed finalizes with error set and status null', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-f' }))
    const failed: CdpLoadingFailedParams = {
      requestId: 'req-f',
      timestamp: 100.02,
      type: 'XHR',
      errorText: 'net::ERR_NAME_NOT_RESOLVED',
      canceled: false,
    }
    mapper.handleEvent('Network.loadingFailed', failed)

    const final = records.at(-1)
    expect(final?.status).toBeNull()
    expect(final?.error).toBe('net::ERR_NAME_NOT_RESOLVED')
    expect(final?.endTime).toBe(START_MS + 20)
  })

  test('a canceled load is suffixed in the error message', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })
    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-c' }))
    mapper.handleEvent('Network.loadingFailed', {
      requestId: 'req-c',
      timestamp: 100.01,
      type: 'XHR',
      errorText: 'net::ERR_ABORTED',
      canceled: true,
    })
    expect(records.at(-1)?.error).toBe('net::ERR_ABORTED (canceled)')
  })

  test('getResponseBody rejecting fails open — record still finalizes without a body', async () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({
      onRequest,
      fetchResponseBody: async () => {
        throw new Error('No resource with given identifier found')
      },
    })
    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent())
    mapper.handleEvent('Network.responseReceived', responseReceived())
    await mapper.handleEvent('Network.loadingFinished', loadingFinished())

    const final = records.at(-1)
    expect(final?.status).toBe(200)
    expect(final?.responseBody).toBeNull()
  })
})

describe('createCdpMapper — extra-info header merge', () => {
  test('requestWillBeSentExtraInfo arriving BEFORE requestWillBeSent is merged in (and redacted)', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    const extra: CdpRequestWillBeSentExtraInfoParams = { requestId: 'req-e', headers: { cookie: 'a=b' } }
    mapper.handleEvent('Network.requestWillBeSentExtraInfo', extra)
    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-e' }))

    expect(records[0]?.requestHeaders?.['User-Agent']).toBe('test-agent')
    // 'cookie' is in hakka-core's DEFAULT_SENSITIVE_HEADERS
    expect(records[0]?.requestHeaders?.cookie).toBe('[REDACTED]')
  })

  test('requestWillBeSentExtraInfo arriving AFTER requestWillBeSent merges into the live entry and re-emits', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-e2' }))
    expect(records[0]?.requestHeaders?.cookie).toBeUndefined()

    mapper.handleEvent('Network.requestWillBeSentExtraInfo', { requestId: 'req-e2', headers: { cookie: 'x=y' } })
    expect(records.length).toBe(2)
    expect(records[1]?.requestHeaders?.cookie).toBe('[REDACTED]')
  })

  test('responseReceivedExtraInfo arriving BEFORE responseReceived is merged in once the response lands', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-e3' }))
    const extra: CdpResponseReceivedExtraInfoParams = { requestId: 'req-e3', headers: { 'set-cookie': 'session=xyz' } }
    mapper.handleEvent('Network.responseReceivedExtraInfo', extra)
    mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'req-e3' }))

    const updated = records.at(-1)
    expect(updated?.responseHeaders?.['content-type']).toBe('application/json')
    expect(updated?.responseHeaders?.['set-cookie']).toBe('[REDACTED]')
  })

  test('responseReceivedExtraInfo arriving AFTER responseReceived merges into the live entry and re-emits', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-e4' }))
    mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'req-e4' }))
    mapper.handleEvent('Network.responseReceivedExtraInfo', {
      requestId: 'req-e4',
      headers: { 'set-cookie': 'session=xyz' },
    })

    const updated = records.at(-1)
    expect(updated?.responseHeaders?.['set-cookie']).toBe('[REDACTED]')
  })
})

describe('createCdpMapper — base64 and truncated bodies', () => {
  test('a base64Encoded response body is kept whole with encoding="base64"', async () => {
    const { records, onRequest } = recorder()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    const mapper = createCdpMapper({
      onRequest,
      fetchResponseBody: async (): Promise<CdpGetResponseBodyResult> => ({ body: png, base64Encoded: true }),
    })
    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-b' }))
    mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'req-b' }))
    await mapper.handleEvent('Network.loadingFinished', loadingFinished({ requestId: 'req-b' }))

    const final = records.at(-1)
    expect(final?.responseBody).toBe(png)
    expect(final?.encoding).toBe('base64')
    expect(final?.responseBodyTruncated).toBeUndefined()
  })

  test('a text body over maxBodySize is truncated and flagged', async () => {
    const { records, onRequest } = recorder()
    const big = 'x'.repeat(DEFAULT_MAX_BODY_SIZE + 500)
    const mapper = createCdpMapper({
      onRequest,
      maxBodySize: DEFAULT_MAX_BODY_SIZE,
      fetchResponseBody: async (): Promise<CdpGetResponseBodyResult> => ({ body: big, base64Encoded: false }),
    })
    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-big' }))
    mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'req-big' }))
    await mapper.handleEvent('Network.loadingFinished', loadingFinished({ requestId: 'req-big' }))

    const final = records.at(-1)
    expect(final?.responseBody?.length).toBe(DEFAULT_MAX_BODY_SIZE)
    expect(final?.responseBodyTruncated).toBe(true)
  })

  test('captureBody: false skips the body fetch but still finalizes, falling back to dataReceived bytes', async () => {
    const { records, onRequest } = recorder()
    let fetchCalled = false
    const mapper = createCdpMapper({
      onRequest,
      captureBody: false,
      fetchResponseBody: async () => {
        fetchCalled = true
        return { body: 'should not be called', base64Encoded: false }
      },
    })
    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-nb' }))
    mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'req-nb' }))
    mapper.handleEvent('Network.dataReceived', {
      requestId: 'req-nb',
      timestamp: 100.06,
      dataLength: 42,
      encodedDataLength: 30,
    })
    await mapper.handleEvent('Network.loadingFinished', loadingFinished({ requestId: 'req-nb' }))

    expect(fetchCalled).toBe(false)
    const final = records.at(-1)
    expect(final?.responseBody).toBeNull()
    expect(final?.responseBodySize).toBe(42)
  })
})

describe('createCdpMapper — unknown/unmatched events', () => {
  test('events for an unknown requestId are ignored, not thrown', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })
    expect(() =>
      mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'never-seen' })),
    ).not.toThrow()
    expect(() =>
      mapper.handleEvent('Network.loadingFinished', loadingFinished({ requestId: 'never-seen' })),
    ).not.toThrow()
    expect(records.length).toBe(0)
  })

  test('an unrecognized method is a silent no-op', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })
    expect(() => mapper.handleEvent('Network.resourceChangedPriority', { requestId: 'x' })).not.toThrow()
    expect(records.length).toBe(0)
  })
})

// --- Redirect-hop anchoring and extra-info stash edge cases ----------------

describe('createCdpMapper — redirect hop 2+ startTime anchoring', () => {
  test('hop 2 anchors startTime off hop 1 wallTime + monotonic delta, NOT its own (CDP-unreliable) wallTime', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    // Hop 1 begins at WALL_TIME, monotonic timestamp 100.0 (this is the only hop
    // where types.ts:93-94 says wallTime is reliable).
    mapper.handleEvent(
      'Network.requestWillBeSent',
      requestWillBeSent({
        requestId: 'req-anchor',
        wallTime: WALL_TIME,
        timestamp: 100.0,
        request: { url: 'https://api.example.com/old', method: 'GET', headers: {} },
      }),
    )

    // Hop 2 fires 30ms later on the monotonic clock, but carries a bogus/divergent
    // `wallTime` of its own — exactly the situation types.ts warns is unreliable
    // past the first hop. If the mapper anchors off THIS wallTime instead of hop 1's,
    // startTime would be wildly wrong.
    const bogusWallTime = WALL_TIME + 100_000 // 100,000s off — clearly wrong if used directly
    mapper.handleEvent('Network.requestWillBeSent', {
      ...requestWillBeSent({ requestId: 'req-anchor', wallTime: bogusWallTime, timestamp: 100.03 }),
      request: { url: 'https://api.example.com/new', method: 'GET', headers: {} },
      redirectResponse: {
        url: 'https://api.example.com/old',
        status: 302,
        statusText: 'Found',
        headers: { location: 'https://api.example.com/new' },
        mimeType: 'text/plain',
      },
    })

    const hop2Pending = records.find((r) => r.id === 'req-anchor#2')
    // Correct: hop1's startTime + 30ms monotonic delta, NOT bogusWallTime * 1000.
    expect(hop2Pending?.startTime).toBe(START_MS + 30)
  })

  test('a THIRD hop still anchors off hop 1, not hop 2, across a two-redirect chain', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    mapper.handleEvent(
      'Network.requestWillBeSent',
      requestWillBeSent({ requestId: 'req-chain', wallTime: WALL_TIME, timestamp: 100.0 }),
    )
    mapper.handleEvent('Network.requestWillBeSent', {
      ...requestWillBeSent({ requestId: 'req-chain', wallTime: WALL_TIME + 999, timestamp: 100.02 }),
      redirectResponse: {
        url: 'https://api.example.com/old',
        status: 302,
        statusText: 'Found',
        headers: {},
        mimeType: 'text/plain',
      },
    })
    mapper.handleEvent('Network.requestWillBeSent', {
      ...requestWillBeSent({ requestId: 'req-chain', wallTime: WALL_TIME - 999, timestamp: 100.05 }),
      redirectResponse: {
        url: 'https://api.example.com/mid',
        status: 302,
        statusText: 'Found',
        headers: {},
        mimeType: 'text/plain',
      },
    })

    const hop3Pending = records.find((r) => r.id === 'req-chain#3')
    expect(hop3Pending?.startTime).toBe(START_MS + 50)
  })
})

describe('createCdpMapper — extraInfo cannot cross a redirect hop boundary', () => {
  test('a responseReceivedExtraInfo for the redirect arriving AFTER requestWillBeSent(redirect) does not contaminate the new hop', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    mapper.handleEvent(
      'Network.requestWillBeSent',
      requestWillBeSent({
        requestId: 'req-x',
        request: { url: 'https://api.example.com/old', method: 'GET', headers: {} },
      }),
    )

    // Redirect rollover — the requestId is reused for hop 2.
    mapper.handleEvent('Network.requestWillBeSent', {
      ...requestWillBeSent({ requestId: 'req-x', timestamp: 100.03 }),
      request: { url: 'https://api.example.com/new', method: 'GET', headers: {} },
      redirectResponse: {
        url: 'https://api.example.com/old',
        status: 302,
        statusText: 'Found',
        headers: { location: 'https://api.example.com/new' },
        mimeType: 'text/plain',
      },
    })

    // Late-arriving extraInfo describing the REDIRECT (statusCode 302) shows up only
    // now — AFTER hop 2 is already the active entry for req-x.
    mapper.handleEvent('Network.responseReceivedExtraInfo', {
      requestId: 'req-x',
      statusCode: 302,
      headers: { location: 'https://api.example.com/new', 'x-stale-marker': 'from-redirect-hop' },
    })

    // Hop 2's own genuine response.
    mapper.handleEvent(
      'Network.responseReceived',
      responseReceived({
        requestId: 'req-x',
        timestamp: 100.08,
        response: { ...responseReceived().response, url: 'https://api.example.com/new' },
      }),
    )

    const hop2 = records.find((r) => r.id === 'req-x#2' && r.status === 200)
    expect(hop2?.responseHeaders?.['x-stale-marker']).toBeUndefined()
  })
})

describe('createCdpMapper — pending extra-info stashes are not unbounded', () => {
  test('an aborted request (loadingFailed) clears its pendingResponseExtra stash — a later request reusing the same requestId is not contaminated', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    // req-reuse: response never arrives; a responseReceivedExtraInfo stashes headers
    // that must not sit in `pendingResponseExtra` forever.
    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-reuse' }))
    mapper.handleEvent('Network.responseReceivedExtraInfo', {
      requestId: 'req-reuse',
      headers: { 'x-stale-abort-marker': 'from-aborted-request' },
    })
    mapper.handleEvent('Network.loadingFailed', {
      requestId: 'req-reuse',
      timestamp: 100.02,
      type: 'XHR',
      errorText: 'net::ERR_ABORTED',
      canceled: true,
    })

    // The SAME CDP requestId is reused later for a brand-new, unrelated request.
    mapper.handleEvent(
      'Network.requestWillBeSent',
      requestWillBeSent({ requestId: 'req-reuse', timestamp: 200.0, wallTime: WALL_TIME + 500 }),
    )
    mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'req-reuse', timestamp: 200.05 }))

    const reused = records.at(-1)
    expect(reused?.responseHeaders?.['x-stale-abort-marker']).toBeUndefined()
  })

  test('a request that finalizes via loadingFinished without ever getting responseReceived clears its pendingResponseExtra stash too', () => {
    const { records, onRequest } = recorder()
    const mapper = createCdpMapper({ onRequest })

    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-nomatch' }))
    mapper.handleEvent('Network.responseReceivedExtraInfo', {
      requestId: 'req-nomatch',
      headers: { 'x-stale-nomatch-marker': 'never-applied' },
    })
    // loadingFinished fires WITHOUT a prior responseReceived (CDP allows this for
    // some cached/opaque resources) — entry.status stays null, so this stash is
    // never consumed by `applyResponse`.
    mapper.handleEvent('Network.loadingFinished', loadingFinished({ requestId: 'req-nomatch' }))

    // Reuse the id for a brand-new, unrelated request.
    mapper.handleEvent(
      'Network.requestWillBeSent',
      requestWillBeSent({ requestId: 'req-nomatch', timestamp: 300.0, wallTime: WALL_TIME + 900 }),
    )
    mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'req-nomatch', timestamp: 300.05 }))

    const reused = records.at(-1)
    expect(reused?.responseHeaders?.['x-stale-nomatch-marker']).toBeUndefined()
  })
})

describe('createCdpMapper — base64 body size cap', () => {
  test('a base64 body whose ESTIMATED decoded size exceeds maxBodySize is dropped (not truncated mid-base64), flagged, and sized', async () => {
    const { records, onRequest } = recorder()
    // Encoded length chosen so the decoded estimate (len * 3/4) clears maxBodySize.
    const encodedLength = Math.ceil(((DEFAULT_MAX_BODY_SIZE + 4096) * 4) / 3)
    const bigBase64 = 'A'.repeat(encodedLength)
    const mapper = createCdpMapper({
      onRequest,
      fetchResponseBody: async (): Promise<CdpGetResponseBodyResult> => ({ body: bigBase64, base64Encoded: true }),
    })
    mapper.handleEvent('Network.requestWillBeSent', requestWillBeSent({ requestId: 'req-bigb64' }))
    mapper.handleEvent('Network.responseReceived', responseReceived({ requestId: 'req-bigb64' }))
    await mapper.handleEvent('Network.loadingFinished', loadingFinished({ requestId: 'req-bigb64' }))

    const final = records.at(-1)
    expect(final?.responseBody).toBeNull()
    expect(final?.responseBodyTruncated).toBe(true)
    const expectedSize = Math.floor((bigBase64.length * 3) / 4)
    expect(final?.responseBodySize).toBe(expectedSize)
    expect(final?.responseBodySize ?? 0).toBeGreaterThan(DEFAULT_MAX_BODY_SIZE)
  })
})
