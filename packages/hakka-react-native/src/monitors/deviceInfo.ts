/**
 * Device info utility — builds a device descriptor from React Native
 * Platform API for registration with the Hakka desktop companion.
 */
import { Platform } from 'react-native'

export interface DeviceInfo {
  deviceName: string
  deviceId: string
  platform: 'ios' | 'android' | 'web'
  extraDeviceInfo?: Record<string, string>
}

// Generated once per app run and reused by every call — otherwise a caller
// that builds DeviceInfo per registration/reconnect (SettingsViewModel,
// SettingsPanel's export) would present a different identity each time,
// breaking device correlation on the desktop.
let cachedDeviceId: string | null = null

/**
 * Build a default DeviceInfo from the current React Native Platform.
 * Optionally pass a custom device name.
 */
export function getDefaultDeviceInfo(customDeviceName?: string): DeviceInfo {
  const platform: 'ios' | 'android' | 'web' = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web'

  if (!cachedDeviceId) {
    cachedDeviceId = `device-${platform}-${Math.random().toString(36).substr(2, 9)}`
  }
  const deviceId = cachedDeviceId

  return {
    deviceName: customDeviceName ?? `${platform.charAt(0).toUpperCase() + platform.slice(1)} Device`,
    deviceId,
    platform,
    extraDeviceInfo: {
      os: platform,
      version: String(Platform.Version ?? '1.0.0'),
    },
  }
}
