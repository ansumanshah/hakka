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

  setAdapter(adapter: StorageAdapter | null): void {
    this.storageAdapter = adapter
  }

  hasAdapter(): boolean {
    return this.storageAdapter !== null
  }

  /** Coalesce adapter writes: a burst of ingests becomes one `save()` instead of O(n) each. */
  schedulePersist(logs: RingBuffer): void {
    if (!this.storageAdapter || this.persistTimer !== null) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.flushPersist(logs)
    }, PERSIST_COALESCE_MS)
  }

  /** Write the current logs to the adapter now, cancelling any pending coalesced write. */
  flushPersist(logs: RingBuffer): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.storageAdapter) return
    const result = this.storageAdapter.save(logs.getAll())
    if (result && typeof (result as Promise<void>).catch === 'function') {
      ;(result as Promise<void>).catch((error) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[Hakka] StorageAdapter.save failed.', error)
        }
      })
    }
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
    if (!this.storageAdapter) return
    const result = this.storageAdapter.clear()
    if (result && typeof (result as Promise<void>).catch === 'function') {
      ;(result as Promise<void>).catch((error) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[Hakka] StorageAdapter.clear failed.', error)
        }
      })
    }
  }

  /**
   * Hydrate `logs` from the adapter (called from `start()`). Only fills the
   * remaining ring capacity so live requests captured during the async load()
   * are never evicted by hydration.
   */
  async hydrateFromAdapter(
    logs: RingBuffer,
    maxRequests: number,
    isRunning: () => boolean,
    applyRetention: () => void,
  ): Promise<void> {
    if (!this.storageAdapter) return
    try {
      const records = await Promise.resolve(this.storageAdapter.load())
      if (!isRunning()) return
      // Only fill the REMAINING ring capacity so hydration never evicts live
      // data captured during the async load(). `records` is newest-first
      // (saved via getAll()); take the newest that fit, then add oldest-first.
      const available = maxRequests - logs.size
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
