import { describe, expect, test } from 'bun:test'

import { DEFAULT_CONFIG } from '../types'

// DEFAULT_CONFIG is the contract every platform merges its own config on top
// of — a silent change here changes production behavior everywhere at once.
// These are regression guards on the default values themselves.
describe('DEFAULT_CONFIG — contract', () => {
  test('maxRequests defaults to 500', () => {
    expect(DEFAULT_CONFIG.maxRequests).toBe(500)
  })

  test('maxBodySize defaults to 256 KB (262144 bytes)', () => {
    expect(DEFAULT_CONFIG.maxBodySize).toBe(262144)
  })

  test('maxBufferBytes defaults to 16 MB', () => {
    expect(DEFAULT_CONFIG.maxBufferBytes).toBe(16 * 1024 * 1024)
  })

  test('maxAge defaults to 86400 seconds (24h)', () => {
    expect(DEFAULT_CONFIG.maxAge).toBe(86_400)
  })

  test('persistence is opt-in via setStorageAdapter — no config flag exists for it', () => {
    // Persistence activates ONLY via Hakka.setStorageAdapter(), never a config flag.
    expect('persist' in DEFAULT_CONFIG).toBe(false)
  })

  test('redactHeaders defaults to the auth/cookie set, with no duplicates', () => {
    expect(DEFAULT_CONFIG.redactHeaders).toEqual(['authorization', 'proxy-authorization', 'cookie', 'set-cookie'])
    expect(new Set(DEFAULT_CONFIG.redactHeaders).size).toBe(DEFAULT_CONFIG.redactHeaders.length)
  })

  test('ignoreHosts and ignorePatterns default to empty — core applies no filtering out of the box', () => {
    expect(DEFAULT_CONFIG.ignoreHosts).toEqual([])
    expect(DEFAULT_CONFIG.ignorePatterns).toEqual([])
  })

  test('ignoreHosts and ignorePatterns are distinct array instances, not an aliased shared reference', () => {
    expect(DEFAULT_CONFIG.ignoreHosts).not.toBe(DEFAULT_CONFIG.ignorePatterns)
  })
})
