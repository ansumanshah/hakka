import { describe, expect, test } from 'bun:test'

import { diffBaseline, formatDriftReport } from '../diff'
import type { NormalizedEndpoint } from '../normalize'

function endpoint(overrides: Partial<NormalizedEndpoint>): NormalizedEndpoint {
  return {
    key: 'GET api.example.com/users',
    method: 'GET',
    host: 'api.example.com',
    path: '/users',
    statuses: ['200'],
    requestHeaderNames: ['content-type'],
    requestBodyShapes: [],
    ...overrides,
  }
}

describe('diffBaseline', () => {
  test('no findings when current matches baseline exactly', () => {
    const baseline = [endpoint({})]
    const current = [endpoint({})]
    expect(diffBaseline(baseline, current)).toEqual([])
  })

  test('a new endpoint on an already-known host is a FAIL', () => {
    const baseline = [endpoint({ key: 'GET api.example.com/other', path: '/other' })]
    const current = [endpoint({}), endpoint({ key: 'GET api.example.com/other', path: '/other' })]
    const findings = diffBaseline(baseline, current)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'new-endpoint', severity: 'fail' })
  })

  test('a removed endpoint is a WARN, not a FAIL', () => {
    const baseline = [endpoint({})]
    const current: NormalizedEndpoint[] = []
    const findings = diffBaseline(baseline, current)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'removed-endpoint', severity: 'warn' })
  })

  test('a new status on an existing endpoint is a FAIL', () => {
    const baseline = [endpoint({ statuses: ['200'] })]
    const current = [endpoint({ statuses: ['200', '500'] })]
    const findings = diffBaseline(baseline, current)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'status-changed', severity: 'fail' })
  })

  test('a new request body shape is a FAIL', () => {
    const baseline = [endpoint({ requestBodyShapes: ['{name:string}'] })]
    const current = [endpoint({ requestBodyShapes: ['{apiKey:string,name:string}'] })]
    const findings = diffBaseline(baseline, current)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'body-shape-changed', severity: 'fail' })
  })

  test('a new request header is a WARN, not a FAIL', () => {
    const baseline = [endpoint({ requestHeaderNames: ['content-type'] })]
    const current = [endpoint({ requestHeaderNames: ['content-type', 'x-debug'] })]
    const findings = diffBaseline(baseline, current)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'new-header', severity: 'warn' })
  })

  test('a new host contacted anywhere is a FAIL, reported once', () => {
    const baseline = [endpoint({ host: 'api.example.com', key: 'GET api.example.com/users' })]
    const current = [
      endpoint({ host: 'api.example.com', key: 'GET api.example.com/users' }),
      endpoint({ host: 'evil.example.com', key: 'GET evil.example.com/collect', path: '/collect' }),
    ]
    const findings = diffBaseline(baseline, current)
    const newHostFindings = findings.filter((f) => f.kind === 'new-host')
    expect(newHostFindings).toHaveLength(1)
    expect(newHostFindings[0]).toMatchObject({ severity: 'fail', subject: 'evil.example.com' })
  })

  test('multiple independent findings on the same endpoint all surface', () => {
    const baseline = [endpoint({ statuses: ['200'], requestHeaderNames: [] })]
    const current = [endpoint({ statuses: ['200', '500'], requestHeaderNames: ['x-new'] })]
    const findings = diffBaseline(baseline, current)
    expect(findings.map((f) => f.kind).sort()).toEqual(['new-header', 'status-changed'])
  })
})

describe('formatDriftReport', () => {
  test('reports a clean pass distinctly', () => {
    expect(formatDriftReport([])).toMatch(/No drift/)
  })

  test('groups FAIL before WARN and labels each with a count', () => {
    const findings = diffBaseline(
      [endpoint({ statuses: ['200'], requestHeaderNames: [] })],
      [endpoint({ statuses: ['200', '500'], requestHeaderNames: ['x-new'] })],
    )
    const report = formatDriftReport(findings)
    const failIdx = report.indexOf('FAIL')
    const warnIdx = report.indexOf('WARN')
    expect(failIdx).toBeGreaterThanOrEqual(0)
    expect(warnIdx).toBeGreaterThan(failIdx)
  })

  test('output contains no ANSI escape codes', () => {
    const findings = diffBaseline([], [endpoint({})])
    const report = formatDriftReport(findings)
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(report)).toBe(false)
  })
})
