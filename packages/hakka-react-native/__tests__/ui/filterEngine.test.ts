/**
 * Tests for the core query engine as used by the RN List component.
 * Verifies the key paths: scoped search, regex, wildcard, status DSL,
 * range tokens, negation, multi-method.
 */
import type { NetworkRequest } from 'hakka-core'
import { compileQuery, parseRangeFilters, parseSearchTokens } from 'hakka-core'

function req(overrides: Partial<NetworkRequest> & { id: string }): NetworkRequest {
  return {
    url: 'https://api.example.com/v1/users',
    method: 'GET',
    startTime: Date.now(),
    timestamp: Date.now(),
    status: 200,
    duration: 100,
    ...overrides,
  }
}

const REQ_JSON = req({
  id: 'json',
  url: 'https://api.example.com/v1/users?page=1',
  method: 'POST',
  status: 201,
  duration: 250,
  requestBodySize: 512,
  responseBodySize: 1024,
  requestBody: '{"name":"Alice"}',
  responseBody: '{"id":1}',
})

const REQ_HTML = req({
  id: 'html',
  url: 'https://cdn.example.com/index.html',
  method: 'GET',
  status: 200,
  duration: 50,
  requestBodySize: 0,
  responseBodySize: 2048,
})

const REQ_ERR = req({
  id: 'err',
  url: 'https://api.example.com/v1/auth',
  method: 'GET',
  status: 401,
  duration: 10,
  requestBodySize: 0,
  responseBodySize: 100,
})

const REQ_SLOW = req({
  id: 'slow',
  url: 'https://slow.example.com/api',
  method: 'DELETE',
  status: 500,
  duration: 5000,
  requestBodySize: 0,
  responseBodySize: 50,
})

const ALL = [REQ_JSON, REQ_HTML, REQ_ERR, REQ_SLOW]

function match(filter: string, reqs = ALL): string[] {
  const { ranges, rest } = parseRangeFilters(filter)
  const pred = compileQuery({ tokens: parseSearchTokens(rest), ...ranges })
  return reqs.filter(pred).map((r) => r.id)
}

// ── substring ────────────────────────────────────────────────────────────────

describe('compileQuery - substring', () => {
  it('matches URL substring case-insensitively', () => {
    expect(match('USERS')).toEqual(['json'])
  })

  it('matches across all fields by default (scope:all)', () => {
    expect(match('alice')).toEqual(['json']) // requestBody
  })

  it('returns all when filter is empty', () => {
    const pred = compileQuery({ tokens: [] })
    expect(ALL.filter(pred).map((r) => r.id)).toEqual(['json', 'html', 'err', 'slow'])
  })
})

// ── scope prefixes ───────────────────────────────────────────────────────────

describe('compileQuery - scope prefixes', () => {
  it('url: restricts match to URL field only', () => {
    // "alice" is only in requestBody, not URL — url: scope should miss it
    expect(match('url:alice')).toEqual([])
    expect(match('url:users')).toEqual(['json'])
  })

  it('body: restricts match to body fields', () => {
    expect(match('body:alice')).toEqual(['json'])
    expect(match('body:users')).toEqual([]) // "users" is in URL, not body
  })
})

// ── regex ────────────────────────────────────────────────────────────────────

describe('compileQuery - regex', () => {
  it('/pattern/ uses regex matching', () => {
    expect(match('/v1\\/.+/')).toContain('json')
    expect(match('/v1\\/.+/')).toContain('err')
    expect(match('/v1\\/.+/')).not.toContain('html')
  })
})

// ── wildcard ─────────────────────────────────────────────────────────────────

describe('compileQuery - wildcard', () => {
  it('* wildcard matches any chars', () => {
    expect(match('*.html')).toEqual(['html'])
  })
})

// ── negation ─────────────────────────────────────────────────────────────────

