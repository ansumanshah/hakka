import { darkColors, lightColors } from '../../src/ui/styles/tokens'
import { getStatusGroupColors } from '../../src/ui/utils/statusColors'

// getStatusGroupColors must resolve every status-class filter chip ('all' |
// '1xx'..'5xx') to a semantic Wok Hei token — never a raw/hardcoded hex —
// and must survive both theme grounds (dark/light), matching the web
// reference's STATUS_TONES mapping in Inspector.tsx.
describe('getStatusGroupColors', () => {
  it.each([darkColors, lightColors])('maps 1xx to the pending token', (colors) => {
    expect(getStatusGroupColors('1xx', colors)).toEqual({ bg: colors.pending, text: colors.background })
  })

  it.each([darkColors, lightColors])('maps 2xx to the jade (success) token', (colors) => {
    expect(getStatusGroupColors('2xx', colors)).toEqual({ bg: colors.jade, text: colors.background })
  })

  it.each([darkColors, lightColors])('maps 3xx to the steel (info) token', (colors) => {
    expect(getStatusGroupColors('3xx', colors)).toEqual({ bg: colors.info, text: colors.background })
  })

  it.each([darkColors, lightColors])('maps 4xx to the turmeric (warning) token', (colors) => {
    expect(getStatusGroupColors('4xx', colors)).toEqual({ bg: colors.turmeric, text: colors.background })
  })

  it.each([darkColors, lightColors])('maps 5xx to the chili (error) token', (colors) => {
    expect(getStatusGroupColors('5xx', colors)).toEqual({ bg: colors.chili, text: colors.background })
  })

  it.each([darkColors, lightColors])('maps "all" to a neutral token, not a hardcoded hex', (colors) => {
    expect(getStatusGroupColors('all', colors)).toEqual({ bg: colors.textMuted, text: colors.background })
  })

  it('never returns a raw hex literal outside the generated token values', () => {
    const groups = ['all', '1xx', '2xx', '3xx', '4xx', '5xx']
    const tokenValues = new Set(Object.values(darkColors))
    for (const g of groups) {
      const { bg, text } = getStatusGroupColors(g, darkColors)
      expect(tokenValues.has(bg)).toBe(true)
      expect(tokenValues.has(text)).toBe(true)
    }
  })
})
