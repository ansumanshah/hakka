import type { FrameworkSpan, LogEntry, NetworkRequest, StorageSnapshot } from 'hakka-core'

import { parseBridgeMessage } from './protocol'

export interface BridgeHubOptions {
  /** Max records retained in the buffer; oldest are dropped. Default 1000. */
  maxRecords?: number
  /** Max framework spans retained across all traces; on overflow the whole oldest trace is evicted (never a partial trace — see `bufferSpan`). Default 1024. */
  maxSpans?: number
  /** Max spans retained per trace; oldest span in that trace is dropped on overflow. Default 128. */
  maxSpansPerTrace?: number
}

export type RecordListener = (request: NetworkRequest) => void

/** Result of `BridgeHub.ingest` — tells the caller what to relay/count. */
export type IngestResult =
  | { kind: 'request'; request: NetworkRequest }
  | { kind: 'span'; span: FrameworkSpan }
  | { kind: 'console'; entries: LogEntry[] }
  | { kind: 'storage'; snapshot: StorageSnapshot }
  | { kind: 'control' }
  | null

/**
 * Transport-agnostic core of the bridge server: parses incoming client frames,
 * keeps a bounded buffer of received requests, and fans them out to listeners.
 * Contains no network or Node API, so it is fully unit-testable on its own.
 */
export class BridgeHub {
  private records: NetworkRequest[] = []
  /** id → index into `records`, kept in sync so re-ingest replaces in place. */
  private readonly byId = new Map<string, number>()
  private readonly max: number
  private readonly listeners = new Set<RecordListener>()

  /**
   * traceId → spans, in ingestion order. A `Map`'s iteration order is
   * insertion order and is stable across updates to an existing key (only a
   * delete+re-add moves it), so this doubles as the oldest-trace-first
   * eviction queue for `maxSpans` without any extra bookkeeping.
   */
  private readonly spansByTrace = new Map<string, FrameworkSpan[]>()
  private spanCount = 0
  private readonly maxSpans: number
  private readonly maxSpansPerTrace: number

  /**
   * Latest `storage` snapshot per store name — snapshot-replace semantics
   * (see `StorageSnapshot`'s doc comment), so unlike spans there is nothing
   * to accumulate: a new frame for a `store` simply overwrites the old one.
   * Buffered (unlike `console`) so a freshly-connected viewer immediately
   * sees current storage state instead of a blank panel until the device's
   * next snapshot.
   */
  private readonly latestStorageByStore = new Map<string, StorageSnapshot>()

  constructor(options: BridgeHubOptions = {}) {
    this.max = Math.max(1, Math.floor(options.maxRecords ?? 1000))
    this.maxSpans = Math.max(1, Math.floor(options.maxSpans ?? 1024))
    this.maxSpansPerTrace = Math.max(1, Math.floor(options.maxSpansPerTrace ?? 128))
  }

  /**
   * Parse and ingest a raw client frame.
   *
   * - `request` frames are buffered and fanned out to `onRecord` listeners:
   *   returns `{ kind: 'request', request }`.
   * - `control` frames are relayed by the caller but NOT buffered and do NOT
   *   count as records (deep validation of the control payload is the
   *   receiving peer's job): returns `{ kind: 'control' }`.
   * - Malformed frames are dropped: returns `null`.
   */
  ingest(raw: string): IngestResult {
    const message = parseBridgeMessage(raw)
    if (!message) return null

    if (message.type === 'control') {
      return { kind: 'control' }
    }

    // Span frames are buffered into their own bounded backlog (see
    // `bufferSpan`) so a client that connects after spans were emitted —
    // e.g. an overlay reconnecting after a hard reload, exactly when
    // document-load spans fire — still gets them on replay. They never
    // touch `records`/`byId` and never count toward `size`/`maxRecords`.
    if (message.type === 'span') {
      this.bufferSpan(message.payload)
      return { kind: 'span', span: message.payload }
    }

    // `console` frames are relay-only, like `control` — a live log stream
    // with nothing meaningful to replay to a late joiner (the entries that
    // already scrolled by are gone regardless), so they never touch a
    // buffer or count toward `size`/`maxRecords`.
    if (message.type === 'console') {
      return { kind: 'console', entries: message.payload }
    }

    if (message.type === 'storage') {
      this.latestStorageByStore.set(message.payload.store, message.payload)
      return { kind: 'storage', snapshot: message.payload }
    }

    const request = message.payload
    // Dedup by id: a request's second emit (body arriving) and an overlay
    // replaying its store on reconnect both resend known ids. Replace in
    // place so the buffer stays one row per logical request and replay is
    // idempotent.
    const existing = typeof request.id === 'string' ? this.byId.get(request.id) : undefined
    if (existing !== undefined) {
      this.records[existing] = request
    } else {
      this.records.push(request)
      if (typeof request.id === 'string') this.byId.set(request.id, this.records.length - 1)
      if (this.records.length > this.max) {
        const dropCount = this.records.length - this.max
        const dropped = this.records.splice(0, dropCount)
        for (const d of dropped) {
          if (typeof d.id === 'string') this.byId.delete(d.id)
        }
        // Eviction shifted every surviving index left by dropCount.
        for (const [id, idx] of this.byId) {
          this.byId.set(id, idx - dropCount)
        }
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(request)
      } catch {
        // A misbehaving listener must not break ingestion or other listeners.
      }
    }
    return { kind: 'request', request }
  }

