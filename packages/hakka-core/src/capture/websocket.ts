import type { CaptureSource, CaptureSourceContext } from '../contract/captureSource'
import { createCycleGuard } from '../contract/cycleGuard'
import type { RequestListener, WsMessage } from '../model/types'
import { isOwnBridgeUrl } from './bridgeHosts'

/** Max WebSocket messages to capture per connection to prevent memory issues. */
const MAX_WS_MESSAGES = 100

/** Debounce interval for WS message emission (ms). Prevents flooding onRequest on chatty sockets. */
const WS_DEBOUNCE_MS = 250

/** Max bytes of a binary frame to base64-encode for inspection; larger frames keep size only. */
const MAX_WS_BINARY_BYTES = 32_768

let OriginalWebSocket: typeof WebSocket | null = null
let counter = 0
type HakkaWebSocketMessageEvent = { data?: unknown }
type HakkaWebSocketSendData = Parameters<WebSocket['send']>[0]

function byteLengthOf(value: unknown): number {
  return value && typeof value === 'object' && 'byteLength' in value && typeof value.byteLength === 'number'
    ? value.byteLength
    : 0
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Base64-encode bytes with no `btoa`/`Buffer` dependency (core is shared with RN). Builds a
 * chunk per 3-byte group and joins once, instead of repeated `+=` — up to ~11k iterations for
 * the largest capturable frame, and string concat isn't guaranteed O(1)-amortized on every JS
 * engine this runs on (Hermes included).
 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    chunks.push(
      B64[b0 >> 2] +
        B64[((b0 & 3) << 4) | (b1 >> 4)] +
        (i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=') +
        (i + 2 < bytes.length ? B64[b2 & 63] : '='),
    )
  }
  return chunks.join('')
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  return null
}

function isBlob(data: unknown): data is Blob {
  return typeof Blob !== 'undefined' && data instanceof Blob
}

/** Normalize a WS frame to a capturable shape — text as string, binary as base64 within the cap else byte count; Blob is sized synchronously and base64-filled async by the caller. */
function encodeFrame(data: unknown): { data: string | number; size: number; binary: boolean } {
  if (typeof data === 'string') return { data, size: data.length, binary: false }
  const bytes = toBytes(data)
  if (bytes) {
    const size = bytes.byteLength
    return { data: size <= MAX_WS_BINARY_BYTES ? bytesToBase64(bytes) : size, size, binary: true }
  }
  if (isBlob(data)) return { data: data.size, size: data.size, binary: true }
  const size = byteLengthOf(data)
  return { data: size, size, binary: true }
}

