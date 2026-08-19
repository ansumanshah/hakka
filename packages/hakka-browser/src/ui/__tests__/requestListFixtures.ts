import type { FrameworkSpan, NetworkRequest, RequestGroup } from 'hakka-core'

/** Shared builders for the RequestList suites (grouping, virtualization, rows). */

export function makeSpan(id: string, overrides: Partial<FrameworkSpan> = {}): FrameworkSpan {
  return {
    id,
    traceId: 'trace-1',
    parentId: null,
    name: 'BaseServer.handleRequest',
    startTime: 0,
    endTime: 10,
    verbosity: 'primary',
    runtime: 'server',
    ...overrides,
  }
}

/** `n` sequential GET requests, one per millisecond — the virtualization fixture. */
export function reqs(n: number): NetworkRequest[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `r${i}`,
        url: `https://api.example.com/item/${i}`,
        method: 'GET',
        status: 200,
        startTime: i,
        requestHeaders: {},
        responseHeaders: {},
        source: 'fetch',
      }) as NetworkRequest,
  )
}

/** One hop in a trace group — the waterfall fixture (callers set start/end/duration). */
export function makeTraceHop(id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `https://trace.example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime: 0,
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...overrides,
  } as NetworkRequest
}

/** A group of `count` rows under one host key — the grouped-virtualization fixture. */
export function makeGroup(key: string, count: number): RequestGroup {
  const items = Array.from({ length: count }, (_, i) =>
    makeReq(`${key}-${i}`, { url: `https://${key}.example.com/item/${i}` }),
  )
  return { key, label: key, items }
}

export function makeReq(id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `https://example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime: 0,
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...overrides,
  } as NetworkRequest
}
