export const extractGraphQLOperationName = (
  url: string,
  body?: string,
  headers?: Record<string, string>,
): string | null => {
  const isGraphQL = url.includes('graphql') || headers?.['content-type']?.includes('application/graphql')

  if (!isGraphQL || !body) return null

  try {
    const parsed = JSON.parse(body)

    if (parsed.operationName && typeof parsed.operationName === 'string') {
      return parsed.operationName
    }

    if (typeof parsed.query === 'string') {
      return parsed.query.match(/(?:query|mutation|subscription)\s+(\w+)/)?.[1] || null
    }

    return null
  } catch {
    const match = body.match(/(?:query|mutation|subscription)\s+(\w+)/)
    return match?.[1] || null
  }
}

/** Raw query text for display; persisted queries without text return null. */
export const extractGraphQLQuery = (body?: string | null): string | null => {
  if (!body) return null
  try {
    const query = (JSON.parse(body) as { query?: unknown } | null)?.query
    return typeof query === 'string' && query.trim() ? query : null
  } catch {
    return null
  }
}

export const getRequestDisplayName = (url: string, body?: string, headers?: Record<string, string>): string => {
  const operationName = extractGraphQLOperationName(url, body, headers)

  if (operationName) {
    return `GraphQL: ${operationName}`
  }

  const match = url.match(/^https?:\/\/[^/]+(.*)/)
  return match ? match[1] || '/' : url
}
