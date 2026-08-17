import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { RetentionPolicy } from '../RetentionPolicy'
import { RingBuffer } from '../RingBuffer'

function req(id: string, startTime: number): NetworkRequest {
  return { id, url: `https://example.com/${id}`, method: 'GET', startTime }
}

// Note on clocks: `removeOlderThan` always measures staleness against the
// real `Date.now()` — only `RetentionPolicy`'s gating decision (whether to
// bother calling it) takes the injected clock. So entries below are built
// stale/fresh relative to real time, while a separate synthetic counter
// drives the gate's elapsed-time arithmetic deterministically.

describe('RetentionPolicy — maxAge sweep (ungated, default behavior)', () => {
  test('removes entries older than maxAgeMs and keeps fresh ones', () => {
    const buf = new RingBuffer(10)
    const now = Date.now()
    buf.add(req('old', now - 60_000))
    buf.add(req('new', now))

    const policy = new RetentionPolicy(30_000)
    policy.apply(buf)

    expect(buf.get('old')).toBeUndefined()
    expect(buf.get('new')?.id).toBe('new')
  })

  test('does nothing when maxAgeMs is null', () => {
    const buf = new RingBuffer(10)
    buf.add(req('old', Date.now() - 999_999))

    const policy = new RetentionPolicy(null)
    policy.apply(buf)

    expect(buf.get('old')?.id).toBe('old')
  })

  test('does nothing when maxAgeMs is 0 (edge case beyond the null check)', () => {
    const buf = new RingBuffer(10)
    buf.add(req('old', Date.now() - 999_999))

    const policy = new RetentionPolicy(0)
    policy.apply(buf)

    expect(buf.get('old')?.id).toBe('old')
  })

  test('every apply() call sweeps immediately — no gating by default', () => {
    const buf = new RingBuffer(10)
    const now = Date.now()
    const policy = new RetentionPolicy(1_000) // no options passed — gating stays off

    buf.add(req('a', now - 60_000)) // already far past the 1000ms maxAge
    policy.apply(buf)
    expect(buf.get('a')).toBeUndefined() // swept on this very first call

    buf.add(req('b', now)) // fresh
    policy.apply(buf)
    expect(buf.get('b')?.id).toBe('b') // not stale — untouched
  })
})

describe('RetentionPolicy — minSweepIntervalMs gating', () => {
  const MAX_AGE_MS = 5_000
  const STALE_OFFSET_MS = 120_000 // 2 minutes ago — comfortably past MAX_AGE_MS

  test('a sweep within the gate window is skipped, leaving a stale entry in place', () => {
    const buf = new RingBuffer(10)
    const now = Date.now()
    let gateNow = 1_000_000
    const policy = new RetentionPolicy(MAX_AGE_MS, { minSweepIntervalMs: 10_000, now: () => gateNow })

    buf.add(req('a', now - STALE_OFFSET_MS))
    policy.apply(buf) // first call always sweeps, regardless of gating
    expect(buf.get('a')).toBeUndefined()

    buf.add(req('b', now - STALE_OFFSET_MS)) // also already stale in wall-clock terms
    gateNow += 50 // only 50ms since the last actual sweep — well under the 10s gate
    policy.apply(buf)

    // Gated: the tail-walk was skipped, so the stale entry survives.
    expect(buf.get('b')?.id).toBe('b')
  })

  test('once the gate interval fully elapses, the next apply() call sweeps and prunes the stale prefix', () => {
    const buf = new RingBuffer(10)
    const now = Date.now()
    let gateNow = 1_000_000
    const policy = new RetentionPolicy(MAX_AGE_MS, { minSweepIntervalMs: 10_000, now: () => gateNow })

    policy.apply(buf) // first call always sweeps — no-op on an empty buffer; sets lastSweepAt

    // Insert in chronological slot order (oldest first) — the tail-walk only
    // prunes a contiguous stale run from the oldest slot forward (see
    // RingBuffer.removeOlderThan), so the stale entry must occupy the
    // earlier slot to be reachable by the walk.
    buf.add(req('b', now - STALE_OFFSET_MS)) // stale, oldest slot
    buf.add(req('a', now)) // fresh, added after

    gateNow += 10_000 // gate interval fully elapsed since the first sweep
    policy.apply(buf)

    expect(buf.get('b')).toBeUndefined() // stale prefix pruned once the gate allowed it
    expect(buf.get('a')?.id).toBe('a') // fresh entry unaffected
  })

  test('the very first apply() call always sweeps even when gating is enabled', () => {
    const buf = new RingBuffer(10)
    const now = Date.now()
    buf.add(req('old', now - STALE_OFFSET_MS))
    const policy = new RetentionPolicy(MAX_AGE_MS, { minSweepIntervalMs: 60_000, now: () => 1_000_000 })

    policy.apply(buf)

    expect(buf.get('old')).toBeUndefined()
  })

  test('gating still honors maxAgeMs === null — no sweep at all, regardless of the interval', () => {
    const buf = new RingBuffer(10)
    const now = Date.now()
    let gateNow = 1_000_000
    buf.add(req('old', now - STALE_OFFSET_MS))
    const policy = new RetentionPolicy(null, { minSweepIntervalMs: 1, now: () => gateNow })

    policy.apply(buf)
    gateNow += 10
    policy.apply(buf)

    expect(buf.get('old')?.id).toBe('old')
  })

  test('repeated rapid apply() calls within the gate window perform exactly one underlying sweep', () => {
    const buf = new RingBuffer(10)
    const now = Date.now()
    let gateNow = 1_000_000
    const policy = new RetentionPolicy(MAX_AGE_MS, { minSweepIntervalMs: 1_000, now: () => gateNow })

    buf.add(req('a', now - STALE_OFFSET_MS))
    policy.apply(buf) // first call always sweeps — prunes 'a' immediately
    expect(buf.get('a')).toBeUndefined()

    buf.add(req('b', now - STALE_OFFSET_MS)) // re-add another already-stale entry
    for (let i = 0; i < 5; i++) {
      gateNow += 10 // every rapid call lands inside the same 1000ms gate window
      policy.apply(buf)
    }
    expect(buf.get('b')?.id).toBe('b') // still gated — none of the 5 calls swept

    gateNow += 1_000 // now past the gate window relative to the last actual sweep
    policy.apply(buf)
    expect(buf.get('b')).toBeUndefined()
  })
})
