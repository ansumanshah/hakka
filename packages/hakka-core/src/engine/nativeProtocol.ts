import type { LogEntry, LogLevel } from '../log/types'
import type { NetworkRequest, StorageSnapshot } from '../model/types'

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
/**
 * Native structured-log entries (`Hakka.log`/`HakkaTimberTree` on Android) relayed one
 * `LogEntry` at a time — mirrors `NATIVE_REQUEST_EVENT`'s per-record granularity. See
 * `HakkaUI.subscribeStructuredLogs` (Android `hakka-ui`) for the emit side.
 */
export const NATIVE_CONSOLE_EVENT = 'onHakkaConsole'
/**
 * Native device-storage snapshots (SharedPreferences on Android), one `StorageSnapshot` per
 * event. Only fired on-demand, in response to `NativeHakkaModule.publishStorageSnapshots()` —
 * there is no live push (matches the JS bridge's own AsyncStorage/MMKV publish, which is also
 * connect-time-only, not a live subscription).
 */
export const NATIVE_STORAGE_EVENT = 'onHakkaStorage'

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
  /** Synchronous probe for the linked native inspector. */
  isUIAvailable?: () => boolean
  /** Legacy void results are accepted at the bridge boundary but never treated as successful presentation. */
  showUI: (mode: string) => Promise<boolean> | boolean | void
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
  /** Requests a fresh `NATIVE_STORAGE_EVENT` snapshot of native device storage. Optional — absent on older native binaries. */
  publishStorageSnapshots?: () => void
}

export interface NativeEventEmitterLike {
  addListener(event: string, cb: (payload: unknown) => void): { remove(): void }
}

export interface NativeCaptureAdapter {
  /** Restrict this platform to native capture, including its default mode. */
  captureMode?: 'native'
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

function parseJsonMaybe(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseNativeLogEntry(raw: unknown): LogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as Record<string, unknown>

  const id = typeof payload.id === 'string' ? payload.id : ''
  const message = typeof payload.message === 'string' ? payload.message : ''
  if (!id || !message) return null

  const level: LogLevel =
    payload.level === 'debug' || payload.level === 'warn' || payload.level === 'error' ? payload.level : 'info'

  return {
    id,
    timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
    level,
    message,
    category: typeof payload.category === 'string' ? payload.category : undefined,
    metadata:
      payload.metadata && typeof payload.metadata === 'object'
        ? (payload.metadata as Record<string, unknown>)
        : undefined,
  }
}

/** Parses an `onHakkaConsole` payload — one `LogEntry` per native emit call, wrapped in an array. */
export function parseConsoleBatch(raw: unknown): LogEntry[] {
  if (!raw) return []
  const payload = parseJsonMaybe(raw)

  if (Array.isArray(payload)) {
    const entries: LogEntry[] = []
    for (const item of payload) {
      const entry = parseNativeLogEntry(item)
      if (entry) entries.push(entry)
    }
    return entries
  }
  const single = parseNativeLogEntry(payload)
  return single ? [single] : []
}

/** Parses an `onHakkaStorage` payload — a single `StorageSnapshot` (native emits one snapshot per event, wrapped in an array of one). */
export function parseStorageSnapshot(raw: unknown): StorageSnapshot | null {
  if (!raw) return null
  const payload = parseJsonMaybe(raw)
  const source = Array.isArray(payload) ? payload[0] : payload
  if (!source || typeof source !== 'object') return null

  const record = source as Record<string, unknown>
  const store = typeof record.store === 'string' ? record.store : ''
  if (!store) return null

  const entries: Record<string, string> = {}
  if (record.entries && typeof record.entries === 'object') {
    for (const [key, value] of Object.entries(record.entries as Record<string, unknown>)) {
      entries[key] = typeof value === 'string' ? value : String(value)
    }
  }

  return {
    store,
    timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
    entries,
  }
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
