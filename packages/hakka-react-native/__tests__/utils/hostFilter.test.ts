import { hostMatchesList, shouldCaptureUrl, matchesIgnoredPattern } from 'hakka-core'

describe('hostMatchesList', () => {
  it('matches suffix pattern', () => {
    expect(hostMatchesList('service.internal.example.com', ['.internal.example.com'])).toBe(true)
    expect(hostMatchesList('badinternal.example.com', ['.internal.example.com'])).toBe(false)
  })

  it('matches regex literal pattern', () => {
    expect(hostMatchesList('telemetry12.example.com', ['/^telemetry\\d+\\.example\\.com$/'])).toBe(true)
    expect(hostMatchesList('telemetry.example.com', ['/^telemetry\\d+\\.example\\.com$/'])).toBe(false)
  })

  it('returns false for empty list', () => {
    expect(hostMatchesList('api.example.com', [])).toBe(false)
  })

  it('matches any in list', () => {
    expect(hostMatchesList('cdn.example.com', ['api.example.com', 'cdn.example.com'])).toBe(true)
  })
})

describe('shouldCaptureUrl', () => {
  describe('blacklist mode', () => {
    const config = { mode: 'blacklist' as const, hosts: ['analytics.example.com', '*.ads.com'] }

    it('does not capture URL matching wildcard in blocklist', () => {
      expect(shouldCaptureUrl('https://pixel.ads.com/track', config)).toBe(false)
    })
  })

  describe('whitelist mode', () => {
    const config = { mode: 'whitelist' as const, hosts: ['api.example.com', '*.internal.com'] }

    it('captures URL matching wildcard allowlist', () => {
      expect(shouldCaptureUrl('https://service.internal.com/data', config)).toBe(true)
    })
  })
})

describe('matchesIgnoredPattern', () => {
  it('handles invalid regex gracefully (no throw)', () => {
    expect(() => matchesIgnoredPattern('https://api.example.com', ['[invalid'])).not.toThrow()
    expect(matchesIgnoredPattern('https://api.example.com', ['[invalid'])).toBe(false)
  })

  it('matches wildcard and regex literal URL patterns', () => {
    expect(matchesIgnoredPattern('https://cdn.example.com/debug/logs', ['https://*.example.com/debug/*'])).toBe(true)
    expect(matchesIgnoredPattern('https://api.example.com/private/42', ['/\\/private\\/\\d+/'])).toBe(true)
    expect(matchesIgnoredPattern('https://api.example.com/users', ['https://*.example.com/debug/*'])).toBe(false)
  })
})
