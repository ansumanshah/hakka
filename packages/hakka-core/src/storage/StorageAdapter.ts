import type { NetworkRequest } from '../model/types'

/**
 * Storage adapter for persisting captured network requests — sync or async.
 * The engine calls `save` on every ingest and `load` once at start.
 */
export interface StorageAdapter {
  /** Persist the current set of captured requests. */
  save(records: NetworkRequest[]): void | Promise<void>
  /** Load previously persisted requests. Called once on engine start. */
  load(): NetworkRequest[] | Promise<NetworkRequest[]>
  /** Clear all persisted data. */
  clear(): void | Promise<void>
}
