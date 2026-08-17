import { describe, it, expect, afterEach } from 'vitest'

import { durationTier, sizeTier, setNumberGates, getNumberGates } from '../numberGates'

afterEach(() => setNumberGates())

describe('numberGates', () => {
  it('tiers durations at the default 300/1000ms gates', () => {
    expect(durationTier(120)).toBe('')
    expect(durationTier(300)).toBe('num-warn')
    expect(durationTier(999)).toBe('num-warn')
    expect(durationTier(1000)).toBe('num-hot')
    expect(durationTier(null)).toBe('')
    expect(durationTier(undefined)).toBe('')
  })

  it('tiers sizes at the default 25/100KB gates', () => {
    expect(sizeTier(1024)).toBe('')
    expect(sizeTier(25 * 1024)).toBe('num-warn')
    expect(sizeTier(100 * 1024)).toBe('num-hot')
  })

  it('honors caller overrides and restores defaults on reset', () => {
    setNumberGates({ warnMs: 100, hotMs: 200 })
    expect(durationTier(150)).toBe('num-warn')
    expect(durationTier(250)).toBe('num-hot')
    // Size gates keep defaults when only duration gates are overridden.
    expect(sizeTier(25 * 1024)).toBe('num-warn')
    setNumberGates()
    expect(durationTier(150)).toBe('')
    expect(getNumberGates().warnMs).toBe(300)
  })
})
