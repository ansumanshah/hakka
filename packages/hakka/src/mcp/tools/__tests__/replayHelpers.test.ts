import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from 'hakka-core'

import { checkReplayable } from '../replayHelpers'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    status: 200,
    startTime: 0,
    ...overrides,
  }
}

describe('checkReplayable', () => {
  test('refuses websocket requests', () => {
    const result = checkReplayable(makeRequest({ source: 'websocket' }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('websocket_not_replayable')
  })

  test('refuses server/edge-captured requests', () => {
    const result = checkReplayable(makeRequest({ runtime: 'server' }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('runtime_not_replayable')
  })

  test('allows a plain client-captured request with no redacted headers', () => {
    const result = checkReplayable(makeRequest({ requestHeaders: { accept: 'application/json' } }))
    expect(result.ok).toBe(true)
  })

  test('refuses a request whose stored headers were redacted at capture time — replaying it would send the literal "[REDACTED]" instead of the real credential', () => {
    const result = checkReplayable(makeRequest({ requestHeaders: { authorization: '[REDACTED]' } }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('redacted_headers_not_replayable')
    expect(!result.ok && result.message).toContain('authorization')
  })

  test('a redacted header does not mask the websocket/runtime checks that run before it', () => {
    const result = checkReplayable(
      makeRequest({ source: 'websocket', requestHeaders: { authorization: '[REDACTED]' } }),
    )
    expect(!result.ok && result.reason).toBe('websocket_not_replayable')
  })
})
