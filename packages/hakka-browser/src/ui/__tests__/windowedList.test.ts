import { describe, expect, it } from 'vitest'

import { windowFlatItems } from '../windowedList'

describe('windowFlatItems', () => {
  it('returns empty output for an empty input', () => {
    expect(windowFlatItems([], [], 0, 400, 0)).toEqual({ slice: [], padTop: 0, padBottom: 0 })
  })

  it('returns everything with zero padding when the window covers the whole list', () => {
    const items = ['a', 'b', 'c']
    const heights = [10, 10, 10]
    const result = windowFlatItems(items, heights, 0, 100, 0)
    expect(result).toEqual({ slice: ['a', 'b', 'c'], padTop: 0, padBottom: 0 })
  })

  it('computes start/end and pad offsets for variable-height items (header+row mix)', () => {
    // Heights alternate 10/20 like a header (20) followed by rows (10) would.
    const items = ['a', 'b', 'c', 'd', 'e']
    const heights = [10, 20, 10, 20, 10] // cumulative: 0,10,30,40,60,70
    // scrollTop=25, viewportH=20, overscan=5 → window [20, 50)
    const result = windowFlatItems(items, heights, 25, 20, 5)
    expect(result.slice).toEqual(['b', 'c', 'd']) // indices 1..3
    expect(result.padTop).toBe(10) // height of 'a'
    expect(result.padBottom).toBe(10) // 70 total - 60 (through 'd')
  })

  it('treats a missing height entry as 0 rather than throwing', () => {
    const items = ['a', 'b', 'c']
    const heights = [10] // 'b' and 'c' heights omitted
    const result = windowFlatItems(items, heights, 0, 100, 0)
    expect(result.slice).toEqual(['a', 'b', 'c'])
    expect(result.padTop).toBe(0)
    expect(result.padBottom).toBe(0)
  })

  it('clamps the overscanned window top at 0 rather than going negative', () => {
    const items = ['a', 'b', 'c']
    const heights = [10, 10, 10]
    // scrollTop=0 with a large overscan would go negative without the clamp.
    const result = windowFlatItems(items, heights, 0, 15, 50)
    expect(result.padTop).toBe(0)
    expect(result.slice).toEqual(['a', 'b', 'c'])
  })
})
