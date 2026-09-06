import { mockEngine } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { exportMocksJson, importMocksJson, loadMocks, saveMocks } from '../mockPersist'

describe('portable mock persistence', () => {
  beforeEach(() => {
    mockEngine.clearRules()
    localStorage.removeItem('hakka:mocks')
  })
  afterEach(() => {
    mockEngine.clearRules()
    localStorage.removeItem('hakka:mocks')
  })

  it('restores the same override behavior after a reload', () => {
    mockEngine.addRule({
      id: 'shared',
      pattern: '/api',
      enabled: true,
      mode: 'rewrite',
      modify: { setResponseHeaders: { 'x-local': 'yes' }, setQueryParams: { preview: 'true' } },
      response: { status: 200, body: '', delay: 40, headers: { 'content-type': 'text/plain' } },
    })
    const expected = mockEngine.getRules()
    saveMocks()
    mockEngine.clearRules()
    loadMocks()
    expect(mockEngine.getRules()).toEqual(expected)
    expect(JSON.parse(exportMocksJson()).version).toBe(1)
  })

  it('migrates legacy files, skips duplicate endpoints and rejects invalid files atomically', () => {
    expect(importMocksJson(JSON.stringify([{ pattern: '/old', status: 202, body: 'accepted' }]))).toBe(1)
    expect(importMocksJson(JSON.stringify([{ pattern: '/old', status: 202, body: 'accepted' }]))).toBe(0)
    const rule = { id: 'new', pattern: '/new', enabled: true, response: { status: 200, body: '' } }
    expect(() =>
      importMocksJson(JSON.stringify({ version: 1, rules: [rule, { ...rule, id: 'bad', pattern: 123 }] })),
    ).toThrow()
    expect(mockEngine.getRules().map((item) => item.pattern)).toEqual(['/old'])
  })
})
