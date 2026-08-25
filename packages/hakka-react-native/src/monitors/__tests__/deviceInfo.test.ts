/**
 * getDefaultDeviceInfo — `deviceId` must be stable across calls within the
 * same app run, not re-randomized every time. `SettingsViewModel` and
 * `SettingsPanel` both call this on every registration/export, so a fresh
 * id per call would present a different device identity each time and break
 * device correlation on the desktop. See `deviceInfo.ts`.
 */
import type { getDefaultDeviceInfo as GetDefaultDeviceInfo } from '../deviceInfo'

function freshModule(): { getDefaultDeviceInfo: typeof GetDefaultDeviceInfo } {
  jest.resetModules()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../deviceInfo')
}

describe('getDefaultDeviceInfo', () => {
  it('returns the same deviceId on repeated calls within the same run', () => {
    const { getDefaultDeviceInfo } = freshModule()
    const first = getDefaultDeviceInfo()
    const second = getDefaultDeviceInfo()
    const third = getDefaultDeviceInfo('Custom Name')

    expect(second.deviceId).toBe(first.deviceId)
    expect(third.deviceId).toBe(first.deviceId)
  })

  it('varies deviceId across separate app runs (fresh module instance)', () => {
    const { getDefaultDeviceInfo: run1 } = freshModule()
    const { getDefaultDeviceInfo: run2 } = freshModule()

    expect(run1().deviceId).not.toBe(run2().deviceId)
  })
})
