/**
 * Node WebSocket client streaming captured records to the Hakka bridge hub
 * (`hakka-bridge`, ws://localhost:8989) using the shared one-frame-per-request
 * wire shape `{ type: 'request', payload }` also used by `hakka-node` and the
 * browser `desktopBridge`; the hub relays each frame to every other peer, so
 * the browser overlay renders CDP captures alongside its own. Per-package
 * copy of `hakka-node`'s `bridgeClient.ts` (repo convention), keeping
 * `hakka-cdp` usable with no `hakka-node` dependency.
 */
import './wsCompat'
import type { NetworkRequest } from 'hakka-core'
import WebSocket from 'ws'

export const DEFAULT_BRIDGE_URL = 'ws://localhost:8989'

export interface CdpBridgeClientOptions {
  url?: string
  onStatus?: (connected: boolean) => void
  /** Cap on the offline queue's cumulative serialised size (UTF-16 length of the stored frames), enforced alongside the record-count cap. */
  maxQueueBytes?: number
}

export interface CdpBridgeClient {
  send(req: NetworkRequest): void
  close(): void
  readonly connected: boolean
}

const MAX_QUEUE = 1000
const DEFAULT_MAX_QUEUE_BYTES = 5 * 1024 * 1024

interface QueuedFrame {
  frame: string
  bytes: number
}

export function createCdpBridgeClient(opts: CdpBridgeClientOptions = {}): CdpBridgeClient {
  const url = opts.url ?? DEFAULT_BRIDGE_URL
  const maxQueueBytes = opts.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES
  let ws: WebSocket | null = null
  let connected = false
  let closed = false
  let retry = 250
  let timer: ReturnType<typeof setTimeout> | null = null
  const queue: QueuedFrame[] = []
  let queueBytes = 0

  const flush = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    while (queue.length > 0) {
      const entry = queue[0]
      if (!entry) break
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
        return
      }
      const entry: QueuedFrame = { frame, bytes: frame.length }
      queue.push(entry)
      queueBytes += entry.bytes
      flush()
      while (queue.length > MAX_QUEUE || queueBytes > maxQueueBytes) {
        const dropped = queue.shift()
        if (!dropped) break
        queueBytes -= dropped.bytes
      }
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

/** Connects to a Hakka bridge hub; `.send` fits directly as `onRequest` for `createCdpCapture`. */
export function bridge(url: string = DEFAULT_BRIDGE_URL): CdpBridgeClient {
  return createCdpBridgeClient({ url })
}
