import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import {
  describeShareScrub,
  scrubBodyForShare,
  scrubHeadersForShare,
  scrubHeaderValuesForShare,
  scrubNetworkRequestForShare,
  scrubRequestsForShare,
  scrubUrlForShare,
} from '../shareScrub'

const SECRET = 'sk-live-abcdef0123456789'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'

function baseRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/v1/chat',
    method: 'POST',
    status: 200,
    startTime: 0,
    duration: 100,
    requestHeaders: {},
    responseHeaders: {},
    ...overrides,
  }
}

describe('scrubUrlForShare', () => {
  test('redacts Basic-auth credentials embedded in the URL', () => {
    const { url, removed } = scrubUrlForShare(`https://user:${SECRET}@api.example.com/path`)
    expect(url).not.toContain(SECRET)
    expect(url).toBe('https://[REDACTED]@api.example.com/path')
    expect(removed).toEqual([{ category: 'basicAuthUrl', count: 1 }])
  })

  test('redacts sensitive query string params', () => {
    const { url, removed } = scrubUrlForShare(`https://api.example.com/data?api_key=${SECRET}&page=2`)
    expect(url).not.toContain(SECRET)
    expect(url).toContain('page=2')
    expect(removed).toEqual([{ category: 'apiKeyQueryParam', count: 1 }])
  })

  test('leaves a clean URL untouched and reports no removals', () => {
    const { url, removed } = scrubUrlForShare('https://api.example.com/users?page=2')
    expect(url).toBe('https://api.example.com/users?page=2')
    expect(removed).toEqual([])
  })

  test('does not throw on a relative or malformed URL', () => {
    expect(() => scrubUrlForShare('/relative/path?x=1')).not.toThrow()
  })
})

describe('scrubHeadersForShare', () => {
  test('blanks a sensitive header value, preserving the key', () => {
    const { headers, removed } = scrubHeadersForShare({ Authorization: `Bearer ${SECRET}`, 'x-request-id': 'abc' })
    expect(headers?.Authorization).toBe('[REDACTED]')
    expect(headers?.['x-request-id']).toBe('abc')
    expect(removed).toEqual([{ category: 'header', count: 1 }])
  })

  test('redacts a Cookie header', () => {
    const { headers, removed } = scrubHeadersForShare({ Cookie: `session=${SECRET}` })
    expect(headers?.Cookie).toBe('[REDACTED]')
    expect(removed).toEqual([{ category: 'header', count: 1 }])
  })

  test('undefined headers pass through unchanged', () => {
    const { headers, removed } = scrubHeadersForShare(undefined)
    expect(headers).toBeUndefined()
    expect(removed).toEqual([])
  })
})

describe('scrubHeaderValuesForShare', () => {
  test('blanks every value of a sensitive multi-value header name, not just the first', () => {
    const { headerValues, removed } = scrubHeaderValuesForShare({
      'set-cookie': [`session=${SECRET}`, `consent=${SECRET}`],
    })
    expect(headerValues?.['set-cookie']).toEqual(['[REDACTED]', '[REDACTED]'])
    expect(removed).toEqual([{ category: 'header', count: 1 }])
  })

  test('leaves a non-sensitive multi-value header untouched', () => {
    const { headerValues, removed } = scrubHeaderValuesForShare({ 'x-shard': ['a', 'b'] })
    expect(headerValues?.['x-shard']).toEqual(['a', 'b'])
    expect(removed).toEqual([])
  })

  test('undefined headerValues passes through unchanged', () => {
    const { headerValues, removed } = scrubHeaderValuesForShare(undefined)
    expect(headerValues).toBeUndefined()
    expect(removed).toEqual([])
  })
})

