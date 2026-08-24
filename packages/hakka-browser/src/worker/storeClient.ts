/**
 * storeClient — the main thread's handle on the capture store.
 *
 * Two interchangeable backends behind one interface:
 *  - **worker**: spawns the inline store Worker; ingest/update/timing are
 *    fire-and-forget `postMessage`s, snapshots/exports are request/response
 *    RPC. Store, dedup, retention, serialization, and the bridge socket all
 *    run off the main thread.
 *  - **in-process**: drives the same `storeEngine` on the main thread. Used
 *    when `Worker` is unavailable (SSR, locked-down hosts) and in unit tests.
 *    Same behavior, no thread boundary.
 *
 * Request echoes flow back only while a subscriber is attached (the inspector
 * is open), so the always-on capture path never pays for a round-trip.
 */
import { applyControlCommand, parseControlCommand } from 'hakka-core'
import type { AdvancedQuery, ConnectionStatus, FrameworkSpan, NetworkRequest } from 'hakka-core'

import type { BodyPair, MainToWorker, OtelOptions, StoreConfig, StoreQuery, WorkerToMain } from './protocol'
// Static specifier so Vite inlines the worker as a blob URL into the
// single-file bundle; only *instantiated* when a Worker is actually
// available, so importing it is inert under SSR/tests. `&inline` must stay
// on for both lib targets — dropping it for ESM only doesn't work (shared
// rolldown() build, no per-format hook), and non-inline broke the IIFE's
// zero-peers drop-in contract with an absolute worker URL that 404s for most
// embedders. (oxlint can't resolve Vite's virtual `?worker` module; the
// default export is declared in worker/worker.d.ts.)
// oxlint-disable-next-line import/default, import/no-unresolved
import StoreWorker from './store.worker?worker&inline'
import { storeEngine } from './storeEngine'

export interface StoreClient {
  ingest(req: NetworkRequest): void
  update(partial: Partial<NetworkRequest> & { id: string }): void
  applyResourceTiming(url: string, entryEpochStart: number, patch: Partial<NetworkRequest>): void
  clear(): void
  configure(config: StoreConfig): void
  getSnapshot(query?: StoreQuery): Promise<NetworkRequest[]>
  subscribe(cb: (req: NetworkRequest) => void): () => void
  /**
   * Live framework-span feed (Next.js/OTel request tree), gated the same way
   * `subscribe` is. Optional: `StoreClient` is implemented by external hosts
   * embedding the elements (rozenite panel, desktop shells), which predate
   * spans — consumers must fail open (no span rows) when absent.
   */
  subscribeSpans?(cb: (span: FrameworkSpan) => void): () => void
  /** Backfill a trace's spans on demand — for a group visible before any subscribeSpans callback existed. Optional, same embedder contract as `subscribeSpans`. */
  getSpansForTrace?(traceId: string): Promise<FrameworkSpan[]>
  exportHar(): Promise<string>
  exportOtel(options?: OtelOptions): Promise<string>
  exportPostman(): Promise<string>
  /**
   * Fetch one request's full `requestBody`/`responseBody` on demand — the
   * main-thread mirror is slim by default (see `StoreConfig.slimEcho`), so
   * Detail pulls the real bytes through here the moment a request is
   * selected. `null` when `id` isn't (or is no longer) in the store.
   */
  getBody(id: string): Promise<BodyPair | null>
  /** Batch form of `getBody` — one round-trip for an export/compare set instead of N. */
  getBodies(ids: string[]): Promise<Map<string, BodyPair>>
  /**
   * Run the parsed search query against the engine's FULL-fidelity records
   * and return matching ids. Body-scoped (and default 'all'-scoped) tokens
   * can't match against the slim mirror — this is the correct evaluation
   * path whenever a query touches body text (see Inspector's filtered()).
   */
  matchIds(query: AdvancedQuery): Promise<string[]>
  bridgeConnect(url?: string): void
  bridgeDisconnect(): void
  onBridgeStatus(cb: (status: ConnectionStatus) => void): () => void
  getBridgeStatus(): ConnectionStatus
  readonly usingWorker: boolean
  destroy(): void
}

export interface StoreClientOptions {
  config?: StoreConfig
  /** Force the in-process backend even when a Worker is available (tests, SSR). */
  forceInProcess?: boolean
}

/**
 * Apply a remote control command (received over the desktop bridge, e.g. from
 * hakka mcp's create_mock) to this thread's engine singletons. Validation +
 * application are both fail-open: malformed payloads are dropped silently.
 */
function applyRemoteControl(payload: unknown): void {
  const cmd = parseControlCommand(payload)
  if (cmd) applyControlCommand(cmd)
}

