/**
 * Node WebSocket client that streams captured records into the Hakka bridge hub
 * (`hakka-bridge`, ws://localhost:8989). Uses the same one-frame-per-request wire
 * shape as the browser `desktopBridge`: `{ type: 'request', payload }`. The hub
 * relays each frame to every other peer, so the browser overlay (also a peer)
 * receives the server captures and renders them alongside its own.
 *
 * Auto-reconnects with exponential backoff and queues records while offline so a
 * late-starting hub still receives the early server traffic.
 */
import './wsCompat'
import type { FrameworkSpan, LogEntry, NetworkRequest, StorageSnapshot } from 'hakka-core'
import WebSocket from 'ws'

export const DEFAULT_BRIDGE_URL = 'ws://localhost:8989'

export interface BridgeClientOptions {
  url?: string
  onStatus?: (connected: boolean) => void
  /**
   * Cap on the offline queue's cumulative serialised size (UTF-16 length of
   * the stored frames, used as a byte-count proxy), enforced in addition to
   * the MAX_QUEUE record-count cap. Bounds worst-case retained memory when a
   * hub never connects and payloads carry large bodies, independent of how
   * many records happen to be queued.
   */
  maxQueueBytes?: number
}

export interface BridgeClient {
  send(req: NetworkRequest): void
  /**
   * Wire shape matches hakka-bridge/protocol.ts's `BridgeSpanMessage`:
   * `{type:'span', payload}`. NOT buffered on reconnect (fire-and-forget) —
   * spans are a live stream; queuing for a hub that isn't up yet adds
   * complexity for a case that already loses the request's own span data at
   * the source.
   */
  sendSpan(span: FrameworkSpan): void
  /**
   * Wire shape matches `BridgeConsoleMessage`: `{type:'console', payload}`.
   * `payload` is always an array (even for one entry — see the protocol
   * doc), matching `console`'s "live stream, no offline queue" contract:
   * same rationale as `sendSpan` above, entries that couldn't be delivered
   * while disconnected are simply gone, not worth the complexity of
   * queuing.
   */
  sendConsole(entries: LogEntry[]): void
  /**
   * Wire shape matches `BridgeStorageMessage`: `{type:'storage', payload}`.
   * Same fire-and-forget, no-offline-queue contract as `sendSpan`/
   * `sendConsole` — a snapshot missed while disconnected is superseded by
   * the sender's next one anyway (snapshot-replace semantics), so queuing
   * a stale snapshot for later delivery would be actively wrong.
   */
  sendStorage(snapshot: StorageSnapshot): void
  close(): void
  readonly connected: boolean
}

const MAX_QUEUE = 1000
const DEFAULT_MAX_QUEUE_BYTES = 5 * 1024 * 1024

// Serialised once at enqueue time and kept only as its wire string — never
// the live NetworkRequest object — so the queue's footprint is exactly the
// bytes that will cross the socket, not whatever the request/response
// bodies happen to retain in memory.
interface QueuedFrame {
  frame: string
  bytes: number
}

export function createBridgeClient(opts: BridgeClientOptions = {}): BridgeClient {
  const url = opts.url ?? DEFAULT_BRIDGE_URL
  const maxQueueBytes = opts.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES
  let ws: WebSocket | null = null
  let connected = false
  let closed = false
  // Start the backoff low: an embedded hub comes up within tens of ms, so a
  // fast first retry means server captures appear almost immediately.
  let retry = 250
  let timer: ReturnType<typeof setTimeout> | null = null
  const queue: QueuedFrame[] = []
  let queueBytes = 0

  /**
   * Fire-and-forget send for the live-stream-only frame kinds (`span`,
   * `console`, `storage`): no offline queue, dropped silently if the socket
   * isn't open or serialisation fails. Shared by `sendSpan`/`sendConsole`/
   * `sendStorage` — they differ only in `type` and payload shape.
   */
  const sendLiveFrame = (type: 'span' | 'console' | 'storage', payload: unknown): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    let frame: string
    try {
      frame = JSON.stringify({ type, payload })
    } catch {
      // Circular/unserialisable payload shouldn't happen, but capture must
      // never throw back into the app's real request path — drop it.
      return
    }
    try {
      ws.send(frame)
    } catch {
      // Best-effort; a dead socket is handled by the reconnect logic above.
    }
  }

  const flush = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    while (queue.length > 0) {
      const entry = queue[0]
      if (!entry) break // queue.length > 0 guarantees this, but noUncheckedIndexedAccess needs the check
      try {
        ws.send(entry.frame)
        queue.shift()
        queueBytes -= entry.bytes
      } catch {
        break
      }
    }
  }

  const scheduleRetry = (): void => {
    if (closed || timer) return
    timer = setTimeout(() => {
      timer = null
      retry = Math.min(retry * 2, 30_000)
      open()
    }, retry)
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
      retry = 250
      opts.onStatus?.(true)
      flush()
    })
    socket.on('close', () => {
      connected = false
      if (ws === socket) ws = null
      opts.onStatus?.(false)
      scheduleRetry()
    })
    // 'error' is followed by 'close'; reconnect is handled there.
    socket.on('error', () => {})
  }

  open()

  return {
    get connected() {
      return connected
    },
    send(req: NetworkRequest) {
      let frame: string
      try {
        frame = JSON.stringify({ type: 'request', payload: req })
      } catch {
        // Circular/unserialisable payload shouldn't happen, but capture must
        // never throw back into the app's real request path — drop it.
        return
      }
      const entry: QueuedFrame = { frame, bytes: frame.length }
      queue.push(entry)
      queueBytes += entry.bytes
      // Deliver before evicting: if the socket is OPEN, flush() drains the
      // queue synchronously, so a record that fits in flight sends regardless
      // of the byte/count caps. Eviction below only sees what's still queued
      // after that attempt (genuinely offline, or backed up behind a
      // slower/closed socket).
      flush()
      // Evict oldest-first until both the count and byte caps hold — a
      // single oversized record can also exceed the byte cap on its own, in
      // which case it's evicted immediately rather than retained forever.
      while (queue.length > MAX_QUEUE || queueBytes > maxQueueBytes) {
        const dropped = queue.shift()
        if (!dropped) break
        queueBytes -= dropped.bytes
      }
    },
    sendSpan(span: FrameworkSpan) {
      sendLiveFrame('span', span)
    },
    sendConsole(entries: LogEntry[]) {
      sendLiveFrame('console', entries)
    },
    sendStorage(snapshot: StorageSnapshot) {
      sendLiveFrame('storage', snapshot)
    },
    close() {
      closed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      ws?.close()
      ws = null
    },
  }
}
