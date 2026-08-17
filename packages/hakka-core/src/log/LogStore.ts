import type { LogEntry } from './types'

/**
 * Fixed-size ring buffer of LogEntry records with O(1) add and subscriber
 * notification; oldest entries are evicted once `maxEntries` is reached.
 * Mirrors storage/RingBuffer.ts's pre-allocated-array pattern but simpler —
 * logs only need append, read-all, and clear, no id-based lookup/update.
 */
export class LogStore {
  private readonly buffer: Array<LogEntry | null>
  private head = 0
  private _size = 0
  private readonly capacity: number
  private listeners: Set<(entry: LogEntry) => void> = new Set()

  constructor(maxEntries = 500) {
    this.capacity = maxEntries
    this.buffer = new Array<LogEntry | null>(maxEntries).fill(null) // oxlint-disable-line unicorn/no-new-array
  }

  add(entry: LogEntry): void {
    if (this._size === this.capacity) {
      // Buffer full — the slot at `head` holds the oldest entry, about to be overwritten.
    } else {
      this._size++
    }

    this.buffer[this.head] = entry
    this.head = (this.head + 1) % this.capacity

    for (const listener of this.listeners) {
      listener(entry)
    }
  }

  /** Return all entries oldest→newest. */
  getEntries(): LogEntry[] {
    const start = (this.head - this._size + this.capacity) % this.capacity
    const result: LogEntry[] = []
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this.capacity
      const item = this.buffer[idx]
      if (item) result.push(item)
    }
    return result
  }

  clear(): void {
    this.buffer.fill(null)
    this.head = 0
    this._size = 0
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  size(): number {
    return this._size
  }
}

/** Shared singleton store used by the log()/logInfo()/etc. convenience functions. */
export const logStore: LogStore = new LogStore()
