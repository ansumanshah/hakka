import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildPython } from '../buildPython'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'test-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    startTime: 0,
    ...overrides,
  }
}

describe('buildPython', () => {
  test('emits method, url, and a header', () => {
    const snippet = buildPython(
      makeRequest({
        method: 'POST',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: '{"key":"value"}',
      }),
    )
    expect(snippet).toContain('import requests')
    expect(snippet).toContain('requests.post(')
    expect(snippet).toContain('https://api.example.com/v1/items')
    expect(snippet).toContain('Content-Type')
    expect(snippet).toContain('headers=headers')
    expect(snippet).toContain('data=data')
  })

  test('simple GET has no headers or data block', () => {
    const snippet = buildPython(makeRequest())
    expect(snippet).not.toContain('headers = {')
    expect(snippet).not.toContain('data =')
    expect(snippet).toContain('requests.get(')
  })

  test('escapes embedded single quotes in the body', () => {
    const snippet = buildPython(makeRequest({ method: 'POST', requestBody: "it's here" }))
    expect(snippet).toContain("it\\'s here")
  })
})
