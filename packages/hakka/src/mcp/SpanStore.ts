import type { FrameworkSpan } from 'hakka-core'

// Append-only ring buffer — spans are emitted once and never updated (unlike RequestStore's id-keyed RingBuffer).
export class SpanStore {
  private readonly buffer: Array<FrameworkSpan | null>
  private head = 0
  private _size = 0
  private readonly capacity: number

  constructor(maxEntries = 500) {
    this.capacity = maxEntries
    this.buffer = new Array<FrameworkSpan | null>(maxEntries).fill(null) // oxlint-disable-line unicorn/no-new-array
  }

  add(span: FrameworkSpan): void {
    if (this._size < this.capacity) this._size++
    this.buffer[this.head] = span
    this.head = (this.head + 1) % this.capacity
  }

  /** Return all captured spans, oldest→newest. */
  getEntries(): FrameworkSpan[] {
    const start = (this.head - this._size + this.capacity) % this.capacity
    const result: FrameworkSpan[] = []
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this.capacity
      const item = this.buffer[idx]
      if (item) result.push(item)
    }
    return result
  }

  /** Spans belonging to one trace (`traceId === correlationId` join, see `FrameworkSpan`'s docblock). */
  getByTraceId(traceId: string): FrameworkSpan[] {
    return this.getEntries().filter((s) => s.traceId === traceId)
  }

  clear(): void {
    this.buffer.fill(null)
    this.head = 0
    this._size = 0
  }

  get size(): number {
    return this._size
  }
}
