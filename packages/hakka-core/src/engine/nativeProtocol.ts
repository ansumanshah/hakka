import type { NetworkRequest } from '../model/types'

declare const __DEV__: boolean

/**
 * nativeProtocol.ts — the wire protocol the Hakka facade speaks to a native
 * TurboModule (RN's `HakkaMonitor`): the module/event-emitter shapes, parsing
 * raw native payloads into `NetworkRequest`s, and adapting the native
 * trace-handle calls.
 */

type NativeModuleName = 'HakkaMonitor'

export const NATIVE_MODULE_NAMES: NativeModuleName[] = ['HakkaMonitor']
export const NATIVE_REQUEST_EVENT = 'onHakkaRequests'

export type NativeHakkaModule = {
  hideUI?: () => void
  getSnapshot?: () => Promise<unknown> | unknown
  getHealthReport?: () => Promise<unknown> | unknown
  setUserId?: (userId: string | null) => void
  setTag?: (key: string, value: string) => void
  addBreadcrumb?: (name: string, attributes?: { [key: string]: string }) => void
  startTrace?: (name: string) => string | Promise<string>
  setTraceAttribute?: (traceId: string, key: string, value: string) => void
  setTraceMetric?: (traceId: string, key: string, value: number) => void
  finishTrace?: (traceId: string) => void
  /** Synchronous probe: `true` when the optional native UI package is linked (`showUI` silently no-ops otherwise). */
  isUIAvailable?: () => boolean
  showUI: (mode: string) => void
  clearLogs: () => void
  /** Pause the native capture engine (native-mode RN). */
  pause?: () => void
  /** Resume the native capture engine after a pause. */
  resume?: () => void
  setSensitiveHeaders: (headers: string[]) => void
  setIgnoredHosts: (hosts: string[]) => void
  setIgnoredPatterns: (patterns: string[]) => void
  initialize: () => Promise<void>
  getLogs: () => Promise<unknown[] | string>
  addListener: (eventName: string) => void
  removeListeners: (count: number) => void
}

export interface NativeEventEmitterLike {
  addListener(event: string, cb: (payload: unknown) => void): { remove(): void }
}

export interface NativeCaptureAdapter {
  getModule(): NativeHakkaModule | null
  createEventEmitter(module: NativeHakkaModule): NativeEventEmitterLike
  /** Signal the native engine to stop buffering/recording. Optional. */
  pause?(): void
  /** Signal the native engine to resume after a pause. Optional. */
  resume?(): void
}

export interface TraceHandle {
  setAttribute: (key: string, value: string) => void
  setMetric: (key: string, value: number) => void
  finish: () => void
}

