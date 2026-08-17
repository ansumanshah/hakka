/**
 * Shared synchronous pub/sub used by every view-model's `subscribe`.
 *
 * `notify()` calls every listener immediately, never deferred to a
 * microtask/timer — deferring would introduce a render lag a synchronous
 * `fireEvent.click` assertion (no `await` in between) would miss.
 *
 * "One notification per logical state change" is satisfied one level up:
 * each view-model calls `notify()` exactly once per public intent method,
 * however many local fields that intent touches. Async batching (coalescing
 * a burst of live upserts) is `RequestListViewModel`'s own concern, layered
 * on top of this emitter.
 */
export interface Emitter {
  notify(): void
  subscribe(listener: () => void): () => void
}

export function createEmitter(): Emitter {
  const listeners = new Set<() => void>()
  // Reentrancy guard: a notify() triggered by a listener mid-pass is dropped
  // rather than recursing — the in-progress pass already reflects the latest
  // state, since every view-model here is a plain synchronous read of a `let`.
  let notifying = false

  return {
    notify() {
      if (notifying) return
      notifying = true
      try {
        for (const listener of listeners) listener()
      } finally {
        notifying = false
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
