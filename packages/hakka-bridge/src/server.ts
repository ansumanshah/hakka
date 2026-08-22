import './wsCompat'
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import type { NetworkRequest } from 'hakka-core'
import { WebSocketServer, type WebSocket } from 'ws'

import { BridgeHub } from './BridgeHub'
import { startBridgeAdvertise, type BridgeAdvertisement, type BridgeAdvertiseOptions } from './discovery'

/** Default port — matches the hakka-browser `desktopBridge` client (ws://localhost:8989). */
export const DEFAULT_BRIDGE_PORT = 8989

/** Default bind address — loopback-only, so nothing off-box can reach the hub. */
export const DEFAULT_BRIDGE_HOST = '127.0.0.1'

/** Default largest accepted frame. See `BridgeServerOptions.maxPayload`. */
export const DEFAULT_MAX_PAYLOAD = 8 * 1024 * 1024

export interface BridgeServerOptions {
  /**
   * Interface to bind. Default `'127.0.0.1'` (loopback only). Pass
   * `'0.0.0.0'` (or a specific LAN address) for on-device debugging — do
   * this ONLY on a network you trust (see the module doc's trust model).
   */
  host?: string
  /** Port to listen on. Default 8989. Pass `0` for an ephemeral port (tests). */
  port?: number
  /** Max records retained in the hub buffer. */
  maxRecords?: number
  /**
   * Largest accepted frame, in bytes. Default 8 MB.
   *
   * `ws`'s own default is 100 MB, which the hub never exposed a way to lower —
   * so the buffer's `maxRecords` count bound was the only limit, and 1000
   * records of 100 MB is not a bound worth having. 8 MB matches the desktop
   * app's wire limit and is far above any real captured body.
   *
   * Enforced twice: through `ws` (which refuses before buffering, under Node)
   * and again on the received frame, because `ws` ignores `maxPayload` under
   * bun and delivers the oversized message regardless.
   */
  maxPayload?: number
  /** Max framework spans retained in the hub buffer, across all traces. See `BridgeHubOptions.maxSpans`. */
  maxSpans?: number
  /** Max framework spans retained per trace in the hub buffer. See `BridgeHubOptions.maxSpansPerTrace`. */
  maxSpansPerTrace?: number
  /**
   * Extra browser `Origin` values to accept beyond `localhost`/`127.0.0.1`/
   * `[::1]` (any port, http or https), e.g. a hosted dashboard origin. Exact
   * match against the `Origin` header, e.g. `'https://dash.example.com'`.
   */
  allowedOrigins?: string[]
  /**
   * Shared secret required as `?token=<value>` on the connection URL when
   * set. Unset (the default) means no token is required — origin checking
   * (see `allowedOrigins`) is the only gate. Compared in constant time.
   */
  token?: string
  /** Invoked for every received request, with the current connected-peer count. */
  onRecord?: (request: NetworkRequest, peerCount: number) => void
  /**
   * Advertise this hub on the LAN via mDNS/Bonjour (`_hakka._tcp.local`).
   * Default `true`. Only takes effect when `host` is non-loopback (a hub
   * bound to `127.0.0.1` is unreachable from other devices regardless of
   * mDNS) and the host has a non-loopback interface — see
   * `hasNonLoopbackInterface` in `discovery.ts`.
   */
  advertise?: boolean
  /** Instance name shown to LAN browsers. Default: the machine's hostname. */
  advertiseName?: string
  /** Override for tests; defaults to `startBridgeAdvertise` from `./discovery`. */
  createAdvertisement?: (options: BridgeAdvertiseOptions) => BridgeAdvertisement
}

export interface BridgeServer {
  /** The actually-bound port (resolved even when `0` was requested). */
  readonly port: number
  /** The buffer + fan-out hub backing this server. */
  readonly hub: BridgeHub
  /** True when this server is actively advertising itself via mDNS (see `advertise`). */
  readonly mdnsAdvertising: boolean
  /** Stop accepting connections, close all peers, and stop mDNS advertising. */
  close(): Promise<void>
}