describe('scrubBodyForShare', () => {
  test('redacts a matching top-level JSON field', () => {
    const { body, removed } = scrubBodyForShare(JSON.stringify({ password: SECRET, username: 'ansuman' }))
    const parsed = JSON.parse(body!) as Record<string, unknown>
    expect(parsed.password).toBe('[REDACTED]')
    expect(parsed.username).toBe('ansuman')
    expect(removed).toEqual([{ category: 'jsonField', count: 1 }])
  })

  test('redacts a matching field nested inside a body object', () => {
    const { body } = scrubBodyForShare(JSON.stringify({ user: { profile: { credentials: { apiKey: SECRET } } } }))
    expect(body).not.toContain(SECRET)
  })

  test('pattern-scans a JSON string leaf under an unlisted field name', () => {
    const { body, removed } = scrubBodyForShare(JSON.stringify({ note: `token was Bearer ${SECRET}` }))
    expect(body).not.toContain(SECRET)
    expect(removed.some((r) => r.category === 'bearerToken')).toBe(true)
  })

  test('redacts a bare JWT in a non-JSON body', () => {
    const { body, removed } = scrubBodyForShare(`the id_token is ${JWT}`)
    expect(body).not.toContain(JWT)
    expect(removed).toEqual([{ category: 'jwt', count: 1 }])
  })

  test('redacts an email address by default', () => {
    const { body, removed } = scrubBodyForShare('contact ansuman@example.com for access')
    expect(body).not.toContain('ansuman@example.com')
    expect(removed).toEqual([{ category: 'email', count: 1 }])
  })

  test('email scrubbing can be opted out', () => {
    const { body } = scrubBodyForShare('contact ansuman@example.com for access', { scrubEmails: false })
    expect(body).toContain('ansuman@example.com')
  })

  test('leaves a clean body unchanged and reports no removals', () => {
    const clean = JSON.stringify({ id: 1, name: 'widget' })
    const { body, removed } = scrubBodyForShare(clean)
    expect(body).toBe(clean)
    expect(removed).toEqual([])
  })

  test('null/empty body passes through', () => {
    expect(scrubBodyForShare(null).body).toBeNull()
    expect(scrubBodyForShare('').body).toBe('')
  })

  test('malformed JSON falls back to pattern scan without throwing', () => {
    expect(() => scrubBodyForShare(`{not json, Bearer ${SECRET}`)).not.toThrow()
  })

  // Built as a raw string, not an object literal: `{ __proto__: v }` in JS source sets the
  // prototype rather than creating an own property, which would mask the bug this test pins.
  // JSON.parse (unlike an object literal) creates a genuine own "__proto__" property.
  test('a "__proto__" key survives scrubbing as an own property, not a prototype reassignment', () => {
    const body = '{"__proto__":{"polluted":true},"name":"alice"}'
    const { body: scrubbedBody, removed } = scrubBodyForShare(body, { extraJsonFields: ['polluted'] })
    const result = JSON.parse(scrubbedBody!) as Record<string, unknown>

    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true)
    expect(result.name).toBe('alice')
    expect(removed.some((r) => r.category === 'jsonField')).toBe(true)
    // A sibling object's prototype must be unaffected by the rebuild.
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })
})

