import type { RingBuffer } from './RingBuffer'

/**
 * Optional knobs for `RetentionPolicy`, additive to the required `maxAgeMs`
 * constructor argument — every field defaults to the pre-existing behavior.
 */
export interface RetentionPolicyOptions {
  /**
   * Minimum ms between actual sweeps (the ring-buffer tail-walk). `apply()`
   * runs on every ingest; setting this > 0 skips the walk until this many ms
   * have passed since the last sweep, trading bounded retention slop (stale
   * entries can live up to this long past `maxAgeMs`) for fewer per-ingest
   * checks. Default `0` = every `apply()` call sweeps.
   */
  minSweepIntervalMs?: number
  /**
   * Injectable clock, defaulting to `Date.now`. Exists so tests can control
   * elapsed time deterministically instead of sleeping in real time.
   */
  now?: () => number
}

/**
 * Retention policy: max count (handled by RingBuffer capacity) + max age.
 * Called on add to prune stale entries.
 */
export class RetentionPolicy {
  private readonly minSweepIntervalMs: number
  private readonly now: () => number
  /** Timestamp of the last sweep that actually ran; null before the first. */
  private lastSweepAt: number | null = null

  constructor(
    private readonly maxAgeMs: number | null, // null = no age limit
    options: RetentionPolicyOptions = {},
  ) {
    this.minSweepIntervalMs = options.minSweepIntervalMs ?? 0
    this.now = options.now ?? Date.now
  }

  apply(buffer: RingBuffer): void {
    if (this.maxAgeMs === null || this.maxAgeMs <= 0) return

    if (this.minSweepIntervalMs > 0) {
      const nowMs = this.now()
      // Skip until minSweepIntervalMs has elapsed since the last real sweep;
      // lastSweepAt starts null so the first call always sweeps.
      if (this.lastSweepAt !== null && nowMs - this.lastSweepAt < this.minSweepIntervalMs) {
        return
      }
      this.lastSweepAt = nowMs
    }

    buffer.removeOlderThan(this.maxAgeMs)
  }
}