/** Loopback hosts for which mDNS advertising is always skipped — see `advertise` above. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Start the Hakka desktop bridge server — the receiver for hakka-browser's
 * `desktopBridge` client. Clients connect over WebSocket and stream captured
 * requests; the server buffers them and relays each frame to every *other*
 * connected peer, so multiple viewers (or a desktop UI) can subscribe to a
 * single app's request stream. New peers receive a replay of the buffer.
 *
 * Trust model (buffer holds real request/response bodies — see
 * [Known limitations](/bridge/overview/#known-limitations)): three layers,
 * all active by default — (1) loopback-only bind, unreachable from other
 * devices regardless of the other two; (2) origin check, rejecting any
 * browser `Origin` outside localhost/127.0.0.1/[::1]/`allowedOrigins` (`ws`
 * otherwise accepts any origin); (3) optional shared `token`, defense in
 * depth when (1) is relaxed for LAN debugging. None of this defends against
 * a hostile LAN.
 */
export function startBridgeServer(options: BridgeServerOptions = {}): Promise<BridgeServer> {
  const requestedPort = options.port ?? DEFAULT_BRIDGE_PORT
  const requestedHost = options.host ?? DEFAULT_BRIDGE_HOST
  const allowedOrigins = options.allowedOrigins ?? []
  const token = options.token
  const maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD
  const hub = new BridgeHub({
    maxRecords: options.maxRecords,
    maxSpans: options.maxSpans,
    maxSpansPerTrace: options.maxSpansPerTrace,
  })
  const clients = new Set<WebSocket>()
  const wss = new WebSocketServer({
    port: requestedPort,
    host: requestedHost,
    maxPayload,
  })

  wss.on('connection', (socket, req) => {
    // Reject before anything else touches the socket: no buffer replay, no
    // message listener. Checked here rather than `ws`'s `verifyClient`
    // handshake hook so origin and token checks share one `req` and one
    // rejection path, closing with an accurate 1008 "policy violation".
    if (!isOriginAllowed(req.headers.origin, allowedOrigins)) {
      socket.close(1008, 'origin not allowed')
      return
    }
    if (token !== undefined && !isTokenValid(token, readToken(req))) {
      socket.close(1008, 'invalid or missing token')
      return
    }

    clients.add(socket)
    // Replay the buffer so a freshly-connected viewer sees existing requests.
    for (const request of hub.getRecords()) {
      safeSendFrame(socket, 'request', request)
    }
    // Replay buffered spans *after* requests (trace arrival order, see
    // BridgeHub.getSpans) — a client reconnecting after a hard reload needs
    // this, since document-load spans fire exactly then. Ordinary
    // `{ type: 'span', payload }` frames, so a dormant client's existing
    // envelope parsing needs no changes.
    for (const span of hub.getSpans()) {
      safeSendFrame(socket, 'span', span)
    }
    // Replay latest storage snapshots last — snapshot-replace semantics
    // (see `StorageSnapshot`), so order relative to requests/spans doesn't
    // matter, only that a freshly-connected viewer ends up with current
    // state rather than nothing until the device's next snapshot.
    for (const snapshot of hub.getStorageSnapshots()) {
      safeSendFrame(socket, 'storage', snapshot)
    }
    socket.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString()
      // Checked here as well as via `ws`'s own `maxPayload`, because that
      // option is silently ignored under bun — the socket delivers the whole
      // oversized frame anyway. A limit that only holds on one runtime is not
      // a limit, so the bound lives in code we control. `ws`'s option stays as
      // the cheaper first line under Node, where it refuses before buffering.
      if (raw.length > maxPayload) return
      const result = hub.ingest(raw)
      if (!result) return
      // Relay to OTHER peers (viewers/controllers); never echo back to the sender.
      for (const peer of clients) {
        if (peer !== socket) safeSend(peer, raw)
      }
      if (result.kind === 'request') {
        options.onRecord?.(result.request, clients.size)
      }
    })
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
  })

  return new Promise<BridgeServer>((resolve, reject) => {
    wss.on('error', reject)
    wss.on('listening', () => {
      const address = wss.address()
      const boundPort = typeof address === 'object' && address !== null ? address.port : requestedPort

      const wantsAdvertise = options.advertise ?? true
      const advertisable = wantsAdvertise && !LOOPBACK_HOSTS.has(requestedHost.toLowerCase())
      const createAdvertisement = options.createAdvertisement ?? startBridgeAdvertise
      const advertisement = createAdvertisement({
        port: boundPort,
        name: options.advertiseName,
        // Passed through so the mDNS record identity matches the bound
        // interface; safe to compute even when `!advertisable` since
        // `disabled: true` short-circuits before `host` is used.
        host: advertiseHostFor(requestedHost),
        disabled: !advertisable,
      })

      resolve({
        port: boundPort,
        hub,
        mdnsAdvertising: advertisement.active,
        close: async () => {
          for (const client of clients) {
            try {
              client.terminate()
            } catch {
              // already gone
            }
          }
          clients.clear()

          // Bound only the mDNS goodbye by a timeout — a hung or slow
          // `advertisement.close()` must never block `wss.close()` below.
          await withTimeout(advertisement.close(), 100)

          // wss.close() always runs regardless of how the mDNS goodbye settled,
          // with its own bounded safety net: some WebSocket runtimes (e.g. Bun's
          // `ws` shim) never invoke the close callback, so resolve anyway.
          await withTimeout(
            new Promise<void>((res) => {
              try {
                wss.close(() => res())
              } catch {
                res()
              }
            }),
            100,
          )
        },
      })
    })
  })
}

