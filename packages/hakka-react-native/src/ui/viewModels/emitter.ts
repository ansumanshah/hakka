/**
 * Shared synchronous pub/sub used by every view-model's `subscribe` — RN twin
 * of `packages/hakka-browser/src/ui/viewModels/emitter.ts`.
 *
 * `notify()` must stay synchronous (not deferred to a microtask/timer): it
 * replaces the plain `useState` setters `HakkaInspector.tsx` used to call
 * directly, and `useSyncExternalStore` needs a synchronous `notify()` to
 * re-render without lag. Call it once per public intent method, however many
 * local fields that intent touches — not once per internal write.
 */
export interface Emitter {
  notify(): void
  subscribe(listener: () => void): () => void
}

export function createEmitter(): Emitter {
  const listeners = new Set<() => void>()
  // Reentrancy guard: a notify() triggered mid-pass by a listener's side
  // effect is dropped, not queued — safe since every view-model reads a
  // closed-over local, not a queue.
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
