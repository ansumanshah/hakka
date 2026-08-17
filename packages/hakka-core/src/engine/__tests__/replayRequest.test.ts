import { afterEach, describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildReplayInit, REPLAY_MARKER_HEADER, replayRequest } from '../replayRequest'

function req(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/users/1',
    method: 'GET',
    status: 200,
    startTime: 0,
    ...overrides,
  }
}

describe('buildReplayInit', () => {
  test('GET drops the body even when one is present', () => {
    const init = buildReplayInit(req({ method: 'GET', requestBody: '{"x":1}' }))
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  test('HEAD drops the body even when one is present', () => {
    const init = buildReplayInit(req({ method: 'HEAD', requestBody: '{"x":1}' }))
    expect(init.body).toBeUndefined()
  })

  test('POST keeps the body', () => {
    const init = buildReplayInit(req({ method: 'POST', requestBody: '{"x":1}' }))
    expect(init.body).toBe('{"x":1}')
  })

  test('PUT keeps the body', () => {
    const init = buildReplayInit(req({ method: 'PUT', requestBody: '{"x":1}' }))
    expect(init.body).toBe('{"x":1}')
  })

  test('PATCH keeps the body', () => {
    const init = buildReplayInit(req({ method: 'PATCH', requestBody: '{"x":1}' }))
    expect(init.body).toBe('{"x":1}')
  })

  test('normalizes method casing to uppercase', () => {
    const init = buildReplayInit(req({ method: 'post', requestBody: '{}' }))
    expect(init.method).toBe('POST')
  })

  test('empty headers are omitted rather than sent as {}', () => {
    const init = buildReplayInit(req({ requestHeaders: {} }))
    expect(init.headers).toBeUndefined()
  })

  test('non-empty headers are carried over as a copy', () => {
    const headers = { 'x-a': '1' }
    const init = buildReplayInit(req({ requestHeaders: headers }))
    expect(init.headers).toEqual(headers)
    expect(init.headers).not.toBe(headers)
  })

  test('no requestBody produces no body regardless of method', () => {
    const init = buildReplayInit(req({ method: 'POST', requestBody: null }))
    expect(init.body).toBeUndefined()
  })
})

describe('replayRequest', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('calls global fetch once with the request url and built init', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return new Response('ok')
    }) as typeof fetch

    await replayRequest(req({ method: 'POST', requestBody: '{"a":1}', requestHeaders: { 'x-a': '1' } }))

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('https://api.example.com/users/1')
    expect(calls[0]?.[1]?.method).toBe('POST')
    expect(calls[0]?.[1]?.body).toBe('{"a":1}')
    expect((calls[0]?.[1]?.headers as Record<string, string> | undefined)?.['x-a']).toBe('1')
  })

  test('stamps the marker header only when one is passed', async () => {
    const calls: Array<RequestInit | undefined> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push(init)
      return new Response('ok')
    }) as typeof fetch

    await replayRequest(req(), 'marker-abc')
    await replayRequest(req())

    const withMarker = calls[0]?.headers as Record<string, string> | undefined
    const withoutMarker = calls[1]?.headers as Record<string, string> | undefined
    expect(withMarker?.[REPLAY_MARKER_HEADER]).toBe('marker-abc')
    expect(withoutMarker?.[REPLAY_MARKER_HEADER]).toBeUndefined()
  })

  test('swallows a fetch rejection instead of throwing', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch

    await expect(replayRequest(req())).resolves.toBeUndefined()
  })
})
