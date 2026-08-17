/**
 * Per-request export formats for the detail view: a copy-pasteable `fetch()`
 * snippet and a plain-text dump for sharing. (cURL lives in hakka-core's
 * `buildCurl`; these are the browser-native companions.)
 */
import type { NetworkRequest } from 'hakka-core'

/** Build a copy-pasteable `fetch()` snippet that reproduces the request. */
export function buildFetch(req: NetworkRequest): string {
  const init: Record<string, unknown> = { method: req.method.toUpperCase() }
  const headers = req.requestHeaders
  if (headers && Object.keys(headers).length > 0) init.headers = headers
  if (req.requestBody != null) init.body = req.requestBody
  return `fetch(${JSON.stringify(req.url)}, ${JSON.stringify(init, null, 2)})`
}

/** Build a plain-text dump of a request (for share / copy-as-text). */
export function buildRequestText(req: NetworkRequest): string {
  const lines: string[] = [`${req.method.toUpperCase()} ${req.url}`]
  if (req.status != null) lines.push(`Status: ${req.status}`)
  if (req.error) lines.push(`Error: ${req.error}`)
  if (req.duration != null) lines.push(`Duration: ${Math.round(req.duration)}ms`)
  if (req.graphql) {
    lines.push(
      `GraphQL: ${req.graphql.operationType}${req.graphql.operationName ? ` ${req.graphql.operationName}` : ''}`,
    )
  }

  const reqHeaders = req.requestHeaders
  if (reqHeaders && Object.keys(reqHeaders).length > 0) {
    lines.push('', '— Request Headers —')
    for (const [k, v] of Object.entries(reqHeaders)) lines.push(`${k}: ${v}`)
  }
  if (req.requestBody) lines.push('', '— Request Body —', req.requestBody)

  const resHeaders = req.responseHeaders
  if (resHeaders && Object.keys(resHeaders).length > 0) {
    lines.push('', '— Response Headers —')
    for (const [k, v] of Object.entries(resHeaders)) lines.push(`${k}: ${v}`)
  }
  if (req.responseBody) lines.push('', '— Response Body —', req.responseBody)

  return lines.join('\n')
}