describe('compileQuery - negation', () => {
  it('-token excludes requests that match the token', () => {
    const ids = match('-example.com')
    expect(ids).toEqual([]) // all URLs contain example.com
  })

  it('-token keeps requests that do NOT match', () => {
    const ids = match('-slow')
    expect(ids).not.toContain('slow')
    expect(ids).toContain('json')
    expect(ids).toContain('html')
    expect(ids).toContain('err')
  })
})

// ── status DSL ───────────────────────────────────────────────────────────────

describe('compileQuery - statusDsl', () => {
  it('2xx matches 200-range only', () => {
    const pred = compileQuery({ statusDsl: '2xx' })
    expect(ALL.filter(pred).map((r) => r.id)).toEqual(['json', 'html'])
  })

  it('4xx matches 400-range only', () => {
    const pred = compileQuery({ statusDsl: '4xx' })
    expect(ALL.filter(pred).map((r) => r.id)).toEqual(['err'])
  })

  it('>=400 matches 4xx and 5xx', () => {
    const pred = compileQuery({ statusDsl: '>=400' })
    const ids = ALL.filter(pred).map((r) => r.id)
    expect(ids).toContain('err')
    expect(ids).toContain('slow')
    expect(ids).not.toContain('json')
  })
})

// ── range filters (parsed from search box) ───────────────────────────────────

describe('parseRangeFilters + compileQuery - duration', () => {
  it('dur>200 matches requests slower than 200ms', () => {
    const { ranges, rest } = parseRangeFilters('dur>200')
    expect(rest.trim()).toBe('')
    const pred = compileQuery({ ...ranges })
    const ids = ALL.filter(pred).map((r) => r.id)
    expect(ids).toContain('json') // 250ms
    expect(ids).toContain('slow') // 5000ms
    expect(ids).not.toContain('html') // 50ms
    expect(ids).not.toContain('err') // 10ms
  })

  it('dur<100 matches fast requests', () => {
    const { ranges } = parseRangeFilters('dur<100')
    const pred = compileQuery({ ...ranges })
    const ids = ALL.filter(pred).map((r) => r.id)
    expect(ids).toContain('html') // 50ms
    expect(ids).toContain('err') // 10ms
    expect(ids).not.toContain('json') // 250ms
  })
})

describe('parseRangeFilters + compileQuery - size', () => {
  it('size>1kb matches large responses', () => {
    const { ranges } = parseRangeFilters('size>1kb')
    const pred = compileQuery({ ...ranges })
    const ids = ALL.filter(pred).map((r) => r.id)
    // REQ_JSON: 512+1024=1536 bytes > 1024
    expect(ids).toContain('json')
    // REQ_HTML: 0+2048=2048 bytes > 1024
    expect(ids).toContain('html')
    // REQ_ERR: 0+100=100 bytes — not > 1024
    expect(ids).not.toContain('err')
  })
})

describe('parseRangeFilters - strips range tokens from rest', () => {
  it('leaves non-range text intact', () => {
    const { ranges, rest } = parseRangeFilters('users dur>100 page=1')
    expect(rest.trim()).toBe('users page=1')
    expect(ranges.durationMin).toBe(101)
  })
})

// ── AND semantics ─────────────────────────────────────────────────────────────

describe('compileQuery - AND across tokens', () => {
  it('multiple tokens are ANDed', () => {
    // Both "api" AND "users" must match
    expect(match('api users')).toEqual(['json']) // REQ_JSON URL has both
    expect(match('api html')).toEqual([]) // no URL has both
  })
})

// ── method filter ─────────────────────────────────────────────────────────────

describe('compileQuery - method', () => {
  it('method:POST filters to POST only', () => {
    const pred = compileQuery({ method: 'POST' })
    expect(ALL.filter(pred).map((r) => r.id)).toEqual(['json'])
  })

  it('method filter is case-insensitive', () => {
    const pred = compileQuery({ method: 'post' })
    expect(ALL.filter(pred).map((r) => r.id)).toEqual(['json'])
  })
})
