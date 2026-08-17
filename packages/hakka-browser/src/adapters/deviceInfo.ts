export interface WebDeviceInfo {
  platform: 'web'
  userAgent: string
  language: string
  screen: { width: number; height: number; dpr: number }
  online: boolean
}

/** Best-effort device/environment info from the browser's navigator/screen. */
export function getWebDeviceInfo(): WebDeviceInfo {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const scr = typeof screen !== 'undefined' ? screen : undefined
  return {
    platform: 'web',
    userAgent: nav?.userAgent ?? '',
    language: nav?.language ?? '',
    screen: {
      width: scr?.width ?? 0,
      height: scr?.height ?? 0,
      dpr: typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
    },
    online: typeof nav?.onLine === 'boolean' ? nav.onLine : true,
  }
}

export interface SystemInfoRow {
  label: string
  value: string
}

/**
 * Returns a flat key/value list for display in the Info tab.
 * SSR-safe (returns empty string for unavailable values).
 */
export function getSystemInfo(): SystemInfoRow[] {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const win = typeof window !== 'undefined' ? window : undefined
  const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1
  const iw = win?.innerWidth ?? 0
  const ih = win?.innerHeight ?? 0

  return [
    { label: 'User Agent', value: nav?.userAgent ?? '' },
    { label: 'Platform', value: (nav as (Navigator & { platform?: string }) | undefined)?.platform ?? '' },
    { label: 'Language', value: nav?.language ?? '' },
    { label: 'Viewport', value: iw > 0 ? `${iw}×${ih} @${dpr}x` : '' },
    { label: 'Online', value: typeof nav?.onLine === 'boolean' ? (nav.onLine ? 'Yes' : 'No') : 'Unknown' },
    {
      label: 'Cookies Enabled',
      value: typeof nav?.cookieEnabled === 'boolean' ? (nav.cookieEnabled ? 'Yes' : 'No') : 'Unknown',
    },
    { label: 'URL', value: win?.location?.href ?? '' },
  ]
}
