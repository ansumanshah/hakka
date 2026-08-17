import { formatBytes, formatCount, formatFps, formatMs, formatPercent } from '../../src/ui/utils/format'

describe('monitor value formatting', () => {
  it('formats compact monitor values', () => {
    expect(formatCount(1530)).toBe('1.5K')
    expect(formatFps(59.7)).toBe('60 fps')
    expect(formatBytes(367.35 * 1024 * 1024)).toBe('367.35 MB')
    expect(formatMs(null)).toBe('--')
    expect(formatMs(1200)).toBe('1.2s')
    expect(formatPercent(0.075)).toBe('8%')
  })
})