/** Resolves once `promise` settles or after `ms` elapses, whichever comes first — never rejects. */
function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    promise.then(done, done)
    setTimeout(done, ms)
  })
}

/**
 * Resolves the `host` to pass to `startBridgeAdvertise`. A non-loopback IP
 * passes through as-is so the mDNS record matches the bound interface.
 * `0.0.0.0` yields `undefined`, since `startBridgeAdvertise`'s default
 * (advertise every non-loopback interface) is already accurate there.
 */
export function advertiseHostFor(requestedHost: string): string | undefined {
  if (requestedHost === '0.0.0.0') return undefined
  return requestedHost
}

function safeSend(socket: WebSocket, data: string): void {
  if (socket.readyState !== socket.OPEN) return
  try {
    socket.send(data)
  } catch {
    // Best-effort relay; a dead peer is cleaned up by its close/error handler.
  }
}

/**
 * Serialize a replay frame, dropping it if it cannot be stringified.
 *
 * `safeSend(socket, JSON.stringify(...))` looks guarded but is not: the
 * argument is evaluated before `safeSend` is entered, so a throwing
 * `JSON.stringify` escapes the connection handler and kills the process while
 * serving an innocent peer. `parseBridgeMessage` now bounds nesting so nothing
 * un-serializable reaches the buffer; this is the second lock on the same door,
 * because the cost of being wrong here is the whole hub.
 */
function safeSendFrame(socket: WebSocket, type: string, payload: unknown): void {
  let frame: string
  try {
    frame = JSON.stringify({ type, payload })
  } catch {
    return
  }
  safeSend(socket, frame)
}

/** Matches `http(s)://localhost`, `127.0.0.1`, or `[::1]`, with any port or none. */
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

/**
 * `Origin` is browser-enforced: non-browser peers (hakka-node's bridge
 * client, a plain `ws` script) never send it, so its absence isn't
 * suspicious and must stay allowed. What this closes off is a *browser tab*
 * on an arbitrary page opening a cross-origin WebSocket to this port.
 */
function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!origin) return true
  if (LOOPBACK_ORIGIN_RE.test(origin)) return true
  return allowedOrigins.includes(origin)
}

/** Reads `?token=` off the connection URL. `request.url` is path+query only (no origin). */
function readToken(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? '/', 'http://bridge.invalid')
  return url.searchParams.get('token')
}

/**
 * Constant-time token compare. A length mismatch is rejected outright (as
 * instructed) rather than padded, since `timingSafeEqual` throws on
 * differing-length buffers; the length check itself leaks only the *length*
 * of the secret, not its content, which is an acceptable trade-off for a
 * local dev tool.
 */
function isTokenValid(expected: string, provided: string | null): boolean {
  if (provided === null) return false
  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(provided)
  if (expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}
