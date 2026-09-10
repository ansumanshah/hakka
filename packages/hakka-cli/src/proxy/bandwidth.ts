/** Start-only network conditions for the managed mitmproxy sidecar.
 *
 * Bandwidth is measured in bytes per second and enforced per proxied TCP
 * connection by `bandwidth_relay.py`. HTTP/2 streams sharing a tunnel share its
 * configured rate. These values are intentionally immutable for a capture: a
 * changed profile requires stopping and starting the proxy.
 */
type ProxyBandwidthProfile = 'none' | 'slow-3g' | 'fast-3g' | 'slow-4g' | 'fast-4g' | 'offline' | 'custom'

export interface ProxyBandwidthConfig {
  profile: ProxyBandwidthProfile
  /** Simulated round-trip latency in milliseconds; the addon splits it across request and response headers. */
  latencyMs?: number
  uploadBytesPerSecond?: number
  downloadBytesPerSecond?: number
}

export interface ResolvedProxyBandwidth {
  profile: ProxyBandwidthProfile
  latencyMs: number
  uploadBytesPerSecond?: number
  downloadBytesPerSecond?: number
  offline: boolean
}

const KIB = 1024
const profiles: Record<Exclude<ProxyBandwidthProfile, 'custom'>, ResolvedProxyBandwidth> = {
  none: { profile: 'none', latencyMs: 0, offline: false },
  'slow-3g': {
    profile: 'slow-3g',
    latencyMs: 400,
    uploadBytesPerSecond: (400 * KIB) / 8,
    downloadBytesPerSecond: (400 * KIB) / 8,
    offline: false,
  },
  'fast-3g': {
    profile: 'fast-3g',
    latencyMs: 150,
    uploadBytesPerSecond: (750 * KIB) / 8,
    downloadBytesPerSecond: (1_600 * KIB) / 8,
    offline: false,
  },
  'slow-4g': {
    profile: 'slow-4g',
    latencyMs: 150,
    uploadBytesPerSecond: (3_000 * KIB) / 8,
    downloadBytesPerSecond: (4_000 * KIB) / 8,
    offline: false,
  },
  'fast-4g': {
    profile: 'fast-4g',
    latencyMs: 75,
    uploadBytesPerSecond: (9_000 * KIB) / 8,
    downloadBytesPerSecond: (9_000 * KIB) / 8,
    offline: false,
  },
  offline: { profile: 'offline', latencyMs: 0, offline: true },
}

const MAX_BYTES_PER_SECOND = 1024 * 1024 * 1024

function assertIntegerInRange(value: number | undefined, label: string, minimum: number, maximum: number): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`)
}

/** Validates and expands a public profile into the sidecar's exact start configuration. */
export function resolveProxyBandwidth(config: ProxyBandwidthConfig | undefined): ResolvedProxyBandwidth {
  if (!config) return profiles.none
  if (config.profile !== 'custom') {
    if (!Object.hasOwn(profiles, config.profile))
      throw new Error(`Unknown bandwidth profile: ${String(config.profile)}.`)
    if (
      config.latencyMs !== undefined ||
      config.uploadBytesPerSecond !== undefined ||
      config.downloadBytesPerSecond !== undefined
    )
      throw new Error(`${config.profile} does not accept custom latency or bandwidth values.`)
    return profiles[config.profile as Exclude<ProxyBandwidthProfile, 'custom'>]
  }
  assertIntegerInRange(config.latencyMs, 'Latency', 0, 30_000)
  assertIntegerInRange(config.uploadBytesPerSecond, 'Upload bandwidth', 1, MAX_BYTES_PER_SECOND)
  assertIntegerInRange(config.downloadBytesPerSecond, 'Download bandwidth', 1, MAX_BYTES_PER_SECOND)
  if (
    config.latencyMs === undefined &&
    config.uploadBytesPerSecond === undefined &&
    config.downloadBytesPerSecond === undefined
  )
    throw new Error('Custom bandwidth requires latency, upload bandwidth, or download bandwidth.')
  return {
    profile: 'custom',
    latencyMs: config.latencyMs ?? 0,
    uploadBytesPerSecond: config.uploadBytesPerSecond,
    downloadBytesPerSecond: config.downloadBytesPerSecond,
    offline: false,
  }
}

/** Environment shared by the addon and the relay process launched by the runner. */
export function bandwidthEnvironment(config: ProxyBandwidthConfig | undefined): Record<string, string> {
  const resolved = resolveProxyBandwidth(config)
  return {
    HAKKA_PROXY_BANDWIDTH_PROFILE: resolved.profile,
    HAKKA_PROXY_LATENCY_MS: String(resolved.latencyMs),
    HAKKA_PROXY_OFFLINE: resolved.offline ? '1' : '0',
    ...(resolved.uploadBytesPerSecond ? { HAKKA_PROXY_UPLOAD_BPS: String(resolved.uploadBytesPerSecond) } : {}),
    ...(resolved.downloadBytesPerSecond ? { HAKKA_PROXY_DOWNLOAD_BPS: String(resolved.downloadBytesPerSecond) } : {}),
  }
}
