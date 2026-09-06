import { isBodyTruncated, limitBodySize, redactHeaderValues, redactHeaders, redactJsonBody } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

import type { ProxyFlowEvent, ProxyHeader } from './types'

function headersToRecord(headers: ProxyHeader[] | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const header of headers ?? []) {
    const prior = result[header.name]
    result[header.name] = prior === undefined ? header.value : `${prior}, ${header.value}`
  }
  return result
}

function responseHeaderValues(headers: ProxyHeader[] | undefined): Record<string, string[]> | undefined {
  const values = new Map<string, string[]>()
  for (const header of headers ?? []) {
    const current = values.get(header.name) ?? []
    current.push(header.value)
    values.set(header.name, current)
  }
  const repeated = Object.fromEntries([...values].filter(([, value]) => value.length > 1))
  return Object.keys(repeated).length > 0 ? repeated : undefined
}

export interface ProxyMapperOptions {
  maxBodySize?: number
  redactHeaders?: string[]
  redactBodyFields?: string[]
}

/** Converts a completed mitmproxy flow into the shared Hakka capture wire shape. */
export function mapProxyFlow(event: ProxyFlowEvent, options: ProxyMapperOptions = {}): NetworkRequest {
  // Redact complete JSON before applying the display bound. A bound prefix is often invalid JSON,
  // which would otherwise make body redaction fail open and retain a secret in the preview.
  const redactedRequest = event.requestBodyTruncated
    ? null
    : redactJsonBody(event.requestBody, options.redactBodyFields)
  const redactedResponse = event.responseBodyTruncated
    ? null
    : redactJsonBody(event.responseBody, options.redactBodyFields)
  const requestBody = limitBodySize(redactedRequest ?? undefined, options.maxBodySize) ?? null
  const responseBody = limitBodySize(redactedResponse ?? undefined, options.maxBodySize) ?? null
  const requestHeaders = redactHeaders(headersToRecord(event.requestHeaders), options.redactHeaders)
  const rawResponseHeaders = headersToRecord(event.responseHeaders)
  const responseHeaders = redactHeaders(rawResponseHeaders, options.redactHeaders)
  const rawValues = responseHeaderValues(event.responseHeaders)
  const redactedValues = rawValues ? redactHeaderValues(rawValues, options.redactHeaders) : undefined
  const duration = Math.max(0, event.endedAt - event.startedAt)
  const contentType =
    event.contentType ?? Object.entries(rawResponseHeaders).find(([name]) => name.toLowerCase() === 'content-type')?.[1]

  return {
    id: event.id,
    url: event.url,
    method: event.method,
    status: event.status ?? null,
    startTime: event.startedAt,
    endTime: event.endedAt,
    duration,
    timestamp: event.startedAt,
    requestHeaders,
    responseHeaders,
    ...(redactedValues ? { responseHeaderValues: redactedValues } : {}),
    requestBody,
    responseBody,
    requestBodySize: event.requestBodySize ?? event.requestBody?.length ?? 0,
    responseBodySize: event.responseBodySize ?? event.responseBody?.length ?? 0,
    ...(event.responseBodyTruncated || isBodyTruncated(responseBody ?? undefined)
      ? { responseBodyTruncated: true }
      : {}),
    error: event.error ?? null,
    source: 'http',
    runtime: 'client',
    library: 'mitmproxy',
    ...(contentType ? { contentType } : {}),
    ...(event.httpVersion ? { networkProtocol: event.httpVersion } : {}),
    timing: { total: duration },
  }
}
