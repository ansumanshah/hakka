export const extractGraphQLOperationName = (
  url: string,
  body?: string,
  headers?: Record<string, string>,
): string | null => {
  const isGraphQL =
    url.includes('/graphql') || url.includes('graphql') || headers?.['content-type']?.includes('application/graphql')

  if (!isGraphQL || !body) return null

  try {
    const parsed = JSON.parse(body)

    if (parsed.operationName && typeof parsed.operationName === 'string') {
      return parsed.operationName
    }

    if (parsed.query && typeof parsed.query === 'string') {
      const queryMatch = parsed.query.match(/(?:query|mutation|subscription)\s+(\w+)/)
      if (queryMatch) return queryMatch[1] || null
    }

    return null
  } catch {
    const match = body.match(/(?:query|mutation|subscription)\s+(\w+)/)
    return match?.[1] || null
  }
}

/**
 * Raw query/mutation/subscription text for display only — deliberately not part of
 * `GraphQLInfo`/the wire contract, since every platform already holds the request body
 * locally. Returns null for a missing/non-JSON body or no string `query` field (e.g. a
 * persisted-query request sending only a hash); callers should render nothing then.
 */
export const extractGraphQLQuery = (body?: string | null): string | null => {
  if (!body) return null
  try {
    const parsed = JSON.parse(body) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const query = (parsed as { query?: unknown }).query
      if (typeof query === 'string' && query.trim().length > 0) return query
    }
    return null
  } catch {
    return null
  }
}

export const getRequestDisplayName = (url: string, body?: string, headers?: Record<string, string>): string => {
  const operationName = extractGraphQLOperationName(url, body, headers)

  if (operationName) {
    return `GraphQL: ${operationName}`
  }

  try {
    const match = url.match(/^https?:\/\/[^/]+(.*)/)
    return match ? match[1] || '/' : url
  } catch {
    return url
  }
}