function createFanout() {
  const requestSubs = new Set<(req: NetworkRequest) => void>()
  const spanSubs = new Set<(span: FrameworkSpan) => void>()
  const statusSubs = new Set<(s: ConnectionStatus) => void>()
  let status: ConnectionStatus = { state: 'disconnected' }
  return {
    requestSubs,
    spanSubs,
    statusSubs,
    get status() {
      return status
    },
    emitRequest(req: NetworkRequest) {
      for (const cb of requestSubs) cb(req)
    },
    emitSpan(span: FrameworkSpan) {
      for (const cb of spanSubs) cb(span)
    },
    emitStatus(s: ConnectionStatus) {
      status = s
      for (const cb of statusSubs) cb(s)
    },
  }
}

function createInProcessClient(opts: StoreClientOptions): StoreClient {
  const fan = createFanout()
  storeEngine.init(
    opts.config,
    (req) => fan.emitRequest(req),
    (s) => fan.emitStatus(s),
    (payload) => applyRemoteControl(payload),
    (span) => fan.emitSpan(span),
  )
  return {
    usingWorker: false,
    ingest: (req) => storeEngine.ingest(req),
    update: (partial) => storeEngine.update(partial),
    applyResourceTiming: (url, t, patch) => storeEngine.applyResourceTiming(url, t, patch),
    clear: () => storeEngine.clear(),
    configure: (config) => storeEngine.configure(config),
    getSnapshot: (query) => Promise.resolve(storeEngine.snapshot(query)),
    subscribe: (cb) => {
      fan.requestSubs.add(cb)
      return () => fan.requestSubs.delete(cb)
    },
    subscribeSpans: (cb) => {
      fan.spanSubs.add(cb)
      return () => fan.spanSubs.delete(cb)
    },
    getSpansForTrace: (traceId) => Promise.resolve(storeEngine.getSpansForTrace(traceId)),
    exportHar: () => Promise.resolve(storeEngine.exportHar()),
    exportOtel: (options) => Promise.resolve(storeEngine.exportOtel(options)),
    exportPostman: () => Promise.resolve(storeEngine.exportPostman()),
    // Promise-wrapped even though there's nothing to await here, so the
    // interface is identical to the Worker backend.
    getBody: (id) => Promise.resolve(storeEngine.getBody(id)),
    getBodies: (ids) => Promise.resolve(new Map(Object.entries(storeEngine.getBodies(ids)))),
    matchIds: (query) => Promise.resolve(storeEngine.matchIds(query)),
    bridgeConnect: (url) => storeEngine.bridgeConnect(url),
    bridgeDisconnect: () => storeEngine.bridgeDisconnect(),
    onBridgeStatus: (cb) => {
      fan.statusSubs.add(cb)
      return () => fan.statusSubs.delete(cb)
    },
    getBridgeStatus: () => fan.status,
    destroy: () => storeEngine.shutdown(),
  }
}

/** One in-flight RPC: its resolver plus the sentinel value to settle it with
 * if the worker dies (error or `destroy()`) before a real `'result'` message
 * arrives — keeps every caller's return type honest (`[]`/`''`/`null`/`{}`)
 * instead of resolving everything with a single untyped `undefined`. */
interface PendingRpc {
  resolve: (value: unknown) => void
  fallback: unknown
}

