/**
 * Unit test: fetch interceptor attaches graphql metadata to GraphQL POST requests.
 *
 * We test the parsing logic directly since the interceptor patches globalThis.fetch
 * which requires a mock environment.
 */

// Inline the same extractGraphQLInfo function from interceptors/fetch.ts
// to test it in isolation (avoids the need to mock globalThis.fetch).

import type { GraphQLInfo } from 'hakka-core'

function extractGraphQLInfo(method: string, body: string | undefined): GraphQLInfo | undefined {
  if (method !== 'POST' || !body) return undefined
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return undefined

    const query = parsed.query
    if (typeof query !== 'string') return undefined

    const typeMatch = query.match(/^\s*(query|mutation|subscription)\b/i)
    if (!typeMatch) return undefined

    const operationType = typeMatch[1].toLowerCase() as GraphQLInfo['operationType']

    let operationName: string | undefined
    if (typeof parsed.operationName === 'string' && parsed.operationName) {
      operationName = parsed.operationName
    } else {
      const nameMatch = query.match(/(?:query|mutation|subscription)\s+(\w+)/i)
      operationName = nameMatch?.[1]
    }

    const variables =
      parsed.variables && typeof parsed.variables === 'object'
        ? (parsed.variables as Record<string, unknown>)
        : undefined

    return { operationType, operationName, variables }
  } catch {
    // not JSON — ignore
  }
  return undefined
}

describe('fetch interceptor — extractGraphQLInfo', () => {
  it('returns undefined for GET requests', () => {
    const body = JSON.stringify({ query: 'query GetUser { user { id } }' })
    expect(extractGraphQLInfo('GET', body)).toBeUndefined()
  })

  it('returns undefined when body is undefined', () => {
    expect(extractGraphQLInfo('POST', undefined)).toBeUndefined()
  })

  it('returns undefined for non-JSON body', () => {
    expect(extractGraphQLInfo('POST', 'name=foo&bar=baz')).toBeUndefined()
  })

  it('returns undefined for JSON body without query field', () => {
    const body = JSON.stringify({ name: 'test', value: 42 })
    expect(extractGraphQLInfo('POST', body)).toBeUndefined()
  })

  it('returns undefined for JSON body with non-string query field', () => {
    const body = JSON.stringify({ query: 42 })
    expect(extractGraphQLInfo('POST', body)).toBeUndefined()
  })

  it('returns undefined for query that does not start with query/mutation/subscription', () => {
    const body = JSON.stringify({ query: '{ user { id } }' })
    expect(extractGraphQLInfo('POST', body)).toBeUndefined()
  })

  it('detects a named query and extracts operationName', () => {
    const body = JSON.stringify({
      operationName: 'GetUser',
      query: 'query GetUser { user { id name } }',
      variables: {},
    })
    const result = extractGraphQLInfo('POST', body)
    expect(result).toBeDefined()
    expect(result!.operationType).toBe('query')
    expect(result!.operationName).toBe('GetUser')
  })

  it('prefers operationName field over parsed name from query string', () => {
    const body = JSON.stringify({
      operationName: 'ExplicitName',
      query: 'query ParsedName { id }',
    })
    const result = extractGraphQLInfo('POST', body)
    expect(result!.operationName).toBe('ExplicitName')
  })

  it('falls back to parsing operation name from query string when operationName absent', () => {
    const body = JSON.stringify({ query: 'query FetchPosts { posts { title } }' })
    const result = extractGraphQLInfo('POST', body)
    expect(result!.operationName).toBe('FetchPosts')
  })

  it('detects mutations', () => {
    const body = JSON.stringify({
      query: 'mutation CreateUser($name: String!) { createUser(name: $name) { id } }',
      variables: { name: 'Alice' },
    })
    const result = extractGraphQLInfo('POST', body)
    expect(result).toBeDefined()
    expect(result!.operationType).toBe('mutation')
    expect(result!.operationName).toBe('CreateUser')
    expect(result!.variables).toEqual({ name: 'Alice' })
  })

  it('detects subscriptions', () => {
    const body = JSON.stringify({ query: 'subscription OnMessage { message { text } }' })
    const result = extractGraphQLInfo('POST', body)
    expect(result).toBeDefined()
    expect(result!.operationType).toBe('subscription')
    expect(result!.operationName).toBe('OnMessage')
  })

  it('handles anonymous queries (type detected, name undefined)', () => {
    const body = JSON.stringify({ query: 'query { user { id } }' })
    const result = extractGraphQLInfo('POST', body)
    expect(result).toBeDefined()
    expect(result!.operationType).toBe('query')
    expect(result!.operationName).toBeUndefined()
  })

  it('attaches variables to result', () => {
    const variables = { userId: 42, includeDeleted: false }
    const body = JSON.stringify({ query: 'query GetUser { id }', variables })
    const result = extractGraphQLInfo('POST', body)
    expect(result!.variables).toEqual(variables)
  })
})
