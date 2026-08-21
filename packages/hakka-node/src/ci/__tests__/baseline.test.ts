import { describe, expect, test } from 'bun:test'

import { parseBaseline, serializeBaseline } from '../baseline'
import type { NormalizedEndpoint } from '../normalize'

function endpoint(overrides: Partial<NormalizedEndpoint>): NormalizedEndpoint {
  return {
    key: 'GET api.example.com/users',
    method: 'GET',
    host: 'api.example.com',
    path: '/users',
    statuses: ['200'],
    requestHeaderNames: ['content-type'],
    requestBodyShapes: [],
    ...overrides,
  }
}

describe('serializeBaseline / parseBaseline', () => {
  test('round-trips endpoints', () => {
    const endpoints = [endpoint({}), endpoint({ key: 'POST api.example.com/users', method: 'POST' })]
    const text = serializeBaseline(endpoints)
    const parsed = parseBaseline(text)
    expect(parsed.endpoints).toEqual([...endpoints].sort((a, b) => a.key.localeCompare(b.key)))
  })

  test('is line-oriented — one line per endpoint plus a header line', () => {
    const endpoints = [endpoint({}), endpoint({ key: 'POST api.example.com/users', method: 'POST' })]
    const text = serializeBaseline(endpoints)
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 endpoints
  })

  test('output is sorted by key regardless of input order', () => {
    const endpoints = [endpoint({ key: 'GET api.example.com/z' }), endpoint({ key: 'GET api.example.com/a' })]
    const text = serializeBaseline(endpoints)
    const lines = text.trim().split('\n').slice(1)
    expect(JSON.parse(lines[0]!).key).toBe('GET api.example.com/a')
    expect(JSON.parse(lines[1]!).key).toBe('GET api.example.com/z')
  })

  test('byte-identical re-serialization of the same logical baseline (no phantom diffs)', () => {
    const endpoints = [endpoint({})]
    const a = serializeBaseline(endpoints)
    const b = serializeBaseline([...endpoints]) // same content, fresh array
    expect(a).toBe(b)
  })

  test('throws with a line number on malformed JSON', () => {
    const text = '{"hakkaCiBaseline":1}\nnot json\n'
    expect(() => parseBaseline(text)).toThrow(/line 2/)
  })

  test('throws when the header line is missing the schema marker', () => {
    expect(() => parseBaseline('{}\n')).toThrow(/hakkaCiBaseline/)
  })

  test('throws on an empty file', () => {
    expect(() => parseBaseline('')).toThrow(/empty/)
  })

  test('tolerates blank lines', () => {
    const endpoints = [endpoint({})]
    const text = serializeBaseline(endpoints)
    const withBlankLines = text + '\n\n'
    expect(parseBaseline(withBlankLines).endpoints).toEqual(endpoints)
  })
})
