import { darkColors, lightColors } from '../../src/ui/styles/tokens'
import { getRowSeverity } from '../../src/ui/utils/rowSeverity'

// An error/4xx/5xx row must show BOTH the edge stripe AND a subtle
// error-tinted row background, matching iOS (Android draws stripe-only).
// These tests pin that both signals fire together, not just one.
describe('getRowSeverity', () => {
  it.each([darkColors, lightColors])('2xx success: no stripe, no background tint', (colors) => {
    const result = getRowSeverity({ error: undefined, status: 200 }, false, colors)
    expect(result).toEqual({ stripeColor: 'transparent', rowBackground: undefined })
  })

  it.each([darkColors, lightColors])('pending (no status, no error): no stripe, no background tint', (colors) => {
    const result = getRowSeverity({ error: undefined, status: undefined }, false, colors)
    expect(result).toEqual({ stripeColor: 'transparent', rowBackground: undefined })
  })

  it.each([darkColors, lightColors])('4xx: turmeric stripe AND the chili background tint', (colors) => {
    const result = getRowSeverity({ error: undefined, status: 404 }, false, colors)
    expect(result.stripeColor).toBe(colors.turmeric)
    expect(result.rowBackground).toBe(colors.chili + '14')
  })

  it.each([darkColors, lightColors])('5xx: chili stripe AND the chili background tint', (colors) => {
    const result = getRowSeverity({ error: undefined, status: 503 }, false, colors)
    expect(result.stripeColor).toBe(colors.chili)
    expect(result.rowBackground).toBe(colors.chili + '14')
  })

  it.each([darkColors, lightColors])(
    'network error (no status): chili stripe AND the chili background tint',
    (colors) => {
      const result = getRowSeverity({ error: 'ENOTFOUND', status: undefined }, false, colors)
      expect(result.stripeColor).toBe(colors.chili)
      expect(result.rowBackground).toBe(colors.chili + '14')
    },
  )

  it.each([darkColors, lightColors])('error coexisting with a 200 status still tints (error always wins)', (colors) => {
    const result = getRowSeverity({ error: 'stream aborted', status: 200 }, false, colors)
    expect(result.stripeColor).toBe(colors.chili)
    expect(result.rowBackground).toBe(colors.chili + '14')
  })

  it.each([darkColors, lightColors])('selected takes priority over any status/error severity', (colors) => {
    const result = getRowSeverity({ error: 'boom', status: 500 }, true, colors)
    expect(result.stripeColor).toBe(colors.accent)
    expect(result.rowBackground).toBe(colors.accent + '17')
  })

  it('never returns a raw hex literal for the stripe outside token values or the transparent sentinel', () => {
    const cases: { error?: string; status?: number }[] = [
      { status: 200 },
      { status: 404 },
      { status: 500 },
      { error: 'x' },
    ]
    const tokenValues = new Set(Object.values(darkColors))
    for (const c of cases) {
      const { stripeColor } = getRowSeverity(c, false, darkColors)
      expect(stripeColor === 'transparent' || tokenValues.has(stripeColor)).toBe(true)
    }
  })
})
