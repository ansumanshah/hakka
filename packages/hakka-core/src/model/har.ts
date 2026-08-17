/**
 * HAR 1.2 export utility
 *
 * Converts captured NetworkRequests to HTTP Archive (HAR) format 1.2.
 * Spec: http://www.softwareishard.com/blog/har-12-spec/
 */

import type { NetworkRequest } from './types'

const HAR_VERSION = '1.2'
// Platform-neutral creator identity — this exporter serves every consumer, so
// it must not claim a single platform's name. Not imported from index.ts's
// HAKKA_CORE_VERSION to avoid a circular import.
const CREATOR_NAME = 'hakka-core'
const CREATOR_VERSION = '0.1.0'

interface HarHeader {
  name: string
  value: string
}

interface HarPostData {
  mimeType: string
  text: string
}

interface HarContent {
  size: number
  mimeType: string
  text?: string
}

interface HarTimings {
  send: number
  wait: number
  receive: number
  dns?: number
  connect?: number
  ssl?: number
}

interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    httpVersion: string
    headers: HarHeader[]
    queryString: HarHeader[]
    cookies: HarHeader[]
    headersSize: number
    bodySize: number
    postData?: HarPostData
  }
  response: {
    status: number
    statusText: string
    httpVersion: string
    headers: HarHeader[]
    cookies: HarHeader[]
    content: HarContent
    redirectURL: string
    headersSize: number
    bodySize: number
  }
  cache: Record<string, never>
  timings: HarTimings
}

interface HarLog {
  version: string
  creator: { name: string; version: string }
  entries: HarEntry[]
}

export interface HarExport {
  log: HarLog
}

const headersToHar = (headers?: Record<string, string>): HarHeader[] => {
  if (!headers) return []
  return Object.entries(headers).map(([name, value]) => ({ name, value }))
}

const parseQueryString = (url: string): HarHeader[] => {
  try {
    const questionIndex = url.indexOf('?')
    if (questionIndex === -1) return []
    const query = url.substring(questionIndex + 1)
    const pairs: HarHeader[] = []

    for (const pair of query.split('&')) {
      if (!pair) continue

      const [name, ...valueParts] = pair.split('=')
      pairs.push({
        name: decodeURIComponent(name),
        value: valueParts.length > 0 ? decodeURIComponent(valueParts.join('=')) : '',
      })
    }

    return pairs
  } catch {
    return []
  }
}

/**
 * HAR 1.2 allows -1 for "not computed". A real byte count needs the
 * request/status line and trailing CRLF, unavailable here — a wrong
 * estimate is worse than -1.
 */
const estimateHeadersSize = (_headers?: Record<string, string>): number => {
  return -1
}

const getStatusText = (status?: number): string => {
  const statusTexts: Record<number, string> = {
    100: 'Continue',
    101: 'Switching Protocols',
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  }
  return status ? statusTexts[status] || '' : ''
}

export const requestToHarEntry = (request: NetworkRequest): HarEntry => {
  const startedDateTime = new Date(request.timestamp ?? request.startTime).toISOString()
  const time = request.duration ?? 0

  const ttfb = request.timing?.ttfbMs
  const dl = request.timing?.downloadMs
  const send = request.timing?.send ?? 0
  // Derive wait from whichever of ttfb/download is known so send+wait+receive
  // == time (HAR spec requires timings to sum to total time).
  const waitRaw = ttfb != null ? ttfb : dl != null ? Math.max(0, time - dl) : time
  const receiveRaw = ttfb != null ? (dl ?? 0) : (dl ?? 0)
  // Clamp so the sum never exceeds total time.
  const receive = Math.max(0, Math.min(receiveRaw, time - send - waitRaw))
  const wait = Math.max(0, Math.min(waitRaw, time - send - receive))
  const timings: HarTimings = {
    dns: request.timing?.dnsMs ?? -1,
    connect: request.timing?.connectMs ?? -1,
    ssl: request.timing?.tlsMs ?? -1,
    send,
    wait,
    receive,
  }

  const requestBody = request.requestBody
  const responseBody = request.responseBody

  const entry: HarEntry = {
    startedDateTime,
    time,
    request: {
      method: request.method.toUpperCase(),
      url: request.url,
      httpVersion: 'HTTP/1.1',
      headers: headersToHar(request.requestHeaders),
      queryString: parseQueryString(request.url),
      cookies: [],
      headersSize: estimateHeadersSize(request.requestHeaders),
      bodySize: requestBody ? new TextEncoder().encode(requestBody).length : -1,
      ...(requestBody
        ? {
            postData: {
              mimeType:
                Object.entries(request.requestHeaders ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ??
                'application/octet-stream',
              text: requestBody,
            },
          }
        : {}),
    },
    response: {
      status: request.status ?? 0,
      statusText: getStatusText(request.status ?? undefined),
      httpVersion: 'HTTP/1.1',
      headers: headersToHar(request.responseHeaders),
      cookies: [],
      content: {
        size: request.size ?? (responseBody ? responseBody.length : -1),
        mimeType: request.contentType ?? 'application/octet-stream',
        ...(responseBody ? { text: responseBody } : {}),
      },
      redirectURL: '',
      headersSize: estimateHeadersSize(request.responseHeaders),
      bodySize: responseBody ? new TextEncoder().encode(responseBody).length : -1,
    },
    cache: {},
    timings,
  }

  return entry
}

export const buildHar = (requests: NetworkRequest[]): HarExport => {
  const entries = requests.map(requestToHarEntry)

  return {
    log: {
      version: HAR_VERSION,
      creator: {
        name: CREATOR_NAME,
        version: CREATOR_VERSION,
      },
      entries,
    },
  }
}

export const exportHarString = (requests: NetworkRequest[]): string => {
  return JSON.stringify(buildHar(requests), null, 2)
}
