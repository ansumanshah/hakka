import type { FrameworkSpan, NetworkRequest } from 'hakka-core'

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
 * record). This module is the shared, transport-agnostic contract.
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

/** An opaque control frame relayed to other peers. Payload validated by the receiver, not the hub. */
export interface BridgeControlMessage {
  type: 'control'
  payload: unknown
}

export type BridgeMessage = BridgeRequestMessage | BridgeSpanMessage | BridgeControlMessage

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
  if (type === 'control' && typeof payload === 'object' && payload !== null) {
    return obj as BridgeControlMessage
  }
  return null
}
