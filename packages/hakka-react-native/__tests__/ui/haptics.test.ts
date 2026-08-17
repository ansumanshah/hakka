// lightImpact() is a runtime probe for the optional `expo-haptics` peer —
// try/require, never a hard import, so bare React Native hosts (no Expo)
// never fail module resolution. Covers: silent no-op when the module truly
// isn't installed (real behavior in this workspace — expo-haptics is not a
// devDependency), firing through when it is, and never throwing even if the
// probed module's impactAsync itself rejects or throws synchronously.
describe('lightImpact', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('is a silent no-op when expo-haptics is not installed', () => {
    // No mock registered — require('expo-haptics') genuinely throws
    // MODULE_NOT_FOUND in this workspace, exercising the real fallback path.
    const { lightImpact } = require('../../src/ui/utils/haptics')
    expect(() => lightImpact()).not.toThrow()
  })

  it('calls impactAsync with ImpactFeedbackStyle.Light when expo-haptics is installed', () => {
    const impactAsync = jest.fn(() => Promise.resolve())
    jest.doMock('expo-haptics', () => ({ impactAsync, ImpactFeedbackStyle: { Light: 'light' } }), { virtual: true })

    const { lightImpact } = require('../../src/ui/utils/haptics')
    lightImpact()

    expect(impactAsync).toHaveBeenCalledTimes(1)
    expect(impactAsync).toHaveBeenCalledWith('light')
  })

  it('probes the module at most once across repeated calls (cached)', () => {
    const impactAsync = jest.fn(() => Promise.resolve())
    const mockRequire = jest.fn(() => ({ impactAsync, ImpactFeedbackStyle: { Light: 'light' } }))
    jest.doMock('expo-haptics', mockRequire, { virtual: true })

    const { lightImpact } = require('../../src/ui/utils/haptics')
    lightImpact()
    lightImpact()
    lightImpact()

    expect(impactAsync).toHaveBeenCalledTimes(3)
  })

  it('never throws even when impactAsync rejects', async () => {
    jest.doMock('expo-haptics', () => ({ impactAsync: () => Promise.reject(new Error('native failure')) }), {
      virtual: true,
    })

    const { lightImpact } = require('../../src/ui/utils/haptics')
    expect(() => lightImpact()).not.toThrow()
    // Let the rejected promise's .catch() run before the test exits.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('never throws when impactAsync itself throws synchronously', () => {
    jest.doMock(
      'expo-haptics',
      () => ({
        impactAsync: () => {
          throw new Error('synchronous native failure')
        },
      }),
      { virtual: true },
    )

    const { lightImpact } = require('../../src/ui/utils/haptics')
    expect(() => lightImpact()).not.toThrow()
  })

  it('treats a module without a real impactAsync function as not installed', () => {
    jest.doMock('expo-haptics', () => ({ notImpactAsync: () => {} }), { virtual: true })

    const { lightImpact } = require('../../src/ui/utils/haptics')
    expect(() => lightImpact()).not.toThrow()
  })
})
