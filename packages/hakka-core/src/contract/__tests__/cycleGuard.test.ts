import { describe, expect, test } from 'bun:test'

import { createCycleGuard } from '../cycleGuard'

describe('createCycleGuard', () => {
  test('a running cycle is current', () => {
    const cycle = createCycleGuard()
    const isCurrent = cycle.begin()
    expect(isCurrent()).toBe(true)
  })

  test('end() retires the running cycle', () => {
    const cycle = createCycleGuard()
    const isCurrent = cycle.begin()
    cycle.end()
    expect(isCurrent()).toBe(false)
  })

  // The bug this type exists for: with a shared `stopped` boolean, a restart
  // sets it back to false and an emission still in flight from the first cycle
  // reaches the first cycle's captured (stale) context. The retired cycle must
  // stay retired no matter how many cycles follow it.
  test('a retired cycle stays retired across a restart', () => {
    const cycle = createCycleGuard()
    const first = cycle.begin()
    cycle.end()
    const second = cycle.begin()

    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  test('starting a new cycle without ending the old one retires the old one', () => {
    const cycle = createCycleGuard()
    const first = cycle.begin()
    const second = cycle.begin()

    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  test('cycles are independent per guard instance', () => {
    const a = createCycleGuard()
    const b = createCycleGuard()
    const aCurrent = a.begin()
    b.begin()
    b.end()

    expect(aCurrent()).toBe(true)
  })
})
