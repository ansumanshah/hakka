/**
 * Start/stop cycle identity for a `CaptureSource` (ADR 0006).
 *
 * The contract says a stopped source emits nothing further, *including work
 * already in flight when `stop()` was called*. A single `stopped` boolean —
 * the pattern every source used first — cannot express that across a restart:
 *
 *   start() -> stop() -> start()
 *
 * flips the shared flag back to `false`, so an emission still in flight from
 * the first cycle passes the guard and lands in the first cycle's captured
 * (now stale) context. A monotonically increasing cycle number closes it:
 * a callback only emits while the cycle it was registered in is still the
 * current one, and `end()` retires that cycle permanently.
 */
export interface CycleGuard {
  /** Begin a cycle. The returned predicate is true only while it is current. */
  begin(): () => boolean
  /** Retire the running cycle — every callback registered in it goes quiet. */
  end(): void
}

export function createCycleGuard(): CycleGuard {
  let current = 0
  return {
    begin() {
      const mine = ++current
      return () => mine === current
    },
    end() {
      current++
    },
  }
}
