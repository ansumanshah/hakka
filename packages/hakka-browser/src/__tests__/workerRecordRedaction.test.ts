import type { NetworkRequest } from 'hakka-core'
import { describe, expect, test } from 'vitest'

import { redactWorkerRecord } from '../workerCapture'

const record = (over: Partial<NetworkRequest> = {}): NetworkRequest =>
  ({
    id: 'w1',
    url: 'https://api.example.com/login',
    method: 'POST',
    startTime: 1,
    status: 200,
    requestHeaders: { 'x-api-key': 'k-123', accept: 'application/json' },
    responseHeaders: { 'set-cookie': 'sid=abc' },
    requestBody: '{"password":"hunter2","user":"a"}',
    responseBody: '{"token":"t-9","ok":true}',
    ...over,
  }) as NetworkRequest

// A worker runs its own module copy of hakka-core, so the host's redaction
// settings never reach it. The main thread re-applies them when it ingests.
describe('redactWorkerRecord', () => {
  test('applies the host header list and body fields to a worker record', () => {
    const out = redactWorkerRecord(record(), ['x-api-key', 'set-cookie'], ['password', 'token'])
    expect(out.requestHeaders?.['x-api-key']).toBe('[REDACTED]')
    expect(out.requestHeaders?.accept).toBe('application/json')
    expect(out.responseHeaders?.['set-cookie']).toBe('[REDACTED]')
    expect(out.requestBody).not.toContain('hunter2')
    expect(out.requestBody).toContain('"user":"a"')
    expect(out.responseBody).not.toContain('t-9')
  })

  test('leaves records without bodies or headers alone', () => {
    const out = redactWorkerRecord(
      record({ requestBody: undefined, responseBody: undefined, requestHeaders: undefined }),
      ['x-api-key'],
      ['password'],
    )
    expect(out.requestBody).toBeUndefined()
    expect(out.requestHeaders).toBeUndefined()
  })
})
