import { describe, test, expect } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { captureWith, captureFromProvider } from '../capture'
import type { HakkaLike } from '../capture'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: Math.random().toString(36).slice(2),
    url: 'https://api.example.com/data',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    ...overrides,
  }
}

function makeHakkaStub(initialLogs: NetworkRequest[] = []): HakkaLike & { _logs: NetworkRequest[] } {
  const state = { _logs: [...initialLogs] }
  return {
    get _logs() {
      return state._logs
    },
    set _logs(v) {
      state._logs = v
    },
    getLogs() {
      return state._logs
    },
    clearLogs() {
      state._logs = []
    },
  }
}

describe('captureWith', () => {
  test('clears logs before fn() and returns requests after', async () => {
    const req = makeRequest({ url: 'https://api.example.com/new' })
    const stub = makeHakkaStub([makeRequest({ url: 'https://api.example.com/stale' })])

    const { requests } = await captureWith(stub, async () => {
      stub._logs.push(req)
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toContain('/new')
  })

  test('works with synchronous fn()', async () => {
    const stub = makeHakkaStub()
    const { requests } = await captureWith(stub, () => {
      stub._logs.push(makeRequest())
    })
    expect(requests).toHaveLength(1)
  })

  test('returns empty array when fn() adds no logs', async () => {
    const stub = makeHakkaStub()
    const { requests } = await captureWith(stub, () => {
      /* no-op */
    })
    expect(requests).toHaveLength(0)
  })

  test('flushMs waits before collecting', async () => {
    const stub = makeHakkaStub()
    const { requests } = await captureWith(
      stub,
      async () => {
        setTimeout(() => stub._logs.push(makeRequest({ url: 'https://api.example.com/delayed' })), 10)
      },
      { flushMs: 50 },
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toContain('/delayed')
  })

  test('supports async getLogs', async () => {
    const req = makeRequest()
    const asyncStub: HakkaLike = {
      async getLogs() {
        return [req]
      },
      clearLogs() {
        /* no-op */
      },
    }
    const { requests } = await captureWith(asyncStub, async () => {
      /* no-op */
    })
    expect(requests).toHaveLength(1)
  })
})

describe('captureFromProvider', () => {
  test('calls provider and returns requests', async () => {
    const req = makeRequest()
    const { requests } = await captureFromProvider(async () => [req])
    expect(requests).toHaveLength(1)
    expect(requests[0]!.id).toBe(req.id)
  })

  test('runs fn before collecting when provided', async () => {
    let called = false
    const req = makeRequest()
    const { requests } = await captureFromProvider(
      async () => (called ? [req] : []),
      async () => {
        called = true
      },
    )
    expect(called).toBe(true)
    expect(requests).toHaveLength(1)
  })

  test('works without optional fn', async () => {
    const { requests } = await captureFromProvider(async () => [makeRequest()])
    expect(requests).toHaveLength(1)
  })
})