export function noopTraceHandle(reason: string): TraceHandle {
  return {
    setAttribute: () => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[Hakka] startTrace unavailable in JS fallback (${reason})`)
      }
    },
    setMetric: () => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[Hakka] startTrace unavailable in JS fallback (${reason})`)
      }
    },
    finish: () => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[Hakka] startTrace unavailable in JS fallback (${reason})`)
      }
    },
  }
}

export function wrapNativeTraceHandle(native: NativeHakkaModule, traceId: string): TraceHandle {
  return {
    setAttribute: (key: string, value: string) => {
      native.setTraceAttribute?.(traceId, key, value)
    },
    setMetric: (key: string, value: number) => {
      native.setTraceMetric?.(traceId, key, value)
    },
    finish: () => {
      native.finishTrace?.(traceId)
    },
  }
}

function parseNativeRequest(raw: unknown): NetworkRequest | null {
  if (!raw || typeof raw !== 'object') return null

  const payload = raw as Record<string, unknown>

  const url = typeof payload.url === 'string' ? payload.url : ''
  if (!url) return null

  const now = Date.now()
  const method = typeof payload.method === 'string' ? payload.method : 'GET'
  const startTime = typeof payload.startTime === 'number' ? payload.startTime : now
  // Deterministic fallback id so a record re-sent on getLogs() replay dedups
  // against the live copy instead of being re-added under a fresh random id.
  const id = typeof payload.id === 'string' ? payload.id : `native-${method}-${startTime}-${url}`

  const request = {
    id,
    url,
    method,
    status:
      typeof payload.status === 'number'
        ? payload.status
        : typeof payload.status === 'string'
          ? Number(payload.status)
          : undefined,
    startTime,
    endTime:
      typeof payload.endTime === 'number'
        ? payload.endTime
        : payload.timestamp === undefined && payload.startTime === undefined
          ? now
          : undefined,
    duration: typeof payload.duration === 'number' ? payload.duration : payload.duration === null ? null : undefined,
    requestHeaders:
      typeof payload.requestHeaders === 'object' && payload.requestHeaders != null
        ? (payload.requestHeaders as Record<string, string>)
        : {},
    responseHeaders:
      typeof payload.responseHeaders === 'object' && payload.responseHeaders != null
        ? (payload.responseHeaders as Record<string, string>)
        : undefined,
    requestBody: typeof payload.requestBody === 'string' ? payload.requestBody : undefined,
    responseBody:
      payload.responseBody === undefined || payload.responseBody === null ? undefined : `${payload.responseBody}`,
    error: payload.error === undefined || payload.error === null ? undefined : `${payload.error}`,
    timestamp:
      typeof payload.timestamp === 'number'
        ? payload.timestamp
        : typeof payload.startTime === 'number'
          ? payload.startTime
          : Date.now(),
    size: typeof payload.size === 'number' ? payload.size : undefined,
    contentType: typeof payload.contentType === 'string' ? payload.contentType : undefined,
    encoding: typeof payload.encoding === 'string' ? payload.encoding : undefined,
    networkProtocol: typeof payload.networkProtocol === 'string' ? payload.networkProtocol : undefined,
    library: typeof payload.library === 'string' ? payload.library : undefined,
    redirectCount: typeof payload.redirectCount === 'number' ? payload.redirectCount : undefined,
    redirectChain: Array.isArray(payload.redirectChain) ? (payload.redirectChain as string[]) : undefined,
    timing:
      payload.timing && typeof payload.timing === 'object'
        ? {
            dnsMs: asOptionalNumber((payload.timing as Record<string, unknown>).dnsMs),
            tlsMs: asOptionalNumber((payload.timing as Record<string, unknown>).tlsMs),
            connectMs: asOptionalNumber((payload.timing as Record<string, unknown>).connectMs),
            ttfbMs: asOptionalNumber((payload.timing as Record<string, unknown>).ttfbMs),
            downloadMs: asOptionalNumber((payload.timing as Record<string, unknown>).downloadMs),
          }
        : undefined,
    source: typeof payload.source === 'string' ? (payload.source as NetworkRequest['source']) : ('native' as const),
    mocked: payload.mocked === true ? true : undefined,
    requestBodySize: asOptionalNumber(payload.requestBodySize),
    responseBodySize: asOptionalNumber(payload.responseBodySize),
    dnsMs: asOptionalNumber(payload.dnsMs),
    tlsMs: asOptionalNumber(payload.tlsMs),
    connectMs: asOptionalNumber(payload.connectMs),
    ttfbMs: asOptionalNumber(payload.ttfbMs),
    downloadMs: asOptionalNumber(payload.downloadMs),
    graphql: parseGraphQL(payload.graphql),
  } satisfies NetworkRequest

  return request
}

export function parseRequestBatch(raw: unknown): NetworkRequest[] {
  if (!raw) return []
  const payload =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw)
          } catch {
            return []
          }
        })()
      : raw

  if (Array.isArray(payload)) {
    const requests: NetworkRequest[] = []
    for (const item of payload) {
      const request = parseNativeRequest(item)
      if (request) {
        requests.push(request)
      }
    }
    return requests
  }
  const single = parseNativeRequest(payload)
  return single ? [single] : []
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function asGraphqlOperationType(value: unknown): 'query' | 'mutation' | 'subscription' {
  if (value === 'mutation' || value === 'subscription' || value === 'query') {
    return value
  }
  return 'query'
}

function parseGraphQL(payload: unknown): NetworkRequest['graphql'] {
  if (!payload || typeof payload !== 'object') return undefined

  const details = payload as Record<string, unknown>
  return {
    operationType: asGraphqlOperationType(details.operationType),
    variables:
      typeof details.variables === 'object' && details.variables != null
        ? (details.variables as Record<string, unknown>)
        : undefined,
    operationName: typeof details.operationName === 'string' ? details.operationName : undefined,
  }
}

export function isPromiseLike(value: unknown): value is Promise<string> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<string>).then === 'function'
}

export function logMissingNative(method: string): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(
      `[Hakka] ${method} is not available because a TurboModule was not found. ` +
        `Expected one of: ${NATIVE_MODULE_NAMES.join(', ')}. ` +
        'If you are running on a New Architecture RN runtime, install and link hakka-react-native native modules.',
    )
  }
}
