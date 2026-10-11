import {
  RECORD_SCHEMA_VERSION,
  type ContractRecord,
  type FrameworkSpan,
  type LogEntry,
  type NetworkRequest,
  type StorageSnapshot,
} from 'hakka-core'

export type PerformanceRecord = Extract<ContractRecord, { kind: `metric.${string}` }>

/** Diagnostics are bounded independently of the larger network/body frame budget. */
export const MAX_DIAGNOSTIC_FRAME_BYTES = 256 * 1024
export const MAX_DIAGNOSTIC_RECORD_BYTES = 8192
export const MAX_DIAGNOSTIC_BATCH = 100

export interface BridgePerformanceMessage {
  type: 'performance'
  payload: PerformanceRecord[]
}

/** Validate existing v1 metrics without rewriting records relayed on the wire. */
export function isPerformanceRecord(value: unknown): value is PerformanceRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    !record.id ||
    record.id.length > 512 ||
    record.schemaVersion !== RECORD_SCHEMA_VERSION
  )
    return false
  const validNumber = (key: string, required = false, integral = false): boolean => {
    const number = record[key]
    if (number === undefined) return !required
    return (
      typeof number === 'number' &&
      Number.isFinite(number) &&
      number >= 0 &&
      (!integral || Number.isSafeInteger(number))
    )
  }
  if (!validNumber('timestamp', true)) return false
  switch (record.kind) {
    case 'metric.frame':
      return (
        validNumber('durationMs', true) &&
        validNumber('refreshRateHz') &&
        typeof record.slow === 'boolean' &&
        typeof record.frozen === 'boolean'
      )
    case 'metric.memory':
      return ['pssBytes', 'heapUsedBytes', 'heapMaxBytes'].every((key) => validNumber(key, false, true))
    case 'metric.cpu':
      return validNumber('processCpuPercent')
    case 'metric.network_usage':
      return ['rxBytes', 'txBytes'].every((key) => validNumber(key, false, true))
    case 'metric.js_thread':
      return validNumber('eventLoopDelayMs', true)
    default:
      return false
  }
}

/**
 * Wire protocol for the Hakka desktop bridge.
 *
 * The `hakka-browser` `desktopBridge` client sends one JSON text frame per captured
 * request: `{ type: 'request', payload: NetworkRequest }`. It never expects a
 * reply. Any peer may also send a `{ type: 'control', payload }` frame (e.g. an
 * MCP server driving mock/breakpoint/throttle engines) — the hub only routes
 * these, it does not validate `payload`'s inner shape; that is the receiving
 * peer's job via `hakka-core`'s `parseControlCommand`. A peer may also send a
 * `{ type: 'span', payload: FrameworkSpan }` frame (Next.js/OTel request-tree
 * spans) — relayed like `control` (never buffered, never counted as a
 * record). Two more kinds mirror `span`'s "additive record, never mixed into
 * `NetworkRequest[]`" shape: `{ type: 'console', payload: LogEntry[] }` (one
 * or a small batch of structured log entries, reusing each SDK's existing
 * `LogEntry`/`LogStore` model) and `{ type: 'storage', payload:
 * StorageSnapshot }` (a named device-storage snapshot — UserDefaults,
 * redacted keychain, cookies — with snapshot-replace semantics, never a
 * diff). This module is the shared, transport-agnostic contract.
 */

/** A single captured request streamed from a client. */
export interface BridgeRequestMessage {
  type: 'request'
  payload: NetworkRequest
}

/** A single framework span (Next.js/OTel request tree) streamed from a client. Relay-only — never buffered. */
export interface BridgeSpanMessage {
  type: 'span'
  payload: FrameworkSpan
}

/**
 * One or a small batch of structured log entries streamed from a client.
 * Always an array (even for a single entry) so a client can coalesce a
 * burst of `console.*`/`HakkaInterceptor.log(...)` calls into one frame
 * without a separate "batch" wire shape.
 */
export interface BridgeConsoleMessage {
  type: 'console'
  payload: LogEntry[]
}

/** A named device-storage snapshot streamed from a client. Snapshot-replace, never a diff — see `StorageSnapshot`. */
export interface BridgeStorageMessage {
  type: 'storage'
  payload: StorageSnapshot
}

/** An opaque control frame relayed to other peers. Payload validated by the receiver, not the hub. */
export interface BridgeControlMessage {
  type: 'control'
  payload: unknown
}

export type BridgeMessage =
  | BridgeRequestMessage
  | BridgeSpanMessage
  | BridgeConsoleMessage
  | BridgePerformanceMessage
  | BridgeStorageMessage
  | BridgeControlMessage

/**
 * Parse a raw WebSocket text frame into a typed bridge message. Returns `null`
 * for malformed JSON or unrecognised shapes — the server must never throw on
 * hostile or partial input.
 */
/**
 * Nesting past this is refused at the door.
 *
 * `JSON.parse` is iterative and happily accepts tens of thousands of levels;
 * `JSON.stringify` is recursive and throws `RangeError` well before that. A
 * frame that parses but cannot be re-serialized is a landmine: it sits in the
 * replay buffer until the next peer connects, and then takes the hub process
 * down while serving them. Bounding depth here means the buffer only ever
 * holds records the hub can actually send.
 */
const MAX_FRAME_DEPTH = 200

/** Depth of the deepest array/object nesting in `raw`, ignoring string contents. */
function exceedsFrameDepth(raw: string): boolean {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') {
      depth += 1
      if (depth > MAX_FRAME_DEPTH) return true
    } else if (ch === '}' || ch === ']') depth -= 1
  }
  return false
}

export function parseBridgeMessage(raw: string): BridgeMessage | null {
  if (exceedsFrameDepth(raw)) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (obj === null || typeof obj !== 'object') return null
  const type = (obj as { type?: unknown }).type
  const payload = (obj as { payload?: unknown }).payload

  if (type === 'request' && typeof payload === 'object' && payload !== null) {
    return obj as BridgeRequestMessage
  }
  if (type === 'span' && typeof payload === 'object' && payload !== null) {
    return obj as BridgeSpanMessage
  }
  // `console`'s payload is always an array (see `BridgeConsoleMessage`'s doc
  // comment) — checked shallowly here, same "object/array-shaped, not fully
  // validated" terms as every other kind; per-entry shape is the receiver's
  // job, matching how `request`/`span` payloads are never deep-validated
  // either.
  if (type === 'console' && Array.isArray(payload)) {
    return obj as BridgeConsoleMessage
  }
  if (type === 'performance' && Array.isArray(payload)) {
    if (new TextEncoder().encode(raw).byteLength > MAX_DIAGNOSTIC_FRAME_BYTES || payload.length > MAX_DIAGNOSTIC_BATCH)
      return null
    if (
      !payload.every(
        (record) =>
          isPerformanceRecord(record) &&
          new TextEncoder().encode(JSON.stringify(record)).byteLength <= MAX_DIAGNOSTIC_RECORD_BYTES,
      )
    )
      return null
    return obj as BridgePerformanceMessage
  }
  if (type === 'storage' && typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return obj as BridgeStorageMessage
  }
  if (type === 'control' && typeof payload === 'object' && payload !== null) {
    return obj as BridgeControlMessage
  }
  return null
}
