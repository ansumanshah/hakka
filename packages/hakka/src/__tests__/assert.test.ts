import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { analyzeRequests, serializeSession, type NetworkRequest } from 'hakka-core'

import { assertCommand, computeP95DurationMs, evaluateAssertions, parseAssertArgs } from '../assert'

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
let originalExitCode: number | string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hakka-assert-test-'))
  originalExitCode = process.exitCode
  process.exitCode = undefined
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  process.exitCode = originalExitCode
})

describe('parseAssertArgs', () => {
  test('defaults max-failures to 0 and leaves the rest undefined', () => {
    const { filePath, options } = parseAssertArgs(['session.hakka'])
    expect(filePath).toBe('session.hakka')
    expect(options.maxFailures).toBe(0)
    expect(options.maxDurationMs).toBeUndefined()
    expect(options.failOnSecrets).toBe(false)
    expect(options.budgetP95Ms).toBeUndefined()
  })

  test('parses all flags', () => {
    const { filePath, options } = parseAssertArgs([
      'session.hakka',
      '--max-failures',
      '2',
      '--max-duration-ms',
      '500',
      '--fail-on-secrets',
      '--budget-p95-ms',
      '800',
    ])
    expect(filePath).toBe('session.hakka')
    expect(options.maxFailures).toBe(2)
    expect(options.maxDurationMs).toBe(500)
    expect(options.failOnSecrets).toBe(true)
    expect(options.budgetP95Ms).toBe(800)
  })

  test('finds the file path when a boolean flag comes first', () => {
    const { filePath } = parseAssertArgs(['--fail-on-secrets', 'capture.har'])
    expect(filePath).toBe('capture.har')
  })
})

describe('computeP95DurationMs', () => {
  test('returns undefined when no requests have a duration', () => {
    expect(computeP95DurationMs([makeRequest({ duration: null })])).toBeUndefined()
  })

  test('computes p95 over timed requests', () => {
    const requests = Array.from({ length: 20 }, (_, i) => makeRequest({ id: `r${i}`, duration: i + 1 }))
    // durations 1..20, p95 (nearest-rank) -> ceil(0.95*20)=19th value => 19
    expect(computeP95DurationMs(requests)).toBe(19)
  })
})

describe('evaluateAssertions', () => {
  test('no violations for a clean session', () => {
    const requests = [makeRequest(), makeRequest({ id: 'req-2', duration: 100 })]
    const diagnosis = analyzeRequests(requests)
    const violations = evaluateAssertions(requests, diagnosis, { maxFailures: 0 })
    expect(violations).toEqual([])
  })

  test('max-failures violated by a 500', () => {
    const requests = [makeRequest({ id: 'req-2', status: 500 })]
    const diagnosis = analyzeRequests(requests)
    const violations = evaluateAssertions(requests, diagnosis, { maxFailures: 0 })
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('max-failures')
  })

  test('max-duration-ms flags a slow request', () => {
    const requests = [makeRequest({ duration: 2000 })]
    const diagnosis = analyzeRequests(requests)
    const violations = evaluateAssertions(requests, diagnosis, { maxFailures: 0, maxDurationMs: 1000 })
    expect(violations.some((v) => v.rule === 'max-duration-ms')).toBe(true)
  })

  test('fail-on-secrets triggers on a leaked body', () => {
    const requests = [makeRequest({ requestBody: '{"password":"hunter2"}' })]
    const diagnosis = analyzeRequests(requests)
    const violations = evaluateAssertions(requests, diagnosis, { maxFailures: 0, failOnSecrets: true })
    expect(violations.some((v) => v.rule === 'fail-on-secrets')).toBe(true)
  })

  test('fail-on-secrets does not trigger when body is clean', () => {
    const requests = [makeRequest({ requestBody: '{"foo":"bar"}' })]
    const diagnosis = analyzeRequests(requests)
    const violations = evaluateAssertions(requests, diagnosis, { maxFailures: 0, failOnSecrets: true })
    expect(violations).toEqual([])
  })

  test('budget-p95-ms violated when p95 exceeds budget', () => {
    const requests = Array.from({ length: 10 }, (_, i) => makeRequest({ id: `r${i}`, duration: (i + 1) * 100 }))
    const diagnosis = analyzeRequests(requests)
    const violations = evaluateAssertions(requests, diagnosis, { maxFailures: 0, budgetP95Ms: 500 })
    expect(violations.some((v) => v.rule === 'budget-p95-ms')).toBe(true)
  })
})

describe('assertCommand — CLI-level behavior', () => {
  test('exits 0 on a clean session', () => {
    const requests = [makeRequest(), makeRequest({ id: 'req-2', status: 200, duration: 50 })]
    const file = join(dir, 'clean.hakka')
    writeFileSync(file, serializeSession(requests))

    const result = assertCommand(file, { maxFailures: 0 })
    expect(process.exitCode).toBe(0)
    expect(result?.violations).toEqual([])
  })

  test('exits 1 when a 500 violates --max-failures 0', () => {
    const requests = [makeRequest({ id: 'req-1', status: 200 }), makeRequest({ id: 'req-2', status: 500 })]
    const file = join(dir, 'failing.hakka')
    writeFileSync(file, serializeSession(requests))

    const result = assertCommand(file, { maxFailures: 0 })
    expect(process.exitCode).toBe(1)
    expect(result?.violations.some((v) => v.rule === 'max-failures')).toBe(true)
  })

  test('exits 1 when --fail-on-secrets catches a leaked body', () => {
    const requests = [makeRequest({ requestBody: '{"api_key":"sk-leaked"}' })]
    const file = join(dir, 'secret.hakka')
    writeFileSync(file, serializeSession(requests))

    const result = assertCommand(file, { maxFailures: 0, failOnSecrets: true })
    expect(process.exitCode).toBe(1)
    expect(result?.violations.some((v) => v.rule === 'fail-on-secrets')).toBe(true)
  })

  test('exits 2 when the file path is missing', () => {
    const result = assertCommand(undefined, {})
    expect(process.exitCode).toBe(2)
    expect(result).toBeUndefined()
  })

  test('exits 2 when the file cannot be read', () => {
    const result = assertCommand(join(dir, 'missing.hakka'), {})
    expect(process.exitCode).toBe(2)
    expect(result).toBeUndefined()
  })

  test('exits 2 for a malformed .hakka file', () => {
    const file = join(dir, 'bad.hakka')
    writeFileSync(file, '{ "not": "a session" }')
    const result = assertCommand(file, {})
    expect(process.exitCode).toBe(2)
    expect(result).toBeUndefined()
  })
})
