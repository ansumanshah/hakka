import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serializeSession, type NetworkRequest } from 'hakka-core'

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts')
const SECRET = 'sk-report-secret-928374'

function request(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'request-1',
    url: 'https://api.example.com/items',
    method: 'GET',
    status: 200,
    startTime: 0,
    ...overrides,
  }
}

function run(args: string[]) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8' })
  expect(result.stderr).toBe('')
  expect(() => JSON.parse(result.stdout)).not.toThrow()
  expect(result.stdout.trim().split('\n')).toHaveLength(1)
  expect(result.stdout).not.toContain('\x1b[')
  return { status: result.status, report: JSON.parse(result.stdout) as Record<string, unknown>, stdout: result.stdout }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hakka-json-report-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('real CLI JSON reports', () => {
  test('assert emits one stable document for pass and failure', () => {
    const capture = join(dir, 'capture.hakka')
    writeFileSync(capture, serializeSession([request()]))
    const passing = run(['assert', capture, '--json'])
    expect(passing.status).toBe(0)
    expect(passing.report).toMatchObject({ schemaVersion: 1, command: 'assert', pass: true, exitCode: 0 })

    writeFileSync(capture, serializeSession([request({ status: 500 })]))
    const failing = run(['assert', capture, '--json'])
    expect(failing.status).toBe(1)
    expect(failing.report).toMatchObject({ pass: false, exitCode: 1 })
    expect(failing.report.violations).toEqual([{ rule: 'max-failures', actual: 1, limit: 0 }])
  })

  test('assert supports equivalent HAR input', () => {
    const capture = join(dir, 'capture.har')
    writeFileSync(
      capture,
      JSON.stringify({
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1' },
          entries: [
            {
              startedDateTime: '2026-01-01T00:00:00.000Z',
              time: 10,
              request: { method: 'GET', url: 'https://api.example.com/items', headers: [], queryString: [] },
              response: { status: 200, statusText: 'OK', headers: [], content: { size: 0, mimeType: 'text/plain' } },
              cache: {},
              timings: { send: 0, wait: 10, receive: 0 },
            },
          ],
        },
      }),
    )
    expect(run(['assert', capture, '--json']).report).toMatchObject({ command: 'assert', pass: true, exitCode: 0 })
  })

  test('usage and malformed inputs return exit 2 without leaking paths', () => {
    const missingPath = join(dir, `missing-${SECRET}.hakka`)
    const missing = run(['assert', '--json'])
    expect(missing.status).toBe(2)
    expect(missing.report).toMatchObject({ error: { code: 'MISSING_CAPTURE_PATH' }, exitCode: 2 })

    const unreadable = run(['assert', missingPath, '--json'])
    expect(unreadable.status).toBe(2)
    expect(unreadable.stdout).not.toContain(SECRET)

    const malformed = join(dir, `malformed-${SECRET}.hakka`)
    writeFileSync(malformed, '{broken')
    const badCapture = run(['assert', malformed, '--json'])
    expect(badCapture.status).toBe(2)
    expect(badCapture.stdout).not.toContain(SECRET)
  })

  test('human missing-path usage remains on stdout', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, 'assert'], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toBe('')
  })

  test('ci-baseline check reports pass, drift, and bad baseline inputs', () => {
    const capture = join(dir, 'capture.hakka')
    const baseline = join(dir, 'baseline.txt')
    writeFileSync(capture, serializeSession([request()]))
    const recorded = spawnSync(process.execPath, [CLI_PATH, 'ci-baseline', 'record', capture, baseline], {
      encoding: 'utf8',
    })
    expect(recorded.status).toBe(0)

    expect(run(['ci-baseline', 'check', capture, baseline, '--json']).report).toMatchObject({
      command: 'ci-baseline check',
      pass: true,
      exitCode: 0,
    })

    writeFileSync(
      capture,
      serializeSession([
        request({ id: 'query', url: `https://query.example.com/${SECRET}?token=${SECRET}` }),
        request({
          id: 'body',
          url: `https://body.example.com/${SECRET}`,
          method: 'POST',
          requestBody: JSON.stringify({ apiKey: SECRET }),
        }),
        request({
          id: 'header',
          url: `https://header.example.com/${SECRET}`,
          requestHeaders: { authorization: `Bearer ${SECRET}` },
        }),
      ]),
    )
    const drift = run(['ci-baseline', 'check', capture, baseline, '--json'])
    expect(drift.status).toBe(1)
    expect(drift.report).toMatchObject({ pass: false, exitCode: 1 })
    expect(drift.stdout).not.toContain(SECRET)
    expect(drift.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'query-param' }),
        expect.objectContaining({ reason: 'request-body-field' }),
        expect.objectContaining({ reason: 'authorization-header' }),
      ]),
    )
    expect(run(['ci-baseline', 'check', capture, baseline, '--json']).stdout).toBe(drift.stdout)

    writeFileSync(baseline, `malformed baseline ${SECRET}`)
    const malformedBaseline = run(['ci-baseline', 'check', capture, baseline, '--json'])
    expect(malformedBaseline.status).toBe(2)
    expect(malformedBaseline.report).toMatchObject({ error: { code: 'BASELINE_INVALID' }, exitCode: 2 })
    expect(malformedBaseline.stdout).not.toContain(SECRET)
  })

  test('report projection cannot expose captured secret surfaces', () => {
    const capture = join(dir, 'secret.hakka')
    writeFileSync(
      capture,
      serializeSession([
        request({
          url: `https://api.example.com/${SECRET}?token=${SECRET}`,
          status: 500,
          error: `failed with ${SECRET}`,
          requestHeaders: { authorization: `Bearer ${SECRET}` },
          requestBody: JSON.stringify({ password: SECRET, nested: SECRET }),
        }),
      ]),
    )
    const result = run(['assert', capture, '--fail-on-secrets', '--json'])
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain(SECRET)
    expect(result.report.redaction).toEqual({ applied: true })
  })

  test('report projection removes attacker-controlled query names', () => {
    const capture = join(dir, 'secret-query-name.hakka')
    writeFileSync(capture, serializeSession([request({ url: `https://api.example.com/items?${SECRET}=value` })]))
    const result = run(['assert', capture, '--json'])
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain(SECRET)
  })
})
