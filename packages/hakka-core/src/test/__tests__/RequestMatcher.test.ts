import { describe, test, expect } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { HakkaAssertionError } from '../HakkaAssertionError'
import { expectRequest } from '../RequestMatcher'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: Math.random().toString(36).slice(2),
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    ...overrides,
  }
}

const sampleLogs: NetworkRequest[] = [
  makeRequest({ url: 'https://api.example.com/users', method: 'GET', status: 200 }),
  makeRequest({ url: 'https://api.example.com/posts', method: 'POST', status: 201 }),
  makeRequest({ url: 'https://api.example.com/auth/login', method: 'POST', status: 401 }),
  makeRequest({ url: 'https://api.example.com/users/1', method: 'GET', status: 200 }),
]

describe('expectRequest', () => {
  test('toHaveBeenCalledWith finds matching request', () => {
    expect(() => expectRequest(sampleLogs).toHaveBeenCalledWith({ method: 'POST', url: '/posts' })).not.toThrow()
  })

  test('toHaveBeenCalledWith throws when not found', () => {
    expect(() => expectRequest(sampleLogs).toHaveBeenCalledWith({ url: '/missing' })).toThrow(HakkaAssertionError)
  })

  test('notToHaveBeenCalled passes when absent', () => {
    expect(() => expectRequest(sampleLogs, { url: '/comments' }).notToHaveBeenCalled()).not.toThrow()
  })

  test('notToHaveBeenCalled throws when present', () => {
    expect(() => expectRequest(sampleLogs, { url: '/posts' }).notToHaveBeenCalled()).toThrow(HakkaAssertionError)
  })

  test('chained withStatus', () => {
    expect(() => expectRequest(sampleLogs).toHaveBeenCalledWith({ url: '/posts' }).withStatus(201)).not.toThrow()
  })

  test('chained withStatus fails on wrong code', () => {
    expect(() => expectRequest(sampleLogs).toHaveBeenCalledWith({ url: '/posts' }).withStatus(200)).toThrow(
      HakkaAssertionError,
    )
  })

  test('chained withBodyContaining', () => {
    const logsWithBody = [makeRequest({ url: 'https://api.example.com/search', responseBody: '{"results":[]}' })]
    expect(() => expectRequest(logsWithBody, { url: '/search' }).withBodyContaining('"results"')).not.toThrow()
  })

  test('chained withResponseHeader', () => {
    const logsWithHeaders = [
      makeRequest({
        url: 'https://api.example.com/data',
        responseHeaders: { 'x-ratelimit-remaining': '99' },
      }),
    ]
    expect(() =>
      expectRequest(logsWithHeaders, { url: '/data' }).withResponseHeader('x-ratelimit-remaining', '99'),
    ).not.toThrow()
  })

  test('chained thatSucceeded', () => {
    expect(() => expectRequest(sampleLogs, { url: '/users', method: 'GET' }).thatSucceeded()).not.toThrow()
  })

  test('chained thatFailed', () => {
    const errLogs = [makeRequest({ url: 'https://api.example.com/crash', error: 'ECONNREFUSED' })]
    expect(() => expectRequest(errLogs, { url: '/crash' }).thatFailed()).not.toThrow()
  })

  test('get() returns the matched NetworkRequest', () => {
    const r = expectRequest(sampleLogs, { url: '/auth/login' }).get()
    expect(r.status).toBe(401)
  })

  test('multiple chain calls work', () => {
    const logsWithAll = [
      makeRequest({
        url: 'https://api.example.com/submit',
        method: 'POST',
        status: 200,
        requestBody: '{"a":1}',
        responseBody: '{"ok":true}',
        requestHeaders: { 'content-type': 'application/json' },
        responseHeaders: { 'x-trace-id': 'abc123' },
      }),
    ]
    expect(() =>
      expectRequest(logsWithAll)
        .toHaveBeenCalledWith({ method: 'POST', url: '/submit' })
        .withStatus(200)
        .withRequestBody('{"a":1}')
        .withBody('{"ok":true}')
        .withRequestHeader('content-type', 'application/json')
        .withResponseHeader('x-trace-id', 'abc123')
        .thatSucceeded(),
    ).not.toThrow()
  })
})
