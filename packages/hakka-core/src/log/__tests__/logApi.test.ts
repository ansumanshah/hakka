import { beforeEach, describe, expect, test } from 'bun:test'

import { configureBodyRedaction } from '../../utils/bodyRedaction'
import { log, logDebug, logError, logInfo, logWarn } from '../logApi'
import { logStore } from '../LogStore'

beforeEach(() => {
  // Reset shared module-level state between tests.
  configureBodyRedaction([])
  logStore.clear()
})

describe('log() — basic entry shape', () => {
  test('produces an entry with id/timestamp/level/message', () => {
    log('info', 'hello world')
    const [entry] = logStore.getEntries()
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('info')
    expect(entry?.message).toBe('hello world')
    expect(typeof entry?.timestamp).toBe('number')
    expect(entry?.id).toMatch(/^log_\d+_\d+$/)
  })

  test('ids are unique and increasing across calls', () => {
    log('info', 'first')
    log('info', 'second')
    const [first, second] = logStore.getEntries()
    expect(first?.id).not.toBe(second?.id)
  })

  test('category and metadata are attached when provided', () => {
    log('warn', 'careful', { category: 'auth', metadata: { userId: 42 } })
    const [entry] = logStore.getEntries()
    expect(entry?.category).toBe('auth')
    expect(entry?.metadata).toEqual({ userId: 42 })
  })

  test('category/metadata are omitted (not just undefined-valued) when not provided', () => {
    log('info', 'plain')
    const [entry] = logStore.getEntries()
    expect(entry).toBeDefined()
    expect('category' in (entry as object)).toBe(false)
    expect('metadata' in (entry as object)).toBe(false)
  })
})

describe('logDebug/logInfo/logWarn/logError — convenience wrappers', () => {
  test('each sets the correct level', () => {
    logDebug('d')
    logInfo('i')
    logWarn('w')
    logError('e')
    const levels = logStore.getEntries().map((e) => e.level)
    expect(levels).toEqual(['debug', 'info', 'warn', 'error'])
  })

  test('convenience wrappers forward options', () => {
    logError('boom', { category: 'payments', metadata: { code: 500 } })
    const [entry] = logStore.getEntries()
    expect(entry?.category).toBe('payments')
    expect(entry?.metadata).toEqual({ code: 500 })
  })
})

describe('log() — metadata redaction', () => {
  test('redacts configured sensitive fields inside metadata', () => {
    configureBodyRedaction(['password'])
    log('info', 'login attempt', { metadata: { username: 'alice', password: 'hunter2' } })
    const [entry] = logStore.getEntries()
    expect(entry?.metadata?.password).toBe('[REDACTED]')
    expect(entry?.metadata?.username).toBe('alice')
  })

  test('redacts nested sensitive fields inside metadata', () => {
    configureBodyRedaction(['secret'])
    log('info', 'nested', { metadata: { user: { credentials: { secret: 'shh', name: 'bob' } } } })
    const [entry] = logStore.getEntries()
    const metadata = entry?.metadata as { user: { credentials: { secret: string; name: string } } }
    expect(metadata.user.credentials.secret).toBe('[REDACTED]')
    expect(metadata.user.credentials.name).toBe('bob')
  })

  test('no-op when no redaction fields configured', () => {
    log('info', 'no redaction', { metadata: { password: 'plain' } })
    const [entry] = logStore.getEntries()
    expect(entry?.metadata?.password).toBe('plain')
  })

  test('does not redact fields that are not configured', () => {
    configureBodyRedaction(['password'])
    log('info', 'unrelated field', { metadata: { token: 'abc123' } })
    const [entry] = logStore.getEntries()
    expect(entry?.metadata?.token).toBe('abc123')
  })
})

describe('log() — never throws', () => {
  test('circular metadata (with redaction configured, forcing JSON.stringify) does not throw', () => {
    // Redaction must be configured — otherwise redactMetadata short-circuits before
    // ever calling JSON.stringify, and this test wouldn't exercise the throwing path.
    configureBodyRedaction(['password'])
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    expect(() => log('info', 'circular', { metadata: circular })).not.toThrow()
  })

  test('throwing listener does not prevent future log calls, still no throw', () => {
    const off = logStore.subscribe(() => {
      throw new Error('listener boom')
    })
    expect(() => log('info', 'should not throw')).not.toThrow()
    off()
  })
})
