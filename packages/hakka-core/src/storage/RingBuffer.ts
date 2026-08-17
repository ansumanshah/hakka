import type { NetworkRequest } from '../model/types'

/**
 * Fixed-size ring buffer with O(1) add and O(1) lookup by ID.
 * Uses pre-allocated array with head pointer — no push/shift.
 */
export class RingBuffer {
  private readonly buffer: Array<NetworkRequest | null>
  private readonly lookup: Map<string, NetworkRequest> = new Map()
  /** id → slot index, so update()/eviction are O(1) instead of scanning the buffer. */
  private readonly slotOf: Map<string, number> = new Map()
  /** url → set of ids for O(1) lookup by URL. */
  private readonly byUrl: Map<string, Set<string>> = new Map()
  private head = 0
  private _size = 0
  private readonly capacity: number
  private listeners: Set<(request: NetworkRequest) => void> = new Set()
  /** Running total of retained request+response body bytes (see `footprintOf`). */
  private _bufferBytes = 0
  /** Byte ceiling for `_bufferBytes` — oldest entries evict first once exceeded. */
  private maxBufferBytes: number

  constructor(capacity: number, maxBufferBytes: number = Number.POSITIVE_INFINITY) {
    this.capacity = capacity
    this.maxBufferBytes = maxBufferBytes
    this.buffer = new Array<NetworkRequest | null>(capacity).fill(null) // oxlint-disable-line unicorn/no-new-array
  }

