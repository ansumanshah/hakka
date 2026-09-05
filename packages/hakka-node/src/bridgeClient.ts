/**
 * Node WebSocket client that streams captured records into the Hakka bridge hub
 * (`hakka-bridge`, ws://localhost:8989 — the same port the Hakka desktop app's
 * own embedded hub listens on, so this same client is what "desktop mode"
 * uses: `startCapture({ embedBridge: false })` skips hosting a hub in this
 * process and connects to whatever hub already owns that port). Uses the same
 * one-frame-per-request wire shape as the browser `desktopBridge`:
 * `{ type: 'request', payload }`. The hub relays each frame to every other
 * peer, so the browser overlay (also a peer) receives the server captures and
 * renders them alongside its own.
 *
 * Auto-reconnects with exponential backoff and queues records while offline so a
 * late-starting hub still receives the early server traffic.
 *
 * Also RECEIVES `{ type: 'control', payload }` frames from the hub — the same
 * mock/breakpoint/throttle commands the browser overlay and RN's
 * `HakkaBridge` already apply (see `hakka-browser`'s worker store and
 * `hakka-react-native`'s `HakkaBridge._handleMessage`) — and applies them via
 * `hakka-core`'s `parseControlCommand`/`applyControlCommand` against the
 * process-wide `mockEngine`/`breakpointEngine`/`ThrottleEngine` singletons
 * that `enableFetchInterceptor` already consults on every server-side
 * `fetch()`. This is what lets a mock rule created in the Hakka desktop app
 * mock a Next.js server-side `fetch` call, not just the browser's own calls.
 * Parsing is strict and fails open (a malformed frame is ignored, never
 * thrown) — matches every other control-command receiver in the codebase.
 */
import './wsCompat'
import {
  RuntimeControlReceiver,
  RUNTIME_CONTROL_CAPABILITIES,
  applyControlCommand,
  parseControlCommand,
} from 'hakka-core'
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
  /**
   * Apply `{ type: 'control' }` frames received from the hub (mock/
   * breakpoint/throttle commands) to this process's engine singletons.
   * Default `true` — matches the browser and React Native bridge clients,
   * which always honor control frames from a connected hub/MCP. Set `false`
   * to keep this client send-only (e.g. a test harness that wants to
   * observe outbound frames without also being remote-controlled).
   */
  handleControl?: boolean
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
// ws.send() never throws just because the peer accepts the TCP connection
// but reads slowly — frames pile up in ws's own internal send buffer
// (tracked by `ws.bufferedAmount`) instead. Without a check here, flush()
// would drain the bounded app-level `queue` straight into that unbounded
// buffer at full capture volume. Once bufferedAmount crosses this threshold,
// flush() stops draining and leaves the remainder in `queue`, where the
// existing MAX_QUEUE/maxQueueBytes caps keep bounding it.
const MAX_BUFFERED_AMOUNT = 1 * 1024 * 1024

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
  const handleControl = opts.handleControl !== false
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

  /**
   * Parse and apply an inbound `{ type: 'control', payload }` frame from the
   * hub. `parseControlCommand` is strict-and-null-safe (never throws), and
   * `applyControlCommand` is fail-open against the engine singletons — so a
   * malformed or unrecognised frame is silently ignored, same as every other
   * control-command receiver (`hakka-browser`'s worker store,
   * `hakka-react-native`'s `HakkaBridge`). Frames of any other `type` (a hub
   * echoing our own `request`/`span`/… sends back, or a future kind this
   * client doesn't know about) are ignored too — this client is not a
   * generic message router.
   */
  const handleMessage = (data: WebSocket.RawData): void => {
    try {
      const raw = typeof data === 'string' ? data : data.toString('utf-8')
      const msg = JSON.parse(raw) as { type?: unknown; payload?: unknown }
      if (msg?.type !== 'control') return
      const cmd = parseControlCommand(msg.payload)
      if (cmd) applyControlCommand(cmd)
    } catch {
      // Malformed frame — never let a hostile/buggy hub crash capture.
    }
  }

  const flush = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    while (queue.length > 0) {
      // A slow-but-connected peer never makes ws.send() throw — it just grows
      // ws's internal send buffer. Stop feeding it once backed up; the rest
      // stays in `queue`, bounded by MAX_QUEUE/maxQueueBytes, and drains on a
      // later flush() once the peer catches up.
      if (ws.bufferedAmount > MAX_BUFFERED_AMOUNT) break
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
    const control = new RuntimeControlReceiver(
      'server',
      handleControl ? RUNTIME_CONTROL_CAPABILITIES.filter((kind) => kind !== 'request.replay') : [],
      (command) => applyControlCommand(command).ok,
      (message) => {
        if (ws === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
      },
    )
    socket.on('open', () => {
      control.hello()
      connected = true
      retry = 250
      opts.onStatus?.(true)
      flush()
    })
    socket.on('close', () => {
      control.close()
      connected = false
      if (ws === socket) ws = null
      opts.onStatus?.(false)
      scheduleRetry()
    })
    // 'error' is followed by 'close'; reconnect is handled there.
    socket.on('error', () => {})
    socket.on('message', (data) => {
      try {
        if (control.receive(JSON.parse(typeof data === 'string' ? data : data.toString('utf-8')))) return
      } catch {
        return
      }
      if (handleControl) handleMessage(data)
    })
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