  /**
   * Buffer a span into its trace's bucket, evicting on overflow. Two
   * independent bounds, checked in this order: (1) per-trace
   * (`maxSpansPerTrace`) drops the bucket's oldest span (FIFO) once it grows
   * past the limit, so a long trace can't crowd out others; (2) total
   * (`maxSpans`) drops the WHOLE oldest trace once the sum exceeds the
   * limit, never a handful of spans — a partial trace tree renders worse
   * than no tree. Mirrors hakka-browser's storeEngine `SPAN_TRACE_MAX`/
   * `SPAN_PER_TRACE_MAX` in spirit, scoped to a total span count.
   */
  private bufferSpan(span: FrameworkSpan): void {
    let bucket = this.spansByTrace.get(span.traceId)
    if (!bucket) {
      bucket = []
      this.spansByTrace.set(span.traceId, bucket)
    }
    bucket.push(span)
    this.spanCount++
    if (bucket.length > this.maxSpansPerTrace) {
      bucket.shift()
      this.spanCount--
    }
    // `size > 1` guards against evicting the only trace left (which would
    // otherwise be the trace we just inserted into, if `maxSpansPerTrace`
    // were misconfigured above `maxSpans`) — that would just thrash instead
    // of converging.
    while (this.spanCount > this.maxSpans && this.spansByTrace.size > 1) {
      const oldestKey = this.spansByTrace.keys().next().value
      if (oldestKey === undefined) break
      const oldestBucket = this.spansByTrace.get(oldestKey)
      this.spansByTrace.delete(oldestKey)
      this.spanCount -= oldestBucket?.length ?? 0
    }
  }

  /** Snapshot of buffered requests, oldest first. */
  getRecords(): NetworkRequest[] {
    return [...this.records]
  }

  /**
   * Snapshot of buffered spans in replay order: traces oldest-first (by
   * first arrival), each trace's own spans in original ingestion order.
   * Consumers link spans into a tree by `parentId` and already tolerate
   * out-of-order arrival — async spans routinely complete out of program
   * order even on a live connection — so this ordering is a cheap, stable
   * default rather than a causal guarantee.
   */
  getSpans(): FrameworkSpan[] {
    const out: FrameworkSpan[] = []
    for (const bucket of this.spansByTrace.values()) {
      out.push(...bucket)
    }
    return out
  }

  /**
   * Snapshot of the latest `storage` frame per store name, in no particular
   * order (a `Map`'s insertion order, which is not meaningful here the way
   * it is for `getSpans`' trace ordering — replaying storage a moment
   * "later" than requests/spans is fine since each store name is
   * independent and self-contained).
   */
  getStorageSnapshots(): StorageSnapshot[] {
    return [...this.latestStorageByStore.values()]
  }

  get size(): number {
    return this.records.length
  }

  /** Total buffered spans across all traces (mirrors `size` for requests). */
  get spanSize(): number {
    return this.spanCount
  }

  clear(): void {
    this.records = []
    this.byId.clear()
    this.spansByTrace.clear()
    this.spanCount = 0
    this.latestStorageByStore.clear()
  }

  /** Subscribe to ingested requests. Returns an unsubscribe function. */
  onRecord(listener: RecordListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
