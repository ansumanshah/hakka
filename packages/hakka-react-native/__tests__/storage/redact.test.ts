import { configureBodyRedaction } from 'hakka-core'

import { redactStorageEntries, redactStorageValue } from '../../src/storage/redact'

/**
 * Shared storage-value redaction, used by the storage monitors
 * (`monitors/storage.ts`), the live Storage tab (`StorageViewer.tsx`), and
 * the bridge's on-connect storage publisher (`core/HakkaBridge.ts`). Storage
 * is where auth tokens and credentials are *persisted*, not merely where
 * they transit, so every path that can put a stored value on the wire must
 * run it through this first.
 */
describe('redactStorageValue', () => {
  afterEach(() => configureBodyRedaction([]))

  it('passes values through untouched when nothing is configured', () => {
    expect(redactStorageValue('auth_token', 'sk-live-abc')).toBe('sk-live-abc')
  })

  it('blanks a value whose key names a sensitive field', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('token', 'sk-live-abc')).toBe('[REDACTED]')
  })

  it('matches a namespaced key by substring, since real keys are namespaced', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('@myapp:auth_token', 'sk-live-abc')).toBe('[REDACTED]')
  })

  it('is case-insensitive on the key', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('AUTH_TOKEN', 'sk-live-abc')).toBe('[REDACTED]')
  })

  it('leaves an unrelated key alone', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('theme', 'dark')).toBe('dark')
  })

  it('redacts sensitive fields inside a stored JSON blob', () => {
    configureBodyRedaction(['password'])

    const stored = JSON.stringify({ user: 'ada', password: 'hunter2' })
    const result = redactStorageValue('session', stored) as string

    expect(result).not.toContain('hunter2')
    expect(result).toContain('ada')
  })

  it('leaves a non-JSON string alone when the key is not sensitive', () => {
    configureBodyRedaction(['password'])

    expect(redactStorageValue('greeting', 'hello world')).toBe('hello world')
  })

  it('passes null and undefined through', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('token', null)).toBeNull()
    expect(redactStorageValue('token', undefined)).toBeUndefined()
  })

  it('does not stringify a non-string value it cannot inspect', () => {
    configureBodyRedaction(['password'])

    expect(redactStorageValue('count', 42)).toBe(42)
  })
})

describe('redactStorageEntries', () => {
  afterEach(() => configureBodyRedaction([]))

  it('returns the same object reference when nothing is configured — a no-op, not a copy', () => {
    const entries = { theme: 'dark' }
    expect(redactStorageEntries(entries)).toBe(entries)
  })

  it('redacts only the entries whose key matches, leaving the rest as-is', () => {
    configureBodyRedaction(['token'])

    const entries = { authToken: 'sk-live-abc', theme: 'dark' }
    expect(redactStorageEntries(entries)).toEqual({ authToken: '[REDACTED]', theme: 'dark' })
  })

  it('does not mutate the input map', () => {
    configureBodyRedaction(['token'])

    const entries = { authToken: 'sk-live-abc' }
    redactStorageEntries(entries)
    expect(entries.authToken).toBe('sk-live-abc')
  })

  it('handles an empty entries map', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageEntries({})).toEqual({})
  })
})
