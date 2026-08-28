import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { serializeSession, type NetworkRequest } from 'hakka-core'

import { checkCommand, parseCiBaselineArgs, recordCommand } from '../ciBaseline'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: overrides.id ?? 'req-1',
    url: overrides.url ?? 'https://api.example.com/v1/items',
    method: overrides.method ?? 'GET',
    status: overrides.status ?? 200,
    startTime: 0,
    ...overrides,
  }
}

let dir: string
let originalExitCode: number | string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hakka-ci-baseline-test-'))
  originalExitCode = process.exitCode
  process.exitCode = undefined
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  process.exitCode = originalExitCode
})

describe('parseCiBaselineArgs', () => {
  test('parses mode, capture path, baseline path', () => {
    const parsed = parseCiBaselineArgs(['check', 'capture.hakka', 'baseline.txt'])
    expect(parsed.mode).toBe('check')
    expect(parsed.capturePath).toBe('capture.hakka')
    expect(parsed.baselinePath).toBe('baseline.txt')
    expect(parsed.allowHosts).toEqual([])
  })

  test('collects repeated --allow-host flags', () => {
    const parsed = parseCiBaselineArgs([
      'check',
      'capture.hakka',
      'baseline.txt',
      '--allow-host',
      'a.example.com',
      '--allow-host',
      'b.example.com',
    ])
    expect(parsed.allowHosts).toEqual(['a.example.com', 'b.example.com'])
  })

  test('mode is undefined for an unrecognized subcommand', () => {
    expect(parseCiBaselineArgs(['bogus']).mode).toBeUndefined()
  })

  test('a --allow-host (and its value) preceding the positional paths does not consume them', () => {
    const parsed = parseCiBaselineArgs([
      'check',
      '--allow-host',
      'trusted.example.com',
      'capture.hakka',
      'baseline.txt',
    ])
    expect(parsed.capturePath).toBe('capture.hakka')
    expect(parsed.baselinePath).toBe('baseline.txt')
    expect(parsed.allowHosts).toEqual(['trusted.example.com'])
  })
})

describe('recordCommand', () => {
  test('writes a baseline file from a capture', () => {
    const capturePath = join(dir, 'capture.hakka')
    const baselinePath = join(dir, 'baseline.txt')
    writeFileSync(capturePath, serializeSession([makeRequest()]))

    recordCommand(capturePath, baselinePath)

    expect(process.exitCode).toBe(0)
    const text = readFileSync(baselinePath, 'utf8')
    expect(text).toContain('hakkaCiBaseline')
    expect(text).toContain('api.example.com')
  })

  test('exits 2 when args are missing', () => {
    recordCommand(undefined, undefined)
    expect(process.exitCode).toBe(2)
  })

  test('exits 2 when the capture file is unreadable', () => {
    recordCommand(join(dir, 'missing.hakka'), join(dir, 'baseline.txt'))
    expect(process.exitCode).toBe(2)
  })
})

describe('checkCommand', () => {
  test('passes when the capture matches the recorded baseline', () => {
    const capturePath = join(dir, 'capture.hakka')
    const baselinePath = join(dir, 'baseline.txt')
    writeFileSync(capturePath, serializeSession([makeRequest()]))
    recordCommand(capturePath, baselinePath)
    process.exitCode = undefined

    const result = checkCommand(capturePath, baselinePath)
    expect(result?.pass).toBe(true)
    expect(process.exitCode).toBe(0)
  })

  test('fails when a new endpoint is called', () => {
    const capturePath = join(dir, 'capture.hakka')
    const baselinePath = join(dir, 'baseline.txt')
    writeFileSync(capturePath, serializeSession([makeRequest()]))
    recordCommand(capturePath, baselinePath)
    process.exitCode = undefined

    writeFileSync(
      capturePath,
      serializeSession([makeRequest(), makeRequest({ id: 'req-2', url: 'https://api.example.com/v1/other' })]),
    )
    const result = checkCommand(capturePath, baselinePath)
    expect(result?.pass).toBe(false)
    expect(process.exitCode).toBe(1)
    expect(result?.driftFindings.some((f) => f.kind === 'new-endpoint')).toBe(true)
  })

  test('fails when a request sends a credential-shaped field to a new host', () => {
    const capturePath = join(dir, 'capture.hakka')
    const baselinePath = join(dir, 'baseline.txt')
    writeFileSync(capturePath, serializeSession([makeRequest()]))
    recordCommand(capturePath, baselinePath)
    process.exitCode = undefined

    writeFileSync(
      capturePath,
      serializeSession([
        makeRequest(),
        makeRequest({
          id: 'req-2',
          url: 'https://evil.example.com/collect',
          method: 'POST',
          requestBody: JSON.stringify({ apiKey: 'sk-leaked' }),
        }),
      ]),
    )
    const result = checkCommand(capturePath, baselinePath)
    expect(result?.pass).toBe(false)
    expect(result?.exfiltrationFindings.length).toBeGreaterThan(0)
  })

  test('--allow-host widens the exfiltration allowlist without touching drift', () => {
    const capturePath = join(dir, 'capture.hakka')
    const baselinePath = join(dir, 'baseline.txt')
    writeFileSync(capturePath, serializeSession([makeRequest()]))
    recordCommand(capturePath, baselinePath)
    process.exitCode = undefined

    writeFileSync(
      capturePath,
      serializeSession([
        makeRequest(),
        makeRequest({
          id: 'req-2',
          url: 'https://trusted-partner.example.com/webhook',
          method: 'POST',
          requestBody: JSON.stringify({ apiKey: 'sk-not-actually-leaked' }),
        }),
      ]),
    )
    const result = checkCommand(capturePath, baselinePath, { allowHosts: ['trusted-partner.example.com'] })
    expect(result?.exfiltrationFindings).toEqual([])
    // The new endpoint itself is still a drift FAIL — allowlisting a host for
    // exfiltration purposes must not silently approve its contract drift too.
    expect(result?.pass).toBe(false)
    expect(result?.driftFindings.some((f) => f.kind === 'new-endpoint')).toBe(true)
  })

  test('exits 2 with a helpful message when no baseline exists yet', () => {
    const capturePath = join(dir, 'capture.hakka')
    writeFileSync(capturePath, serializeSession([makeRequest()]))
    const result = checkCommand(capturePath, join(dir, 'missing-baseline.txt'))
    expect(result).toBeUndefined()
    expect(process.exitCode).toBe(2)
  })

  test('exits 2 when args are missing', () => {
    checkCommand(undefined, undefined)
    expect(process.exitCode).toBe(2)
  })
})
