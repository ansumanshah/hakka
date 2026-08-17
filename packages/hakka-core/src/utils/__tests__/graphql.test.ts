import { describe, expect, test } from 'bun:test'

import { extractGraphQLOperationName, extractGraphQLQuery, getRequestDisplayName } from '../graphql'

describe('extractGraphQLOperationName', () => {
  test('returns null for a non-GraphQL URL even with a query-shaped body', () => {
    expect(
      extractGraphQLOperationName('https://api.example.com/rest/users', '{"query":"query GetUsers { users }"}'),
    ).toBeNull()
  })

  test('returns null when there is no body', () => {
    expect(extractGraphQLOperationName('https://api.example.com/graphql')).toBeNull()
  })

  test('prefers an explicit operationName field over parsing the query string', () => {
    const body = JSON.stringify({
      query: 'query SomethingElse { users { id } }',
      operationName: 'ExplicitName',
    })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBe('ExplicitName')
  })

  test('derives the operation name from the query string when operationName is absent', () => {
    const body = JSON.stringify({ query: 'query GetUsers { users { id } }' })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBe('GetUsers')
  })

  test('matches a mutation operation type from the query string', () => {
    const body = JSON.stringify({ query: 'mutation CreateUser($name: String!) { createUser(name: $name) { id } }' })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBe('CreateUser')
  })

  test('detects a GraphQL request via a bare "graphql" substring in the URL, not just "/graphql"', () => {
    const body = JSON.stringify({ query: 'query Ping { ping }' })
    expect(extractGraphQLOperationName('https://api.example.com/v2/graphql-proxy', body)).toBe('Ping')
  })

  test('detects a GraphQL request via the application/graphql content-type header on a non-graphql URL', () => {
    const body = JSON.stringify({ query: 'query Ping { ping }' })
    expect(
      extractGraphQLOperationName('https://api.example.com/rpc', body, { 'content-type': 'application/graphql' }),
    ).toBe('Ping')
  })

  test('returns null when the query has no named operation (anonymous query)', () => {
    const body = JSON.stringify({ query: '{ users { id } }' })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBeNull()
  })

  test('falls back to a raw-body regex match when the body is not valid JSON', () => {
    const rawBody = 'query GetUsersRaw { users { id } }'
    expect(extractGraphQLOperationName('https://api.example.com/graphql', rawBody)).toBe('GetUsersRaw')
  })

  test('returns null when JSON parsing fails and the raw-body regex also finds nothing', () => {
    expect(extractGraphQLOperationName('https://api.example.com/graphql', 'not json, not graphql either')).toBeNull()
  })
})

describe('getRequestDisplayName', () => {
  test('returns "GraphQL: <name>" for a GraphQL operation', () => {
    const body = JSON.stringify({ query: 'query GetOrders { orders { id } }' })
    expect(getRequestDisplayName('https://api.example.com/graphql', body)).toBe('GraphQL: GetOrders')
  })

  test('falls back to the URL path (stripping origin) for a non-GraphQL request', () => {
    expect(getRequestDisplayName('https://api.example.com/v1/users/42')).toBe('/v1/users/42')
  })

  test('returns "/" for a bare origin with no path', () => {
    expect(getRequestDisplayName('https://api.example.com')).toBe('/')
  })

  test('returns the raw string unchanged when it is not a well-formed http(s) URL', () => {
    expect(getRequestDisplayName('not-a-url')).toBe('not-a-url')
  })
})

describe('extractGraphQLQuery', () => {
  test('returns the query text from a well-formed GraphQL body', () => {
    const body = JSON.stringify({ query: 'query GetUsers { users { id } }', variables: {} })
    expect(extractGraphQLQuery(body)).toBe('query GetUsers { users { id } }')
  })

  test('returns the mutation text unchanged', () => {
    const query = 'mutation CreateUser($name: String!) { createUser(name: $name) { id } }'
    expect(extractGraphQLQuery(JSON.stringify({ query }))).toBe(query)
  })

  test('returns null when body is undefined', () => {
    expect(extractGraphQLQuery(undefined)).toBeNull()
  })

  test('returns null when body is null', () => {
    expect(extractGraphQLQuery(null)).toBeNull()
  })

  test('returns null when body is an empty string', () => {
    expect(extractGraphQLQuery('')).toBeNull()
  })

  test('returns null when the body is not valid JSON (e.g. truncated by a body-size cap)', () => {
    const truncated = JSON.stringify({ query: 'query GetUsers { users { id' }).slice(0, 20)
    expect(extractGraphQLQuery(truncated)).toBeNull()
  })

  test('returns null when the body has no query field (persisted-query request)', () => {
    expect(extractGraphQLQuery(JSON.stringify({ extensions: { persistedQuery: { sha256Hash: 'abc' } } }))).toBeNull()
  })

  test('returns null when query is present but not a string', () => {
    expect(extractGraphQLQuery(JSON.stringify({ query: 123 }))).toBeNull()
  })

  test('returns null when query is an empty/whitespace string', () => {
    expect(extractGraphQLQuery(JSON.stringify({ query: '   ' }))).toBeNull()
  })

  test('returns null when the parsed body is an array, not an object', () => {
    expect(extractGraphQLQuery(JSON.stringify(['query', 'x']))).toBeNull()
  })
})
