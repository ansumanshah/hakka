import { expect, test } from 'bun:test'

import { bandwidthEnvironment, resolveProxyBandwidth } from '../bandwidth'

test('expands the fast 3G profile into separate byte-per-second directions', () => {
  expect(resolveProxyBandwidth({ profile: 'fast-3g' })).toEqual({
    profile: 'fast-3g',
    latencyMs: 150,
    uploadBytesPerSecond: 96_000,
    downloadBytesPerSecond: 204_800,
    offline: false,
  })
})

test('accepts a bounded custom one-way bandwidth condition', () => {
  expect(bandwidthEnvironment({ profile: 'custom', latencyMs: 25, downloadBytesPerSecond: 1_024 })).toEqual({
    HAKKA_PROXY_BANDWIDTH_PROFILE: 'custom',
    HAKKA_PROXY_LATENCY_MS: '25',
    HAKKA_PROXY_OFFLINE: '0',
    HAKKA_PROXY_DOWNLOAD_BPS: '1024',
  })
})

test('rejects a custom profile with no condition or a preset with overrides', () => {
  expect(() => resolveProxyBandwidth({ profile: 'custom' })).toThrow('Custom bandwidth requires')
  expect(() => resolveProxyBandwidth({ profile: 'slow-3g', latencyMs: 1 })).toThrow('does not accept')
  expect(() => resolveProxyBandwidth({ profile: 'satellite' as 'custom' })).toThrow('Unknown bandwidth profile')
})