export function enableWebSocketInterceptor(onRequest: RequestListener): () => void {
  if (OriginalWebSocket) return () => disableWebSocketInterceptor()

  OriginalWebSocket = globalThis.WebSocket
  const SavedWS = OriginalWebSocket

  const PatchedWebSocket = class extends SavedWS {
    private _hakkaMessages: WsMessage[] = []
    private _hakkaSkip = false

    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = url instanceof URL ? url.toString() : url
      super(urlStr, protocols)

      // Skip Hakka's own bridge connections to avoid self-capture noise
      if (isOwnBridgeUrl(urlStr)) {
        this._hakkaSkip = true
        return
      }

      const startTime = Date.now()
      const id = `ws_${++counter}_${startTime}`
      const messages = this._hakkaMessages

      // Negotiated sub-protocol — empty until 'open' fires; held in a mutable cell so all emits share the same reference.
      let wsProtocol = ''

      const base = {
        id,
        url: urlStr,
        method: 'GET' as const,
        requestHeaders: {},
        responseHeaders: {},
        requestBodySize: 0,
        responseBodySize: 0,
        requestBody: null,
        responseBody: null,
        source: 'websocket' as const,
      }

      // Debounced emitter — batches rapid WS messages into a single onRequest call.
      // Fires immediately on first message, then coalesces for WS_DEBOUNCE_MS.
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      let pendingEmit = false

      const emitUpdate = () => {
        pendingEmit = false
        debounceTimer = null
        try {
          onRequest({
            ...base,
            status: 101,
            startTime,
            duration: Date.now() - startTime,
            error: null,
            messages,
            wsProtocol,
          })
        } catch {
          /* never break the real connection */
        }
      }

      const scheduleEmit = () => {
        if (debounceTimer) {
          // Already scheduled — just mark pending so the timer picks it up
          pendingEmit = true
          return
        }
        // Fire immediately on first message in a burst
        emitUpdate()
        // Only schedule a follow-up timer if messages arrived synchronously during emitUpdate()
        // (a re-entrant scheduleEmit call sets pendingEmit).
        if (pendingEmit) {
          debounceTimer = setTimeout(() => {
            if (pendingEmit) {
              emitUpdate()
            } else {
              debounceTimer = null
            }
          }, WS_DEBOUNCE_MS)
        }
      }

      this.addEventListener('open', () => {
        // this.protocol is the server-confirmed sub-protocol, '' if none.
        wsProtocol = this.protocol ?? ''
        onRequest({
          ...base,
          status: 101,
          startTime,
          duration: Date.now() - startTime,
          error: null,
          messages,
          wsProtocol,
        })
      })

      const handleMessage = (event: HakkaWebSocketMessageEvent) => {
        if (messages.length >= MAX_WS_MESSAGES) return
        const frame: WsMessage = { timestamp: Date.now(), direction: 'received', ...encodeFrame(event.data) }
        messages.push(frame)
        scheduleEmit()
        // Blob frames are sized synchronously; fill the base64 payload once read.
        if (frame.binary && isBlob(event.data) && frame.size <= MAX_WS_BINARY_BYTES) {
          void event.data
            .arrayBuffer()
            .then((buf) => {
              frame.data = bytesToBase64(new Uint8Array(buf))
              scheduleEmit()
            })
            .catch(() => {})
        }
      }
      this.addEventListener('message', handleMessage as never)

      this.addEventListener('error', () => {
        // Errors always emit immediately (not debounced)
        if (debounceTimer) {
          clearTimeout(debounceTimer)
          debounceTimer = null
        }
        onRequest({
          ...base,
          status: null,
          startTime,
          duration: Date.now() - startTime,
          error: 'WebSocket error',
          messages,
          wsProtocol,
        })
      })

      this.addEventListener('close', (ev: CloseEvent) => {
        // Close always emits immediately with final state
        if (debounceTimer) {
          clearTimeout(debounceTimer)
          debounceTimer = null
        }
        onRequest({
          ...base,
          status: ev.code,
          startTime,
          duration: Date.now() - startTime,
          error: ev.wasClean ? null : `WebSocket closed uncleanly (code ${ev.code})`,
          messages,
          wsProtocol,
        })
      })

      const originalSend = this.send.bind(this)
      this.send = (data: HakkaWebSocketSendData) => {
        if (!this._hakkaSkip && messages.length < MAX_WS_MESSAGES) {
          const frame: WsMessage = { timestamp: Date.now(), direction: 'sent', ...encodeFrame(data) }
          messages.push(frame)
          scheduleEmit()
          if (frame.binary && isBlob(data) && frame.size <= MAX_WS_BINARY_BYTES) {
            void data
              .arrayBuffer()
              .then((buf) => {
                frame.data = bytesToBase64(new Uint8Array(buf))
                scheduleEmit()
              })
              .catch(() => {})
          }
        }
        originalSend(data)
      }
    }
  }

  Object.defineProperty(PatchedWebSocket, 'CONNECTING', { value: SavedWS.CONNECTING })
  Object.defineProperty(PatchedWebSocket, 'OPEN', { value: SavedWS.OPEN })
  Object.defineProperty(PatchedWebSocket, 'CLOSING', { value: SavedWS.CLOSING })
  Object.defineProperty(PatchedWebSocket, 'CLOSED', { value: SavedWS.CLOSED })

  globalThis.WebSocket = PatchedWebSocket as unknown as typeof WebSocket

  return () => disableWebSocketInterceptor()
}

function disableWebSocketInterceptor(): void {
  if (OriginalWebSocket) {
    globalThis.WebSocket = OriginalWebSocket
    OriginalWebSocket = null
  }
}

/**
 * `CaptureSource` (ADR 0006) wrapper around `enableWebSocketInterceptor()`. `runtime` is a
 * fixed `'client'` literal — `enableWebSocketInterceptor` patches the global `WebSocket`
 * constructor, a browser-only global with no server/edge variant.
 *
 * Patching the global only gates NEW `new WebSocket()` calls, not already-open connections —
 * a message (or a debounced/async Blob-arrayBuffer resolve) can still fire after `stop()`
 * from a connection's own closure. The local `stopped` flag below is what actually blocks
 * delivery to `ctx.ingest` after stop, mirroring spanProcessor.ts's `state.stopped` check.
 */
export function createWebSocketCaptureSource(): CaptureSource {
  let disposer: (() => void) | null = null
  const cycle = createCycleGuard()

  return {
    id: 'hakka.websocket',
    runtime: 'client',
    transport: 'websocket',
    correlation: 'none',
    start(ctx: CaptureSourceContext) {
      if (disposer) return // already started — idempotent per the CaptureSource contract
      const isCurrent = cycle.begin()
      disposer = enableWebSocketInterceptor((request) => {
        // A message (or async re-emit) that resolves after stop() must not reach ctx.ingest —
        // and must not reach a LATER cycle's ctx either, hence the cycle guard over a boolean.
        if (!isCurrent()) return
        ctx.ingest(request)
      })
    },
    stop() {
      if (!disposer) return // never started, or already stopped — idempotent per the contract
      cycle.end()
      disposer()
      disposer = null
    },
  }
}
