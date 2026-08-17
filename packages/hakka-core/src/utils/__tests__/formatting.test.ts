import { describe, expect, it } from 'bun:test'

import { formatBytes, formatDuration, formatTimestamp, truncateText } from '../formatting'

describe('formatBytes', () => {
  const cases: [number, string][] = [
    [0, '0 B'],
    [-1, '0 B'],
    [NaN, '0 B'],
    [Infinity, '0 B'],
    [-Infinity, '0 B'],
    [1023, '1023 B'], // just below KB boundary
    [1024, '1 KB'], // exact KB boundary
    [1024 * 1024, '1 MB'], // exact MB boundary
    [1024 ** 3, '1 GB'], // exact GB boundary
    [1024 ** 4, '1 TB'], // exact TB boundary
  ]
  for (const [input, expected] of cases) {
    it(`formatBytes(${input}) === '${expected}'`, () => {
      expect(formatBytes(input)).toBe(expected)
    })
  }
})

describe('formatDuration', () => {
  const cases: [number, string][] = [
    [0, '0ms'],
    [139.54545454545453, '140ms'], // fractional averages round to whole ms
    [999, '999ms'], // just below 1s boundary
    [1000, '1.0s'], // exact 1s boundary
    [59999, '60.0s'], // just below 1m boundary
    [60000, '1.0m'], // exact 1m boundary
  ]
  for (const [input, expected] of cases) {
    it(`formatDuration(${input}) === '${expected}'`, () => {
      expect(formatDuration(input)).toBe(expected)
    })
  }
})

describe('truncateText', () => {
  const cases: [string, number, string][] = [
    ['hello', 5, 'hello'], // exact length — no truncation
    ['hello', 6, 'hello'], // under length — no truncation
    ['hello!', 5, 'hello...'], // one over — truncated
    ['hello world', 5, 'hello...'], // well over — truncated
    ['', 5, ''], // empty string
  ]
  for (const [text, max, expected] of cases) {
    it(`truncateText('${text}', ${max}) === '${expected}'`, () => {
      expect(truncateText(text, max)).toBe(expected)
    })
  }
})

describe('formatTimestamp', () => {
  it('formats timestamp to HH:MM:SS with zero-padding', () => {
    const date = new Date(2024, 0, 1, 13, 5, 9)
    expect(formatTimestamp(date.getTime())).toBe('13:05:09')
  })

  it('zero-pads single-digit hours/minutes/seconds', () => {
    const date = new Date(2024, 0, 1, 1, 2, 3)
    expect(formatTimestamp(date.getTime())).toBe('01:02:03')
  })
})
