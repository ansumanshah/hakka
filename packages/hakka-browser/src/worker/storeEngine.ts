/**
 * storeEngine — the capture store + all heavy post-capture work, hosted off
 * the UI thread.
 *
 * Runs inside the store Worker (see store.worker.ts) and is reused verbatim
 * as the in-process fallback when Workers are unavailable. Drives the shared
 * `hakka-core` engine in `mode: 'store'` so dedup, retention, the ring
 * buffer, and dispatch stay byte-for-byte identical to every other Hakka
 * target. The desktop bridge socket lives here too, keeping its per-request
 * `JSON.stringify` off the main thread. Each importing thread gets its own
 * `Hakka` singleton — one store per thread, by design.
 */
import {
  Hakka,
  RuntimeControlReceiver,
  RUNTIME_CONTROL_CAPABILITIES,
  compileQuery,
  exportHarString,
  exportPostmanString,
  networkRequestToRecord,
  recordsToOtelJson,
  type AdvancedQuery,
  type ConnectionStatus,
  type FrameworkSpan,
  type NetworkRequest,
} from 'hakka-core'

import { filterRequests } from './filter'
import { stripBodies, type BodyPair, type OtelOptions, type StoreConfig, type StoreQuery } from './protocol'

const DEFAULT_DESKTOP_URL = 'ws://localhost:8989'

type RequestSink = (req: NetworkRequest) => void
type BridgeSink = (status: ConnectionStatus) => void
type ControlSink = (payload: unknown, applied?: (ok: boolean) => void) => void
type SpanSink = (span: FrameworkSpan) => void

let started = false
let onRequest: RequestSink = () => {}
let onBridgeStatus: BridgeSink = () => {}
let onControl: ControlSink = () => {}
let onSpan: SpanSink = () => {}
let engineUnsub: (() => void) | null = null

// ── framework spans (Next.js/OTel request tree, relayed over the bridge) ────
// Bounded per-trace AND across traces: a partial trace is useless for the
// waterfall, so overflow evicts the whole oldest trace (insertion order),
// never trims an individual trace down to a ragged remainder.
const spansByTrace = new Map<string, FrameworkSpan[]>()
const SPAN_TRACE_MAX = 200
const SPAN_PER_TRACE_MAX = 500

function ingestSpan(span: FrameworkSpan): void {
  let bucket = spansByTrace.get(span.traceId)
  if (!bucket) {
    if (spansByTrace.size >= SPAN_TRACE_MAX) {
      const oldestKey = spansByTrace.keys().next().value
      if (oldestKey !== undefined) spansByTrace.delete(oldestKey)
    }
    bucket = []
    spansByTrace.set(span.traceId, bucket)
  }
  if (bucket.length >= SPAN_PER_TRACE_MAX) bucket.shift()
  bucket.push(span)
  onSpan(span)
}
// See StoreConfig.slimEcho — governs only the UI's live-echo subscription
// below. bridgeConnect()'s own `Hakka.onRequest` subscription further down
// deliberately ignores this flag: the desktop bridge always gets full bodies.
let slimEchoEnabled = true

function mapConfig(config?: StoreConfig): StoreConfig {
  const out: StoreConfig = {}
  if (config?.maxRequests != null) out.maxRequests = config.maxRequests
  if (config?.maxAge != null) out.maxAge = config.maxAge
  if (config?.ignoreHosts != null) out.ignoreHosts = config.ignoreHosts
  if (config?.ignorePatterns != null) out.ignorePatterns = config.ignorePatterns
  return out
}

// ── desktop bridge (lives on the store thread) ───────────────────────────────

let ws: WebSocket | null = null
let bridgeUrl = DEFAULT_DESKTOP_URL
let bridgeUnsub: (() => void) | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = 1000
let intentionalClose = false

// Above this many buffered bytes, a slow desktop consumer isn't draining the
// socket fast enough — drop the frame rather than grow an unbounded queue.
// The hub keeps its own replay buffer and re-sends the backlog on reconnect
// (see the `onopen` replay below), so a drop here is recoverable.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024 // 4MB

// Ids currently being applied via a bridge-relayed 'request' frame.
// `Hakka.ingest` dispatches to listeners synchronously, so bracketing the id
// immediately before/after `Hakka.ingest()` reliably covers every listener
// call it triggers, including our own bridge-send listener below — without
// this, frames relayed from another peer would echo straight back to the hub.
const ingestingFromBridge = new Set<string>()
// Ids that EVER arrived via the bridge (persistent, unlike the transient
// bracket above): the reconnect replay must not send these back — echoing
// the whole store on every reconnect was reseeding fresh hubs with stale
// entries forever. Bounded: on overflow the set clears (the hub dedups by id).
const bridgeOriginIds = new Set<string>()
const BRIDGE_ORIGIN_IDS_MAX = 5000

function emitBridge(status: ConnectionStatus): void {
  onBridgeStatus(status)
}

function clearRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function sendOverBridge(socket: WebSocket, req: NetworkRequest): void {
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return
  try {
    socket.send(JSON.stringify({ type: 'request', payload: req }))
  } catch {
    /* best-effort */
  }
}

function scheduleBridgeRetry(): void {
  if (intentionalClose) return
  clearRetry()
  retryTimer = setTimeout(() => {
    retryDelay = Math.min(retryDelay * 2, 30_000)
    openBridgeSocket()
  }, retryDelay)
}

function openBridgeSocket(): void {
  if (intentionalClose) return
  clearRetry()
  emitBridge({ state: 'connecting', url: bridgeUrl })

  let socket: WebSocket
  try {
    socket = new WebSocket(bridgeUrl)
  } catch (e: unknown) {
    emitBridge({ state: 'error', url: bridgeUrl, error: e instanceof Error ? e.message : String(e) })
    scheduleBridgeRetry()
    return
  }
  ws = socket

  const control = new RuntimeControlReceiver(
    'browser',
    RUNTIME_CONTROL_CAPABILITIES,
    (command) => new Promise<boolean>((resolve) => onControl(command, resolve)),
    (message) => {
      if (ws === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
  )
  socket.onopen = () => {
    if (intentionalClose || ws !== socket) {
      socket.close()
      return
    }
    control.hello()
    retryDelay = 1000
    emitBridge({ state: 'connected', url: bridgeUrl, since: Date.now() })
    // Replay only records THIS page originated — anything that arrived over
    // the bridge belongs to the hub/another peer already (see
    // bridgeOriginIds); echoing it back created permanent stale duplicates.
    for (const req of Hakka.getLogs().reverse()) {
      if (typeof req.id === 'string' && bridgeOriginIds.has(req.id)) continue
      sendOverBridge(socket, req)
    }
  }

  // The hub relays each peer's frames to every other peer — so connecting also
  // pulls in captures from OTHER sources (e.g. the Next.js server via hakka-node,
  // tagged runtime:'server'). Ingest them so the overlay shows full-stack traffic.
  socket.onmessage = (ev: MessageEvent) => {
    try {
      const raw = typeof ev.data === 'string' ? ev.data : ''
      const msg = JSON.parse(raw) as { type?: unknown; payload?: unknown }
      if (control.receive(msg)) return
      if (msg?.type === 'request' && msg.payload && typeof msg.payload === 'object') {
        const payload = msg.payload as NetworkRequest
        // Bracketed with ingestingFromBridge so our bridge-send listener
        // (in bridgeConnect) skips re-sending this exact id.
        const id = typeof payload.id === 'string' ? payload.id : undefined
        if (id !== undefined) {
          ingestingFromBridge.add(id)
          if (bridgeOriginIds.size >= BRIDGE_ORIGIN_IDS_MAX) bridgeOriginIds.clear()
          bridgeOriginIds.add(id)
        }
        try {
          Hakka.ingest(payload)
        } finally {
          if (id !== undefined) ingestingFromBridge.delete(id)
        }
      } else if (msg?.type === 'span' && msg.payload && typeof msg.payload === 'object') {
        // Relay-only, like 'control': never buffered by the hub, so no
        // replay-on-connect concern here.
        ingestSpan(msg.payload as FrameworkSpan)
      } else if (msg?.type === 'control' && msg.payload && typeof msg.payload === 'object') {
        // Hand to the sink; the main thread validates + applies it where the
        // mock/breakpoint/throttle engines live.
        onControl(msg.payload)
      }
    } catch {
      /* ignore malformed frames */
    }
  }

  socket.onclose = (ev) => {
    control.close()
    if (ws === socket) ws = null
    if (intentionalClose) {
      emitBridge({ state: 'disconnected' })
      return
    }
    emitBridge({ state: 'error', url: bridgeUrl, error: `WebSocket closed (code ${ev.code})` })
    scheduleBridgeRetry()
  }
}

export const storeEngine = {
  /** Start the store engine once. Subsequent calls only re-apply config. */
  init(
    config: StoreConfig | undefined,
    requestSink: RequestSink,
    bridgeSink: BridgeSink,
    controlSink?: ControlSink,
    spanSink?: SpanSink,
  ): void {
    onRequest = requestSink
    onBridgeStatus = bridgeSink
    if (controlSink) onControl = controlSink
    if (spanSink) onSpan = spanSink
    if (config?.slimEcho != null) slimEchoEnabled = config.slimEcho
    if (started) {
      if (config) Hakka.configure(mapConfig(config))
      return
    }
    Hakka.start({ mode: 'store', ...mapConfig(config) })
    // Slim by default — see StoreConfig.slimEcho in protocol.ts.
    engineUnsub = Hakka.onRequest((req) => onRequest(slimEchoEnabled ? stripBodies(req) : req))
    started = true
  },

  ingest(req: NetworkRequest): void {
    Hakka.ingest(req)
  },

  update(partial: Partial<NetworkRequest> & { id: string }): void {
    Hakka.update(partial)
  },

  /**
   * Apply a Resource-Timing patch from the main-thread PerformanceObserver to the
   * stored request that best matches `url` + start time. Skips requests that
   * already carry real timing so two entries to the same url enrich two requests.
   */
  applyResourceTiming(url: string, entryEpochStart: number, patch: Partial<NetworkRequest>): void {
    let best: NetworkRequest | undefined
    let bestDelta = Number.POSITIVE_INFINITY
    // Use URL index: O(k) where k = entries for this URL, not O(n) over all logs.
    for (const r of Hakka.getLogsByUrl(url)) {
      if ((r.source !== 'fetch' && r.source !== 'xhr') || r.timing) continue
      const delta = Math.abs(r.startTime - entryEpochStart)
      if (delta < bestDelta) {
        bestDelta = delta
        best = r
      }
    }
    if (best) Hakka.update({ id: best.id, ...patch })
  },

  clear(): void {
    Hakka.clearLogs()
  },

  configure(config: StoreConfig): void {
    if (config.slimEcho != null) slimEchoEnabled = config.slimEcho
    Hakka.configure(mapConfig(config))
  },

  /**
   * Snapshot the store, slimmed the same way the live echo is — backs the
   * same main-thread mirror `subscribe()` feeds (Inspector's history
   * backfill on mount), so a pre-existing request can't smuggle full bodies
   * in either. `getBody`/`getBodies` below are the full-fidelity escape hatch.
   */
  snapshot(query?: StoreQuery): NetworkRequest[] {
    const results = filterRequests(Hakka.getLogs(), query)
    return slimEchoEnabled ? results.map(stripBodies) : results
  },

  /** Full-fidelity body lookup for one request, by id — the on-demand half of slimEcho. */
  getBody(id: string): BodyPair | null {
    const req = Hakka.getLogs().find((r) => r.id === id)
    if (!req) return null
    return { requestBody: req.requestBody ?? null, responseBody: req.responseBody ?? null }
  },

  /** Spans currently held for a trace — `[]` for an unknown or evicted trace. */
  getSpansForTrace(traceId: string): FrameworkSpan[] {
    return spansByTrace.get(traceId) ?? []
  },

  /** Batch form of `getBody` — one pass over the store instead of one lookup per id. */
  getBodies(ids: string[]): Record<string, BodyPair> {
    const wanted = new Set(ids)
    const out: Record<string, BodyPair> = {}
    for (const r of Hakka.getLogs()) {
      if (wanted.has(r.id)) out[r.id] = { requestBody: r.requestBody ?? null, responseBody: r.responseBody ?? null }
    }
    return out
  },

  /**
   * Run a compiled search predicate over the FULL-fidelity store and return
   * matching ids — how body-scoped search stays correct under slimEcho, since
   * the main-thread mirror has no bodies to match against and this side does.
   */
  matchIds(query: AdvancedQuery): string[] {
    const match = compileQuery(query)
    const out: string[] = []
    for (const r of Hakka.getLogs()) {
      if (match(r)) out.push(r.id)
    }
    return out
  },

  exportHar(): string {
    return exportHarString(Hakka.getLogs())
  },

  exportPostman(): string {
    return exportPostmanString(Hakka.getLogs())
  },

  exportOtel(options?: OtelOptions): string {
    const records = Hakka.getLogs().map((r) => networkRequestToRecord(r))
    return JSON.stringify(recordsToOtelJson(records, options), null, 2)
  },

  bridgeConnect(url?: string): void {
    const target = url ?? DEFAULT_DESKTOP_URL
    const active = bridgeUnsub !== null && bridgeUrl === target
    if (active) return
    if (bridgeUnsub) storeEngine.bridgeDisconnect()

    bridgeUrl = target
    intentionalClose = false
    retryDelay = 1000
    bridgeUnsub = Hakka.onRequest((req) => {
      // Skip echoing a request we just ingested FROM this same bridge — see
      // `ingestingFromBridge` above.
      if (ingestingFromBridge.has(req.id)) return
      if (ws && ws.readyState === WebSocket.OPEN) sendOverBridge(ws, req)
    })
    openBridgeSocket()
  },

  bridgeDisconnect(): void {
    intentionalClose = true
    clearRetry()
    bridgeUnsub?.()
    bridgeUnsub = null
    if (ws) {
      ws.close()
      ws = null
    }
    emitBridge({ state: 'disconnected' })
  },

  /** Full teardown for the in-process backend: drop the bridge, clear, and stop. */
  shutdown(): void {
    storeEngine.bridgeDisconnect()
    engineUnsub?.()
    engineUnsub = null
    Hakka.clearLogs()
    Hakka.stop()
    started = false
    onRequest = () => {}
    onBridgeStatus = () => {}
    onSpan = () => {}
    // Reset to the documented default so the next init() (a fresh logical
    // instance) doesn't inherit a leftover slimEcho setting the caller never
    // explicitly set.
    slimEchoEnabled = true
    bridgeOriginIds.clear()
    spansByTrace.clear()
  },
}
