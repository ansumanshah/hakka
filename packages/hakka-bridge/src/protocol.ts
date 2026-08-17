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
export function parseBridgeMessage(raw: string): BridgeMessage | null {
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
