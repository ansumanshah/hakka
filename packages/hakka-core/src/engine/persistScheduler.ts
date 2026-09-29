import type { RingBuffer } from '../storage/RingBuffer'
import type { StorageAdapter } from '../storage/StorageAdapter'

declare const __DEV__: boolean

/** Coalesce adapter writes arriving within this window into a single `save()` — otherwise a burst of N requests is O(n²) (N full-copy saves) instead of O(n). */
const PERSIST_COALESCE_MS = 50

/**
 * PersistScheduler — owns the Hakka facade's `StorageAdapter` lifecycle:
 * coalesced writes on ingest, immediate flush/clear, and hydration on start().
 * Composed into the facade so persistence concerns stay out of the
 * capture/ingest hot path.
 */
export class PersistScheduler {
  private storageAdapter: StorageAdapter | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private pendingWrite: Promise<void> | null = null
  private loadGeneration = 0

  setAdapter(adapter: StorageAdapter | null): void {
    this.invalidateLoads()
    this.cancelPendingPersist()
    this.storageAdapter = adapter
  }

  invalidateLoads(): void {
    this.loadGeneration += 1
  }

  hasAdapter(): boolean {
    return this.storageAdapter !== null
  }

  /** Coalesce adapter writes: a burst of ingests becomes one `save()` instead of O(n) each. */
  schedulePersist(getLogs: () => RingBuffer): void {
    if (!this.storageAdapter || this.persistTimer !== null) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.flushPersist(getLogs())
    }, PERSIST_COALESCE_MS)
  }

  /** Write the current logs to the adapter now, cancelling any pending coalesced write. */
  flushPersist(logs: RingBuffer): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const adapter = this.storageAdapter
    if (!adapter) return
    const records = logs.getAll()
    this.writeAdapter('save', () => adapter.save(records))
  }

  /** Cancel any pending coalesced write without flushing it (used before clearing storage). */
  cancelPendingPersist(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
  }

  /** Clear persisted data when logs are cleared, mirroring flushPersist's error handling. */
  clearAdapter(): void {
    this.invalidateLoads()
    const adapter = this.storageAdapter
    if (adapter) this.writeAdapter('clear', () => adapter.clear())
  }

  /** Preserve call order even when an adapter completes writes asynchronously. */
  private writeAdapter(name: 'save' | 'clear', operation: () => void | Promise<void>): void {
    const report = (error: unknown) => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[Hakka] StorageAdapter.${name} failed.`, error)
      }
    }
    const run = () => {
      try {
        const result = operation()
        if (result) return Promise.resolve(result).catch(report)
      } catch (error) {
        report(error)
      }
    }
    const pending = this.pendingWrite ? this.pendingWrite.then(run) : run()
    if (!pending) return
    this.pendingWrite = pending
    void pending.then(() => {
      if (this.pendingWrite === pending) this.pendingWrite = null
    })
  }

  /**
   * Hydrate `logs` from the adapter (called from `start()`). Only fills the
   * remaining ring capacity so live requests captured during the async load()
   * are never evicted by hydration.
   */
  async hydrateFromAdapter(
    getLogs: () => RingBuffer,
    getMaxRequests: () => number,
    isRunning: () => boolean,
    applyRetention: () => void,
  ): Promise<void> {
    const adapter = this.storageAdapter
    if (!adapter) return
    const generation = ++this.loadGeneration
    try {
      if (this.pendingWrite) await this.pendingWrite
      if (generation !== this.loadGeneration || !isRunning()) return
      const records = await adapter.load()
      if (generation !== this.loadGeneration || !isRunning()) return
      const logs = getLogs()
      // Only fill the REMAINING ring capacity so hydration never evicts live
      // data captured during the async load(). `records` is newest-first
      // (saved via getAll()); take the newest that fit, then add oldest-first.
      const available = getMaxRequests() - logs.size
      if (available > 0) {
        for (const request of records.slice(0, available).reverse()) {
          if (!logs.get(request.id)) {
            logs.add(request)
          }
        }
      }
      applyRetention()
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[Hakka] StorageAdapter.load failed.', error)
      }
    }
  }
}
