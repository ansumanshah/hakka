import { describe, expect, test } from 'bun:test'

import { mapProxyFlow } from '../mapper'

describe('mapProxyFlow', () => {
  test('normalizes final proxy flows using the shared redaction and body bound', () => {
    const request = mapProxyFlow(
      {
        type: 'flow',
        id: 'flow-1',
        startedAt: 100,
        endedAt: 150,
        method: 'POST',
        url: 'https://example.test/items',
        requestHeaders: [{ name: 'Authorization', value: 'secret' }],
        responseHeaders: [
          { name: 'Set-Cookie', value: 'a=1' },
          { name: 'Set-Cookie', value: 'b=2' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        requestBody: '{"token":"secret"}',
        responseBody: 'abcdefgh',
        requestBodySize: 18,
        responseBodySize: 8,
        status: 201,
      },
      { maxBodySize: 4, redactBodyFields: ['token'] },
    )

    expect(request).toMatchObject({
      id: 'flow-1',
      source: 'http',
      runtime: 'client',
      status: 201,
      duration: 50,
      requestHeaders: { Authorization: '[REDACTED]' },
      responseHeaders: { 'Set-Cookie': '[REDACTED]' },
      responseHeaderValues: { 'Set-Cookie': ['[REDACTED]', '[REDACTED]'] },
      responseBodyTruncated: true,
    })
    expect(request.responseBody).toContain('[TRUNCATED')
  })

  test('keeps proxy failure records usable when no response exists', () => {
    const request = mapProxyFlow({
      type: 'flow',
      id: 'failed-flow',
      startedAt: 100,
      endedAt: 120,
      method: 'GET',
      url: 'https://unreachable.test/',
      requestHeaders: [],
      status: null,
      error: 'Connection refused',
    })

    expect(request.status).toBeNull()
    expect(request.error).toBe('Connection refused')
    expect(request.responseBody).toBeNull()
  })

  test('redacts complete request and response JSON before applying a body limit', () => {
    const body = JSON.stringify({ token: 'top-secret', padding: 'x'.repeat(300) })
    const request = mapProxyFlow(
      {
        type: 'flow',
        id: 'redacted-flow',
        startedAt: 1,
        endedAt: 2,
        method: 'POST',
        url: 'https://example.test/',
        requestHeaders: [],
        requestBody: body,
        responseBody: body,
      },
      { maxBodySize: 80, redactBodyFields: ['token'] },
    )

    expect(request.requestBody).not.toContain('top-secret')
    expect(request.responseBody).not.toContain('top-secret')
    expect(request.requestBody).toContain('[REDACTED]')
    expect(request.responseBody).toContain('[REDACTED]')
  })

  test('does not retain a sidecar-withheld oversized body prefix', () => {
    const request = mapProxyFlow({
      type: 'flow',
      id: 'withheld-flow',
      startedAt: 1,
      endedAt: 2,
      method: 'POST',
      url: 'https://example.test/',
      requestHeaders: [],
      requestBody: '{"token":"top-secret"',
      responseBody: '{"token":"top-secret"',
      requestBodyTruncated: true,
      responseBodyTruncated: true,
    })

    expect(request.requestBody).toBeNull()
    expect(request.responseBody).toBeNull()
    expect(request.responseBodyTruncated).toBe(true)
  })
})