// Exported so tests can drive the worker backend against a hand-rolled fake
// `Worker` (happy-dom has no real Worker/blob-URL support) — see
// `createStoreClient`'s doc comment for the public entry point.
export function createWorkerClient(worker: Worker, opts: StoreClientOptions): StoreClient {
  const fan = createFanout()
  const pending = new Map<number, PendingRpc>()
  let rid = 0
  // Set once by `worker.onerror` (never by `destroy()` — `destroy()` is a
  // clean, intentional shutdown, not a failure). Guards `send`/`rpc` against
  // talking to a worker we already gave up on, so any RPC made *after* the
  // failure resolves immediately with its fallback instead of hanging again.
  let failed = false

  const send = (msg: MainToWorker) => {
    if (failed) return
    worker.postMessage(msg)
  }

  /** Resolve every in-flight RPC with its fallback and drop it — used by both
   * an async worker failure and a clean `destroy()`, so no caller awaiting
   * `getBody`/`getSnapshot`/etc. is left hanging forever either way. */
  const settlePending = () => {
    for (const { resolve, fallback } of pending.values()) resolve(fallback)
    pending.clear()
  }

  // Only catches a *synchronous* throw from `new StoreWorker()` (see
  // `createStoreClient`). This covers the async case: the worker constructs
  // fine but then fails to load/execute — CSP `worker-src` blocking the blob
  // script after construction, a sandboxed embedding context, etc. Without
  // this, every RPC (in flight now or made later) would hang forever with
  // nothing surfaced anywhere — capture just goes silently dark.
  worker.onerror = (ev) => {
    if (failed) return
    failed = true
    ev.preventDefault?.()
    // Same reporting path as `ui/CrashBoundary.tsx` — a store that silently
    // stops capturing with zero signal is worse than one console line.
    console.error('[hakka] store worker failed to start; capture is disabled for this session', ev.message || ev)
    settlePending()
    worker.terminate()
  }

  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const msg = ev.data
    switch (msg.type) {
      case 'request':
        fan.emitRequest(msg.req)
        break
      case 'span':
        fan.emitSpan(msg.span)
        break
      case 'bridgeStatus':
        fan.emitStatus(msg.status)
        break
      case 'control':
        applyRemoteControl(msg.payload)
        break
      case 'result': {
        const entry = pending.get(msg.rid)
        if (entry) {
          pending.delete(msg.rid)
          entry.resolve(msg.value)
        }
        break
      }
      case 'cleared':
        break
    }
  }

  send({ type: 'init', config: opts.config })

  const rpc = <T>(make: (id: number) => MainToWorker, fallback: T): Promise<T> => {
    if (failed) return Promise.resolve(fallback)
    const id = ++rid
    return new Promise<T>((resolve) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, fallback })
      send(make(id))
    })
  }

  return {
    usingWorker: true,
    ingest: (req) => send({ type: 'ingest', req }),
    update: (partial) => send({ type: 'update', partial }),
    applyResourceTiming: (url, entryEpochStart, patch) => send({ type: 'resourceTiming', url, entryEpochStart, patch }),
    clear: () => send({ type: 'clear' }),
    configure: (config) => send({ type: 'configure', config }),
    getSnapshot: (query) => rpc<NetworkRequest[]>((id) => ({ type: 'snapshot', rid: id, query }), []),
    subscribe: (cb) => {
      const first = fan.requestSubs.size === 0
      fan.requestSubs.add(cb)
      if (first) send({ type: 'subscribe' })
      return () => {
        fan.requestSubs.delete(cb)
        if (fan.requestSubs.size === 0) send({ type: 'unsubscribe' })
      }
    },
    subscribeSpans: (cb) => {
      fan.spanSubs.add(cb)
      return () => fan.spanSubs.delete(cb)
    },
    getSpansForTrace: (traceId) => rpc<FrameworkSpan[]>((rid) => ({ type: 'spansForTrace', rid, traceId }), []),
    exportHar: () => rpc<string>((id) => ({ type: 'exportHar', rid: id }), ''),
    exportOtel: (options) => rpc<string>((id) => ({ type: 'exportOtel', rid: id, options }), ''),
    exportPostman: () => rpc<string>((id) => ({ type: 'exportPostman', rid: id }), ''),
    getBody: (id) => rpc<BodyPair | null>((rid) => ({ type: 'getBody', rid, id }), null),
    getBodies: (ids) =>
      rpc<Record<string, BodyPair>>((rid) => ({ type: 'getBodies', rid, ids }), {}).then(
        (rec) => new Map(Object.entries(rec)),
      ),
    matchIds: (query) => rpc<string[]>((rid) => ({ type: 'matchIds', rid, query }), []),
    bridgeConnect: (url) => send({ type: 'bridgeConnect', url }),
    bridgeDisconnect: () => send({ type: 'bridgeDisconnect' }),
    onBridgeStatus: (cb) => {
      fan.statusSubs.add(cb)
      return () => fan.statusSubs.delete(cb)
    },
    getBridgeStatus: () => fan.status,
    destroy: () => {
      send({ type: 'bridgeDisconnect' })
      // Any in-flight getBody/getSnapshot/etc. caller unwinds with its
      // fallback instead of hanging forever — a terminated worker can never
      // post the 'result' message that would otherwise resolve it.
      settlePending()
      worker.terminate()
    },
  }
}

/**
 * Create the store client. Uses the Worker backend when possible, falling
 * back to the in-process engine up front (SSR, no Worker, or
 * `forceInProcess`) or on a *synchronous* construction failure (below). A
 * worker that constructs fine but then fails to load/execute (CSP
 * `worker-src` blocking the blob script, a sandboxed embedder, …) is caught
 * async instead, inside `createWorkerClient`'s own `worker.onerror` — by then
 * this function has already returned the worker-backed client, so that path
 * disables the dead worker and settles every RPC with a safe fallback rather
 * than swapping the already-returned client's backend.
 */
export function createStoreClient(opts: StoreClientOptions = {}): StoreClient {
  if (!opts.forceInProcess && typeof Worker !== 'undefined') {
    try {
      return createWorkerClient(new StoreWorker(), opts)
    } catch {
      // A host that exposes Worker but rejects construction (CSP, blob URLs
      // disabled) falls through to the identical in-process engine.
    }
  }
  return createInProcessClient(opts)
}
