import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { serializeSession, type NetworkRequest } from 'hakka-core'

import { loadRequestsFromFile } from '../diagnose'
import { harToRequests, isHarPayload } from '../harLoad'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    status: 200,
    startTime: 0,
    ...overrides,
  }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hakka-diagnose-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadRequestsFromFile — .hakka session', () => {
  test('loads requests from a valid .hakka session file', () => {
    const requests = [makeRequest(), makeRequest({ id: 'req-2', status: 500, error: 'boom' })]
    const file = join(dir, 'session.hakka')
    writeFileSync(file, serializeSession(requests))

    const loaded = loadRequestsFromFile(file)
    expect(loaded).toHaveLength(2)
    expect(loaded[0]?.id).toBe('req-1')
    expect(loaded[1]?.status).toBe(500)
  })

  test('throws a clear error for a malformed .hakka file', () => {
    const file = join(dir, 'bad.hakka')
    writeFileSync(file, '{ "not": "a session" }')
    expect(() => loadRequestsFromFile(file)).toThrow(/hakkaSession/)
  })

  test('throws a clear error when the file does not exist', () => {
    expect(() => loadRequestsFromFile(join(dir, 'missing.hakka'))).toThrow(/could not read/)
  })
})

describe('loadRequestsFromFile — .har capture', () => {
  test('loads requests from a HAR 1.2 file', () => {
    const har = {
      log: {
        version: '1.2',
        creator: { name: 'test', version: '1.0' },
        entries: [
          {
            startedDateTime: '2026-01-01T00:00:00.000Z',
            time: 1234,
            request: {
              method: 'get',
              url: 'https://api.example.com/slow',
              headers: [{ name: 'X-Test', value: '1' }],
            },
            response: {
              status: 200,
              headers: [{ name: 'Content-Type', value: 'application/json' }],
              content: { size: 42, mimeType: 'application/json', text: '{"ok":true}' },
            },
          },
        ],
      },
    }
    const file = join(dir, 'capture.har')
    writeFileSync(file, JSON.stringify(har))

    const loaded = loadRequestsFromFile(file)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.method).toBe('GET')
    expect(loaded[0]?.url).toBe('https://api.example.com/slow')
    expect(loaded[0]?.duration).toBe(1234)
    expect(loaded[0]?.status).toBe(200)
    expect(loaded[0]?.responseBody).toBe('{"ok":true}')
  })

  test('throws a clear error for invalid JSON in a .har file', () => {
    const file = join(dir, 'bad.har')
    writeFileSync(file, 'not json')
    expect(() => loadRequestsFromFile(file)).toThrow(/not valid JSON/)
  })

  test('throws a clear error when .har file lacks log.entries', () => {
    const file = join(dir, 'bad-shape.har')
    writeFileSync(file, JSON.stringify({ notLog: true }))
    expect(() => loadRequestsFromFile(file)).toThrow(/does not look like a HAR file/)
  })
})

describe('loadRequestsFromFile — unknown extension sniffing', () => {
  test('sniffs a HAR payload from an unrecognized extension', () => {
    const har = { log: { entries: [{ request: { method: 'GET', url: 'https://x.test/y' }, response: {} }] } }
    const file = join(dir, 'capture.json')
    writeFileSync(file, JSON.stringify(har))
    const loaded = loadRequestsFromFile(file)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.url).toBe('https://x.test/y')
  })

  test('sniffs a .hakka session from an unrecognized extension', () => {
    const requests = [makeRequest()]
    const file = join(dir, 'session.json')
    writeFileSync(file, serializeSession(requests))
    const loaded = loadRequestsFromFile(file)
    expect(loaded).toHaveLength(1)
  })
})

describe('harToRequests / isHarPayload', () => {
  test('isHarPayload rejects non-HAR shapes', () => {
    expect(isHarPayload(null)).toBe(false)
    expect(isHarPayload({})).toBe(false)
    expect(isHarPayload({ log: {} })).toBe(false)
    expect(isHarPayload({ log: { entries: [] } })).toBe(true)
  })

  test('harToRequests handles missing optional fields gracefully', () => {
    const requests = harToRequests({ log: { entries: [{}] } })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('GET')
    expect(requests[0]?.url).toBe('')
    expect(requests[0]?.status).toBeNull()
  })
})
