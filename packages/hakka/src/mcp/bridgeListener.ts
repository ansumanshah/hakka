/**
 * WebSocket client that reads request frames from the Hakka bridge hub into
 * the RequestStore. `sendControl()` pushes control frames to the hub; echo-loop
 * safety holds because the hub never relays a frame back to its sender and
 * `parseBridgeFrame` ignores `'control'` frames. Reconnects: 250ms → 30s backoff.
 */

import { parseBridgeMessage } from 'hakka-bridge'
import type { ControlCommand, FrameworkSpan, NetworkRequest } from 'hakka-core'
import WebSocket from 'ws'

import type { RequestStore } from './RequestStore.js'
import type { SpanStore } from './SpanStore.js'

export const DEFAULT_BRIDGE_URL = 'ws://localhost:8989'

export interface BridgeListener {
  close(): void
  readonly connected: boolean
  /** Sends `{ type: 'control', payload: cmd }` to the hub; fire-and-forget, no ack. Returns `false` (never throws) when not connected. */
  sendControl(cmd: ControlCommand): boolean
}

/** Parses a `{ type: 'request', payload }` frame; returns null for anything else (never throws). `'control'` frames are ignored by design — they must never enter the store. */
export function parseBridgeFrame(raw: string): NetworkRequest | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (
    obj !== null &&
    typeof obj === 'object' &&
    (obj as { type?: unknown }).type === 'request' &&
    typeof (obj as { payload?: unknown }).payload === 'object' &&
    (obj as { payload?: unknown }).payload !== null
  ) {
    const payload = (obj as { payload: unknown }).payload as Record<string, unknown>
    // Minimal shape-check: id and url are required
    if (typeof payload.id === 'string' && typeof payload.url === 'string') {
      return payload as unknown as NetworkRequest
    }
  }
  return null
}

/** Parses a `{ type: 'span', payload }` frame via `parseBridgeMessage`; returns null for anything else (never throws). */
export function parseBridgeSpanFrame(raw: string): FrameworkSpan | null {
  const msg = parseBridgeMessage(raw)
  if (!msg || msg.type !== 'span') return null
  return msg.payload
}

export function createBridgeListener(
  store: RequestStore,
  url = DEFAULT_BRIDGE_URL,
  spanStore?: SpanStore,
): BridgeListener {
  let ws: WebSocket | null = null
  let connected = false
  let closed = false
  let retryMs = 250
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleRetry = (): void => {
    if (closed || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      retryMs = Math.min(retryMs * 2, 30_000)
      open()
    }, retryMs)
  }

  const open = (): void => {
    if (closed) return
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      scheduleRetry()
      return
    }
    ws = socket

    socket.on('open', () => {
      connected = true
      retryMs = 250
      process.stderr.write(`[hakka] connected to bridge at ${url}\n`)
    })

    socket.on('message', (data) => {
      let raw: string
      if (typeof data === 'string') {
        raw = data
      } else if (Buffer.isBuffer(data)) {
        raw = data.toString('utf8')
      } else {
        return
      }
      const req = parseBridgeFrame(raw)
      if (req) {
        store.add(req)
        return
      }
      if (spanStore) {
        const span = parseBridgeSpanFrame(raw)
        if (span) spanStore.add(span)
      }
    })

    socket.on('close', () => {
      connected = false
      if (ws === socket) ws = null
      if (!closed) {
        process.stderr.write(`[hakka] bridge disconnected — retrying in ${retryMs}ms\n`)
        scheduleRetry()
      }
    })

    // 'error' is always followed by 'close' — reconnect is handled there.
    socket.on('error', () => {})
  }

  open()

  return {
    get connected() {
      return connected
    },
    close() {
      closed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      ws?.close()
      ws = null
    },
    sendControl(cmd: ControlCommand): boolean {
      if (!connected || ws === null || ws.readyState !== ws.OPEN) return false
      try {
        ws.send(JSON.stringify({ type: 'control', payload: cmd }))
        return true
      } catch {
        return false
      }
    },
  }
}