  /** Iterate oldest→newest without allocating an array. */
  *[Symbol.iterator](): Generator<NetworkRequest> {
    const start = (this.head - this._size + this.capacity) % this.capacity
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this.capacity
      const item = this.buffer[idx]
      if (item) yield item
    }
  }

  /** Iterate newest→oldest without allocating an array. */
  *reversed(): Generator<NetworkRequest> {
    for (let i = 0; i < this._size; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity
      const item = this.buffer[idx]
      if (item) yield item
    }
  }

  private addToUrlIndex(request: NetworkRequest): void {
    let ids = this.byUrl.get(request.url)
    if (!ids) {
      ids = new Set()
      this.byUrl.set(request.url, ids)
    }
    ids.add(request.id)
  }

  private removeFromUrlIndex(request: NetworkRequest): void {
    const ids = this.byUrl.get(request.url)
    if (!ids) return
    ids.delete(request.id)
    if (ids.size === 0) this.byUrl.delete(request.url)
  }

  /**
   * Retained-byte footprint of a single entry — request + response body length.
   * A fast approximation (character length, matching `BodyCapture.size`), not an
   * exact UTF-8 byte count; good enough for a soft memory ceiling.
   */
  private footprintOf(request: NetworkRequest): number {
    return (request.requestBody?.length ?? 0) + (request.responseBody?.length ?? 0)
  }

  add(request: NetworkRequest): void {
    // Full: head's slot holds the oldest entry.
    if (this._size === this.capacity) {
      const oldest = this.buffer[this.head]
      if (oldest) {
        this.lookup.delete(oldest.id)
        this.slotOf.delete(oldest.id)
        this.removeFromUrlIndex(oldest)
        this._bufferBytes -= this.footprintOf(oldest)
      }
    } else {
      this._size++
    }

    this.buffer[this.head] = request
    this.lookup.set(request.id, request)
    this.slotOf.set(request.id, this.head)
    this.addToUrlIndex(request)
    this._bufferBytes += this.footprintOf(request)
    this.head = (this.head + 1) % this.capacity

    // Byte-budget eviction never drops the entry we just inserted — only
    // older entries pay for the overage.
    this.enforceByteBudget(request.id)

    for (const listener of this.listeners) {
      listener(request)
    }
  }

  get(id: string): NetworkRequest | undefined {
    return this.lookup.get(id)
  }

  /** Update an existing entry in-place (two-phase emission, e.g. headers then body); returns true if found. */
  update(request: NetworkRequest): boolean {
    const slot = this.slotOf.get(request.id)
    if (slot === undefined) return false
    const existing = this.buffer[slot]
    // URL may have changed on update — reindex.
    if (existing && existing.url !== request.url) {
      this.removeFromUrlIndex(existing)
      this.addToUrlIndex(request)
    }
    // A replaced record's footprint can change (e.g. a body arrives in a second
    // emit) — swap the old contribution for the new one, not just add.
    if (existing) {
      this._bufferBytes -= this.footprintOf(existing)
    }
    this._bufferBytes += this.footprintOf(request)
    this.buffer[slot] = request
    this.lookup.set(request.id, request)
    // Never evict the entry just updated — it may be the oldest slot (a
    // long-pending request whose body just arrived).
    this.enforceByteBudget(request.id)
    for (const listener of this.listeners) {
      listener(request)
    }
    return true
  }

  getAll(): NetworkRequest[] {
    const result: NetworkRequest[] = []
    for (const item of this.reversed()) {
      result.push(item)
    }
    return result
  }

  /** Iterate the N most recent entries without allocating — for hot-path checks like dedup. */
  *getRecent(n: number): Generator<NetworkRequest> {
    const count = Math.min(n, this._size)
    for (let i = 0; i < count; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity
      const item = this.buffer[idx]
      if (item) yield item
    }
  }

  get size(): number {
    return this._size
  }

  /** Current total of retained request+response body bytes (see `footprintOf`). */
  get bufferBytes(): number {
    return this._bufferBytes
  }

  /** Changes the byte ceiling at runtime; evicts immediately if the new ceiling is now below the current total. */
  setMaxBufferBytes(maxBufferBytes: number): void {
    this.maxBufferBytes = maxBufferBytes
    this.enforceByteBudget()
  }

  clear(): void {
    this.buffer.fill(null)
    this.lookup.clear()
    this.slotOf.clear()
    this.byUrl.clear()
    this.head = 0
    this._size = 0
    this._bufferBytes = 0
  }

  subscribe(listener: (request: NetworkRequest) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** All live entries for a URL, newest-first — O(k) in matches via the id index, no full scan. */
  getByUrl(url: string): NetworkRequest[] {
    const ids = this.byUrl.get(url)
    if (!ids || ids.size === 0) return []
    // `ids` is oldest-first (insertion order) — reverse to match getAll()'s newest-first contract.
    const result: NetworkRequest[] = []
    for (const id of ids) {
      const item = this.lookup.get(id)
      if (item) result.push(item)
    }
    result.reverse()
    return result
  }

  /**
   * Evicts every entry older than maxAgeMs, oldest-first. Relies on entries
   * inserting roughly chronologically, so this tail-walks from the oldest
   * slot and stops at the first non-stale entry rather than scanning everything.
   */
  removeOlderThan(maxAgeMs: number): void {
    const threshold = Date.now() - maxAgeMs
    let oldest = this.peekOldest()
    while (oldest && oldest.startTime < threshold) {
      this.evictOldest()
      oldest = this.peekOldest()
    }
  }

  /** The oldest live entry, or null if empty. O(1) — no allocation. */
  private peekOldest(): NetworkRequest | null {
    if (this._size === 0) return null
    const start = (this.head - this._size + this.capacity) % this.capacity
    return this.buffer[start] ?? null
  }

  /** Evicts the oldest live entry via O(1) index primitives — no array rebuild; shared by age-retention and the byte-budget ceiling. */
  private evictOldest(): void {
    if (this._size === 0) return
    const start = (this.head - this._size + this.capacity) % this.capacity
    const oldest = this.buffer[start]
    this._size--
    if (!oldest) return // defensive: window should never contain a hole
    this.buffer[start] = null
    this.lookup.delete(oldest.id)
    this.slotOf.delete(oldest.id)
    this.removeFromUrlIndex(oldest)
    this._bufferBytes -= this.footprintOf(oldest)
  }

  /**
   * Evicts oldest entries while `_bufferBytes` exceeds `maxBufferBytes`;
   * never evicts `protectId` (the record just inserted/updated) — hitting it
   * ends the loop rather than skipping past it, since skipping would evict
   * newer entries ahead of an older kept one and break the FIFO window. Any
   * resulting overage is bounded to one record and is re-enforced on the next call.
   */
  private enforceByteBudget(protectId?: string): void {
    while (this._size > 1 && this._bufferBytes > this.maxBufferBytes) {
      const oldest = this.peekOldest()
      if (oldest && protectId !== undefined && oldest.id === protectId) return
      this.evictOldest()
    }
  }
}
