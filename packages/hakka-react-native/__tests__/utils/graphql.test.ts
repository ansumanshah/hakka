import { extractGraphQLOperationName, getRequestDisplayName } from 'hakka-core'

describe('extractGraphQLOperationName', () => {
  it('returns null for non-GraphQL URLs', () => {
    expect(extractGraphQLOperationName('https://api.example.com/rest/users', undefined, {})).toBeNull()
  })

  it('returns null when body is missing', () => {
    expect(extractGraphQLOperationName('https://api.example.com/graphql', undefined)).toBeNull()
  })

  it('extracts operationName from JSON body', () => {
    const body = JSON.stringify({ operationName: 'GetUser', query: '{ user { id } }' })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBe('GetUser')
  })

  it('extracts name from query string when operationName not present', () => {
    const body = JSON.stringify({ query: 'query FetchPosts { posts { title } }' })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBe('FetchPosts')
  })

  it('extracts mutation name', () => {
    const body = JSON.stringify({ query: 'mutation CreateUser($name: String!) { createUser(name: $name) { id } }' })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBe('CreateUser')
  })

  it('extracts subscription name', () => {
    const body = JSON.stringify({ query: 'subscription OnMessage { message { text } }' })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBe('OnMessage')
  })

  it('detects graphql via content-type header', () => {
    const body = JSON.stringify({ operationName: 'MyOp', query: '{ id }' })
    expect(
      extractGraphQLOperationName('https://api.example.com/api', body, {
        'content-type': 'application/graphql',
      }),
    ).toBe('MyOp')
  })

  it('falls back to regex on non-JSON body', () => {
    const body = 'query GetOrder { order { id } }'
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBe('GetOrder')
  })

  it('returns null for anonymous queries', () => {
    const body = JSON.stringify({ query: '{ user { id } }' })
    expect(extractGraphQLOperationName('https://api.example.com/graphql', body)).toBeNull()
  })
})

describe('getRequestDisplayName', () => {
  it('returns GraphQL label when operation name found', () => {
    const body = JSON.stringify({ operationName: 'GetUser', query: '{ user { id } }' })
    expect(getRequestDisplayName('https://api.example.com/graphql', body)).toBe('GraphQL: GetUser')
  })

  it('returns URL path for regular requests', () => {
    expect(getRequestDisplayName('https://api.example.com/users/123')).toBe('/users/123')
  })

  it('returns "/" for root path', () => {
    expect(getRequestDisplayName('https://api.example.com')).toBe('/')
  })

  it('handles malformed URL gracefully', () => {
    const result = getRequestDisplayName('not-a-url')
    expect(typeof result).toBe('string')
  })
})