describe('scrubNetworkRequestForShare — the point of the whole task', () => {
  test('a secret placed in a header, a JSON body field, a query string, a cookie, and a nested body object does not appear anywhere in the scrubbed request', () => {
    const request = baseRequest({
      url: `https://api.example.com/v1/chat?api_key=${SECRET}`,
      requestHeaders: {
        Authorization: `Bearer ${SECRET}`,
        Cookie: `session_id=${SECRET}`,
      },
      responseHeaders: {},
      requestBody: JSON.stringify({
        password: SECRET,
        nested: { auth: { token: SECRET } },
      }),
      responseBody: JSON.stringify({ ok: true }),
    })

    const { request: scrubbed, removed } = scrubNetworkRequestForShare(request)
    const serialized = JSON.stringify(scrubbed)

    expect(serialized).not.toContain(SECRET)
    expect(removed.length).toBeGreaterThan(0)
  })

  test('never mutates the input request', () => {
    const request = baseRequest({ requestBody: JSON.stringify({ password: SECRET }) })
    const original = JSON.stringify(request)
    scrubNetworkRequestForShare(request)
    expect(JSON.stringify(request)).toBe(original)
  })

  test('returns an empty removal list for a request with nothing to scrub', () => {
    const request = baseRequest({ requestBody: JSON.stringify({ id: 1 }) })
    const { removed } = scrubNetworkRequestForShare(request)
    expect(removed).toEqual([])
  })

  test('scrubs a matching field inside request.graphql.variables', () => {
    const request = baseRequest({
      graphql: {
        operationName: 'Login',
        operationType: 'mutation',
        variables: { password: SECRET, username: 'ansuman' },
      },
    })

    const { request: scrubbed, removed } = scrubNetworkRequestForShare(request)

    expect(scrubbed.graphql?.variables?.password).toBe('[REDACTED]')
    expect(scrubbed.graphql?.variables?.username).toBe('ansuman')
    expect(JSON.stringify(scrubbed)).not.toContain(SECRET)
    expect(removed.some((r) => r.category === 'jsonField')).toBe(true)
  })

  test('pattern-scans a string leaf in graphql.variables under an unlisted field name', () => {
    const request = baseRequest({
      graphql: {
        operationType: 'mutation',
        variables: { note: `token was Bearer ${SECRET}` },
      },
    })

    const { request: scrubbed } = scrubNetworkRequestForShare(request)

    expect(JSON.stringify(scrubbed)).not.toContain(SECRET)
  })

  test('leaves graphql untouched when there is nothing to scrub in variables', () => {
    const request = baseRequest({
      graphql: { operationType: 'query', variables: { id: 1 } },
    })

    const { request: scrubbed, removed } = scrubNetworkRequestForShare(request)

    expect(scrubbed.graphql).toEqual(request.graphql)
    expect(removed).toEqual([])
  })

  test('scrubs responseHeaderValues consistently with responseHeaders — no bypass through the multi-value field', () => {
    const request = baseRequest({
      responseHeaders: { 'set-cookie': `session=${SECRET}, consent=${SECRET}` },
      responseHeaderValues: { 'set-cookie': [`session=${SECRET}`, `consent=${SECRET}`] },
    })

    const { request: scrubbed, removed } = scrubNetworkRequestForShare(request)

    expect(scrubbed.responseHeaders?.['set-cookie']).toBe('[REDACTED]')
    expect(scrubbed.responseHeaderValues?.['set-cookie']).toEqual(['[REDACTED]', '[REDACTED]'])
    expect(JSON.stringify(scrubbed)).not.toContain(SECRET)
    expect(removed.length).toBeGreaterThan(0)
  })
})

describe('scrubRequestsForShare', () => {
  test('merges removal tallies across multiple requests', () => {
    const requests = [
      baseRequest({ id: 'a', requestBody: JSON.stringify({ password: SECRET }) }),
      baseRequest({ id: 'b', requestBody: JSON.stringify({ secret: SECRET }) }),
    ]
    const { requests: scrubbed, removed } = scrubRequestsForShare(requests)
    expect(scrubbed.every((r) => !JSON.stringify(r).includes(SECRET))).toBe(true)
    const jsonFieldTally = removed.find((r) => r.category === 'jsonField')
    expect(jsonFieldTally?.count).toBe(2)
  })
})

describe('describeShareScrub', () => {
  test('reports what was removed, by category', () => {
    const text = describeShareScrub({ applied: true, removed: [{ category: 'header', count: 2 }] })
    expect(text).toContain('2 header')
  })

  test('is explicit when scrubbing ran but found nothing', () => {
    const text = describeShareScrub({ applied: true, removed: [] })
    expect(text.toLowerCase()).toContain('nothing matched')
  })

  test('is explicit when scrubbing was not applied at all', () => {
    const text = describeShareScrub({ applied: false, removed: [] })
    expect(text.toLowerCase()).toContain('not applied')
  })
})
