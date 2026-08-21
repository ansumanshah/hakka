import { afterEach, describe, expect, test, beforeEach } from 'bun:test'

import { breakpointEngine } from '../BreakpointEngine'
import { applyControlCommand, isDeviceToHostCommand, parseControlCommand, type ControlCommand } from '../control'
import { Hakka } from '../HakkaFacade'
import { mockEngine } from '../MockEngine'
import { ThrottleEngine } from '../ThrottleEngine'
import { readControlFixture } from './controlFixtures'

beforeEach(() => {
  mockEngine.clearRules()
  breakpointEngine.clearBreakpoints()
  ThrottleEngine.setProfile('none')
})

describe('parseControlCommand — valid shapes', () => {
  test('mock.add', () => {
    const raw = {
      kind: 'mock.add',
      rule: {
        id: 'ext-1',
        pattern: '/api/users',
        response: { status: 200, body: '[]' },
        enabled: true,
      },
    }
    const cmd = parseControlCommand(raw)
    expect(cmd).toEqual({
      kind: 'mock.add',
      rule: {
        id: 'ext-1',
        pattern: '/api/users',
        method: undefined,
        mode: undefined,
        response: { status: 200, headers: undefined, body: '[]', delay: undefined },
        enabled: true,
        redirectTo: undefined,
        block: undefined,
      },
    })
  })

  test('mock.add with full optional fields', () => {
    const raw = {
      kind: 'mock.add',
      rule: {
        id: 'ext-2',
        pattern: 'foo',
        method: 'POST',
        mode: 'rewrite',
        response: { status: 201, headers: { 'x-a': 'b' }, body: { ok: true }, delay: 50 },
        enabled: false,
        redirectTo: 'https://example.com',
        block: false,
      },
    }
    const cmd = parseControlCommand(raw)
    expect(cmd?.kind).toBe('mock.add')
    if (cmd?.kind === 'mock.add') {
      expect(cmd.rule.method).toBe('POST')
      expect(cmd.rule.mode).toBe('rewrite')
      expect(cmd.rule.response.headers).toEqual({ 'x-a': 'b' })
      expect(cmd.rule.redirectTo).toBe('https://example.com')
    }
  })

  test('mock.add with a declarative modify block', () => {
    const raw = {
      kind: 'mock.add',
      rule: {
        id: 'ext-modify-1',
        pattern: '/api/data',
        response: { status: 200, body: '{}' },
        enabled: true,
        modify: {
          setRequestHeaders: { 'x-added': '1' },
          removeRequestHeaders: ['x-secret'],
          setQueryParams: { debug: '1' },
          removeQueryParams: ['token'],
          status: 201,
          setResponseHeaders: { 'x-res': 'a' },
          removeResponseHeaders: ['x-drop'],
          replaceBody: [{ find: 'foo', replace: 'bar' }],
        },
      },
    }
    const cmd = parseControlCommand(raw)
    expect(cmd?.kind).toBe('mock.add')
    if (cmd?.kind === 'mock.add') {
      expect(cmd.rule.modify).toEqual(raw.rule.modify)
    }
  })

  test('mock.add with no modify block parses with modify undefined', () => {
    const cmd = parseControlCommand({
      kind: 'mock.add',
      rule: { id: 'ext-no-modify', pattern: '/x', response: { status: 200, body: '' }, enabled: true },
    })
    expect(cmd?.kind).toBe('mock.add')
    if (cmd?.kind === 'mock.add') {
      expect(cmd.rule.modify).toBeUndefined()
    }
  })

  test('mock.remove', () => {
    const cmd = parseControlCommand({ kind: 'mock.remove', id: 'ext-1' })
    expect(cmd).toEqual({ kind: 'mock.remove', id: 'ext-1' })
  })

  test('mock.clear', () => {
    const cmd = parseControlCommand({ kind: 'mock.clear' })
    expect(cmd).toEqual({ kind: 'mock.clear' })
  })

  test('mock.clear ignores extraneous fields', () => {
    const cmd = parseControlCommand({ kind: 'mock.clear', extra: 'ignored' })
    expect(cmd).toEqual({ kind: 'mock.clear' })
  })

  test('breakpoint.add', () => {
    const raw = {
      kind: 'breakpoint.add',
      breakpoint: { id: 'bp-ext-1', pattern: '/api/checkout', enabled: true },
    }
    const cmd = parseControlCommand(raw)
    expect(cmd).toEqual({
      kind: 'breakpoint.add',
      breakpoint: { id: 'bp-ext-1', pattern: '/api/checkout', method: undefined, on: undefined, enabled: true },
    })
  })

  test('breakpoint.add with method + on', () => {
    const raw = {
      kind: 'breakpoint.add',
      breakpoint: { id: 'bp-ext-2', pattern: '/x', method: 'post', on: 'both', enabled: true },
    }
    const cmd = parseControlCommand(raw)
    expect(cmd?.kind).toBe('breakpoint.add')
    if (cmd?.kind === 'breakpoint.add') {
      expect(cmd.breakpoint.on).toBe('both')
      expect(cmd.breakpoint.method).toBe('post')
    }
  })

  test('breakpoint.remove', () => {
    const cmd = parseControlCommand({ kind: 'breakpoint.remove', id: 'bp-ext-1' })
    expect(cmd).toEqual({ kind: 'breakpoint.remove', id: 'bp-ext-1' })
  })

  test('breakpoint.paused — response phase, minimal', () => {
    const raw = {
      kind: 'breakpoint.paused',
      pauseId: 'pause_1',
      phase: 'response',
      device: 'ios-simulator',
      request: { url: 'https://api.example.com/x', method: 'GET', headers: {} },
      response: { status: 200, headers: {}, body: '' },
    }
    const cmd = parseControlCommand(raw)
    expect(cmd).toEqual({
      kind: 'breakpoint.paused',
      pauseId: 'pause_1',
      ruleId: undefined,
      phase: 'response',
      device: 'ios-simulator',
      request: { url: 'https://api.example.com/x', method: 'GET', headers: {}, body: undefined },
      response: { status: 200, headers: {}, body: '' },
    })
  })

  test('breakpoint.paused — request phase, no response block', () => {
    const cmd = parseControlCommand({
      kind: 'breakpoint.paused',
      pauseId: 'pause_2',
      ruleId: 'bp-1',
      phase: 'request',
      device: 'android-emulator',
      request: { url: 'https://api.example.com/x', method: 'POST', headers: { 'x-a': 'b' }, body: '{}' },
    })
    expect(cmd?.kind).toBe('breakpoint.paused')
    if (cmd?.kind === 'breakpoint.paused') {
      expect(cmd.ruleId).toBe('bp-1')
      expect(cmd.phase).toBe('request')
      expect(cmd.response).toBeUndefined()
      expect(cmd.request.body).toBe('{}')
    }
  })

  test('breakpoint.paused — matches the pinned fixture', () => {
    const cmd = parseControlCommand(readControlFixture('breakpoint-paused.json'))
    expect(cmd).toEqual({
      kind: 'breakpoint.paused',
      pauseId: 'pause_7',
      ruleId: 'bp-checkout',
      phase: 'response',
      device: 'ios-simulator-6',
      request: {
        url: 'https://api.example.com/checkout',
        method: 'POST',
        headers: { accept: 'application/json' },
        body: undefined,
      },
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
      },
    })
  })

  test('breakpoint.resume — request edits, matches the pinned fixture', () => {
    const cmd = parseControlCommand(readControlFixture('breakpoint-resume-request.json'))
    expect(cmd).toEqual({
      kind: 'breakpoint.resume',
      pauseId: 'pause_3',
      requestEdits: {
        url: 'https://api.example.com/checkout?debug=1',
        method: 'POST',
        headers: { 'x-injected': '1' },
        body: undefined,
      },
      responseEdits: undefined,
    })
  })

  test('breakpoint.resume — response edits, matches the pinned fixture', () => {
    const cmd = parseControlCommand(readControlFixture('breakpoint-resume-response.json'))
    expect(cmd).toEqual({
      kind: 'breakpoint.resume',
      pauseId: 'pause_7',
      requestEdits: undefined,
      responseEdits: { status: 201, headers: { 'x-injected': '1' }, body: undefined },
    })
  })

  test('breakpoint.resume — no edits (bare release)', () => {
    const cmd = parseControlCommand({ kind: 'breakpoint.resume', pauseId: 'pause_9' })
    expect(cmd).toEqual({
      kind: 'breakpoint.resume',
      pauseId: 'pause_9',
      requestEdits: undefined,
      responseEdits: undefined,
    })
  })

  test('breakpoint.abort — matches the pinned fixture', () => {
    const cmd = parseControlCommand(readControlFixture('breakpoint-abort.json'))
    expect(cmd).toEqual({ kind: 'breakpoint.abort', pauseId: 'pause_7' })
  })

  test('throttle.set — none', () => {
    const cmd = parseControlCommand({ kind: 'throttle.set', profile: 'none' })
    expect(cmd).toEqual({ kind: 'throttle.set', profile: 'none', latencyMs: undefined, downloadKbps: undefined })
  })

  test('throttle.set — preset profile', () => {
    const cmd = parseControlCommand({ kind: 'throttle.set', profile: 'slow-3g' })
    expect(cmd).toEqual({ kind: 'throttle.set', profile: 'slow-3g', latencyMs: undefined, downloadKbps: undefined })
  })

  test('throttle.set — custom with latency + bandwidth', () => {
    const cmd = parseControlCommand({ kind: 'throttle.set', profile: 'custom', latencyMs: 200, downloadKbps: 500 })
    expect(cmd).toEqual({ kind: 'throttle.set', profile: 'custom', latencyMs: 200, downloadKbps: 500 })
  })

  test('request.replay — requestId only', () => {
    const cmd = parseControlCommand({ kind: 'request.replay', requestId: 'req-1' })
    expect(cmd).toEqual({ kind: 'request.replay', requestId: 'req-1', replayMarker: undefined })
  })

  test('request.replay — with a replayMarker', () => {
    const cmd = parseControlCommand({ kind: 'request.replay', requestId: 'req-1', replayMarker: 'marker-abc' })
    expect(cmd).toEqual({ kind: 'request.replay', requestId: 'req-1', replayMarker: 'marker-abc' })
  })
})

describe('parseControlCommand — malformed shapes', () => {
  const malformed: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'mock.add'],
    ['number', 42],
    ['array', ['mock.add']],
    ['empty object', {}],
    ['unknown kind', { kind: 'bogus.kind' }],
    ['kind not a string', { kind: 123 }],
    ['mock.add missing rule', { kind: 'mock.add' }],
    ['mock.add rule not object', { kind: 'mock.add', rule: 'nope' }],
    [
      'mock.add missing id',
      { kind: 'mock.add', rule: { pattern: 'x', response: { status: 200, body: '' }, enabled: true } },
    ],
    [
      'mock.add hostile id (path traversal)',
      {
        kind: 'mock.add',
        rule: { id: '../../etc/passwd', pattern: 'x', response: { status: 200, body: '' }, enabled: true },
      },
    ],
    [
      'mock.add hostile id (too long)',
      {
        kind: 'mock.add',
        rule: { id: 'a'.repeat(65), pattern: 'x', response: { status: 200, body: '' }, enabled: true },
      },
    ],
    [
      'mock.add hostile id (spaces)',
      { kind: 'mock.add', rule: { id: 'has space', pattern: 'x', response: { status: 200, body: '' }, enabled: true } },
    ],
    [
      'mock.add missing pattern',
      { kind: 'mock.add', rule: { id: 'a', response: { status: 200, body: '' }, enabled: true } },
    ],
    [
      'mock.add missing enabled',
      { kind: 'mock.add', rule: { id: 'a', pattern: 'x', response: { status: 200, body: '' } } },
    ],
    ['mock.add missing response', { kind: 'mock.add', rule: { id: 'a', pattern: 'x', enabled: true } }],
    [
      'mock.add response missing status',
      { kind: 'mock.add', rule: { id: 'a', pattern: 'x', response: { body: '' }, enabled: true } },
    ],
    [
      'mock.add response bad body type',
      { kind: 'mock.add', rule: { id: 'a', pattern: 'x', response: { status: 200, body: 42 }, enabled: true } },
    ],
    [
      'mock.add invalid mode',
      {
        kind: 'mock.add',
        rule: { id: 'a', pattern: 'x', mode: 'bogus', response: { status: 200, body: '' }, enabled: true },
      },
    ],
    [
      'mock.add negative delay',
      {
        kind: 'mock.add',
        rule: { id: 'a', pattern: 'x', response: { status: 200, body: '', delay: -1 }, enabled: true },
      },
    ],
    [
      'mock.add modify not an object',
      {
        kind: 'mock.add',
        rule: { id: 'a', pattern: 'x', response: { status: 200, body: '' }, enabled: true, modify: 'nope' },
      },
    ],
    [
      'mock.add modify.setRequestHeaders with non-string value',
      {
        kind: 'mock.add',
        rule: {
          id: 'a',
          pattern: 'x',
          response: { status: 200, body: '' },
          enabled: true,
          modify: { setRequestHeaders: { a: 1 } },
        },
      },
    ],
    [
      'mock.add modify.removeQueryParams with non-string entries',
      {
        kind: 'mock.add',
        rule: {
          id: 'a',
          pattern: 'x',
          response: { status: 200, body: '' },
          enabled: true,
          modify: { removeQueryParams: [1, 2] },
        },
      },
    ],
    [
      'mock.add modify.status not finite',
      {
        kind: 'mock.add',
        rule: {
          id: 'a',
          pattern: 'x',
          response: { status: 200, body: '' },
          enabled: true,
          modify: { status: Number.POSITIVE_INFINITY },
        },
      },
    ],
    [
      'mock.add modify.replaceBody malformed entry (missing replace)',
      {
        kind: 'mock.add',
        rule: {
          id: 'a',
          pattern: 'x',
          response: { status: 200, body: '' },
          enabled: true,
          modify: { replaceBody: [{ find: 'x' }] },
        },
      },
    ],
    ['mock.remove missing id', { kind: 'mock.remove' }],
    ['mock.remove hostile id', { kind: 'mock.remove', id: 'a/b/c' }],
    ['mock.remove non-string id', { kind: 'mock.remove', id: 123 }],
    ['breakpoint.add missing breakpoint', { kind: 'breakpoint.add' }],
    ['breakpoint.add missing id', { kind: 'breakpoint.add', breakpoint: { pattern: 'x', enabled: true } }],
    [
      'breakpoint.add hostile id',
      { kind: 'breakpoint.add', breakpoint: { id: '<script>', pattern: 'x', enabled: true } },
    ],
    [
      'breakpoint.add invalid phase',
      { kind: 'breakpoint.add', breakpoint: { id: 'a', pattern: 'x', on: 'sometimes', enabled: true } },
    ],
    ['breakpoint.remove hostile id', { kind: 'breakpoint.remove', id: '' }],
    [
      'breakpoint.paused missing pauseId',
      { kind: 'breakpoint.paused', phase: 'request', device: 'x', request: { url: 'u', method: 'GET', headers: {} } },
    ],
    [
      'breakpoint.paused empty pauseId',
      {
        kind: 'breakpoint.paused',
        pauseId: '',
        phase: 'request',
        device: 'x',
        request: { url: 'u', method: 'GET', headers: {} },
      },
    ],
    [
      'breakpoint.paused oversized pauseId',
      {
        kind: 'breakpoint.paused',
        pauseId: 'a'.repeat(257),
        phase: 'request',
        device: 'x',
        request: { url: 'u', method: 'GET', headers: {} },
      },
    ],
    [
      'breakpoint.paused unknown phase',
      {
        kind: 'breakpoint.paused',
        pauseId: 'p1',
        phase: 'sideways',
        device: 'x',
        request: { url: 'u', method: 'GET', headers: {} },
      },
    ],
    [
      'breakpoint.paused phase "both" is not a valid pause phase',
      {
        kind: 'breakpoint.paused',
        pauseId: 'p1',
        phase: 'both',
        device: 'x',
        request: { url: 'u', method: 'GET', headers: {} },
      },
    ],
    [
      'breakpoint.paused missing device',
      { kind: 'breakpoint.paused', pauseId: 'p1', phase: 'request', request: { url: 'u', method: 'GET', headers: {} } },
    ],
    [
      'breakpoint.paused wrong type device',
      {
        kind: 'breakpoint.paused',
        pauseId: 'p1',
        phase: 'request',
        device: 42,
        request: { url: 'u', method: 'GET', headers: {} },
      },
    ],
    ['breakpoint.paused missing request', { kind: 'breakpoint.paused', pauseId: 'p1', phase: 'request', device: 'x' }],
    [
      'breakpoint.paused request missing url',
      {
        kind: 'breakpoint.paused',
        pauseId: 'p1',
        phase: 'request',
        device: 'x',
        request: { method: 'GET', headers: {} },
      },
    ],
    [
      'breakpoint.paused request wrong type headers',
      {
        kind: 'breakpoint.paused',
        pauseId: 'p1',
        phase: 'request',
        device: 'x',
        request: { url: 'u', method: 'GET', headers: 'nope' },
      },
    ],
    [
      'breakpoint.paused response wrong type status',
      {
        kind: 'breakpoint.paused',
        pauseId: 'p1',
        phase: 'response',
        device: 'x',
        request: { url: 'u', method: 'GET', headers: {} },
        response: { status: 'nope', headers: {} },
      },
    ],
    ['breakpoint.resume missing pauseId', { kind: 'breakpoint.resume' }],
    ['breakpoint.resume empty pauseId', { kind: 'breakpoint.resume', pauseId: '' }],
    ['breakpoint.resume oversized pauseId', { kind: 'breakpoint.resume', pauseId: 'a'.repeat(257) }],
    [
      'breakpoint.resume requestEdits not an object',
      { kind: 'breakpoint.resume', pauseId: 'p1', requestEdits: 'nope' },
    ],
    [
      'breakpoint.resume requestEdits wrong type headers',
      { kind: 'breakpoint.resume', pauseId: 'p1', requestEdits: { headers: 'nope' } },
    ],
    [
      'breakpoint.resume responseEdits wrong type status',
      { kind: 'breakpoint.resume', pauseId: 'p1', responseEdits: { status: 'nope' } },
    ],
    ['breakpoint.abort missing pauseId', { kind: 'breakpoint.abort' }],
    ['breakpoint.abort empty pauseId', { kind: 'breakpoint.abort', pauseId: '' }],
    ['breakpoint.abort non-string pauseId', { kind: 'breakpoint.abort', pauseId: 42 }],
    ['throttle.set missing profile', { kind: 'throttle.set' }],
    ['throttle.set invalid profile', { kind: 'throttle.set', profile: 'super-fast' }],
    ['throttle.set negative latency', { kind: 'throttle.set', profile: 'custom', latencyMs: -5 }],
    ['throttle.set negative bandwidth', { kind: 'throttle.set', profile: 'custom', downloadKbps: -1 }],
    ['throttle.set NaN latency', { kind: 'throttle.set', profile: 'custom', latencyMs: NaN }],
    ['request.replay missing requestId', { kind: 'request.replay' }],
    ['request.replay empty requestId', { kind: 'request.replay', requestId: '' }],
    ['request.replay non-string requestId', { kind: 'request.replay', requestId: 42 }],
    ['request.replay malformed replayMarker', { kind: 'request.replay', requestId: 'req-1', replayMarker: 'a/b/c' }],
    ['request.replay non-string replayMarker', { kind: 'request.replay', requestId: 'req-1', replayMarker: 7 }],
  ]

  for (const [label, input] of malformed) {
    test(label, () => {
      expect(() => parseControlCommand(input)).not.toThrow()
      expect(parseControlCommand(input)).toBeNull()
    })
  }

  test('circular reference does not throw', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const circular: any = { kind: 'mock.add' }
    circular.rule = circular
    expect(() => parseControlCommand(circular)).not.toThrow()
    expect(parseControlCommand(circular)).toBeNull()
  })
})

describe('applyControlCommand — mock.add / mock.remove / mock.clear', () => {
  test('mock.add lands the rule in mockEngine.getRules with the given id', () => {
    const cmd: ControlCommand = {
      kind: 'mock.add',
      rule: { id: 'ext-add-1', pattern: '/foo', response: { status: 200, body: 'ok' }, enabled: true },
    }
    const result = applyControlCommand(cmd)
    expect(result).toEqual({ ok: true })
    const rules = mockEngine.getRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.id).toBe('ext-add-1')
    expect(rules[0]!.pattern).toBe('/foo')
  })

  test('mock.add with a modify block lands the modify data on the stored rule and flips isRewrite', () => {
    const cmd: ControlCommand = {
      kind: 'mock.add',
      rule: {
        id: 'ext-modify-apply',
        pattern: '/foo',
        response: { status: 200, body: 'ok' },
        enabled: true,
        modify: { setQueryParams: { debug: '1' }, replaceBody: [{ find: 'ok', replace: 'OK' }] },
      },
    }
    const result = applyControlCommand(cmd)
    expect(result).toEqual({ ok: true })
    const rule = mockEngine.getRules().find((r) => r.id === 'ext-modify-apply')
    expect(rule?.modify).toEqual({ setQueryParams: { debug: '1' }, replaceBody: [{ find: 'ok', replace: 'OK' }] })
    expect(mockEngine.isRewrite(rule!)).toBe(true)
  })

  test('mock.add with duplicate id replaces the existing rule (replace-by-id)', () => {
    applyControlCommand({
      kind: 'mock.add',
      rule: { id: 'dup', pattern: '/v1', response: { status: 200, body: 'v1' }, enabled: true },
    })
    applyControlCommand({
      kind: 'mock.add',
      rule: { id: 'dup', pattern: '/v2', response: { status: 201, body: 'v2' }, enabled: true },
    })
    const rules = mockEngine.getRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.pattern).toBe('/v2')
    expect(rules[0]!.response.status).toBe(201)
  })

  test('mock.remove removes the rule by id', () => {
    applyControlCommand({
      kind: 'mock.add',
      rule: { id: 'to-remove', pattern: '/x', response: { status: 200, body: '' }, enabled: true },
    })
    expect(mockEngine.getRules()).toHaveLength(1)
    const result = applyControlCommand({ kind: 'mock.remove', id: 'to-remove' })
    expect(result).toEqual({ ok: true })
    expect(mockEngine.getRules()).toHaveLength(0)
  })

  test('mock.remove on unknown id is still ok:true (idempotent)', () => {
    const result = applyControlCommand({ kind: 'mock.remove', id: 'never-existed' })
    expect(result).toEqual({ ok: true })
  })

  test('mock.clear empties all rules', () => {
    applyControlCommand({
      kind: 'mock.add',
      rule: { id: 'a', pattern: '/a', response: { status: 200, body: '' }, enabled: true },
    })
    applyControlCommand({
      kind: 'mock.add',
      rule: { id: 'b', pattern: '/b', response: { status: 200, body: '' }, enabled: true },
    })
    expect(mockEngine.getRules()).toHaveLength(2)
    const result = applyControlCommand({ kind: 'mock.clear' })
    expect(result).toEqual({ ok: true })
    expect(mockEngine.getRules()).toHaveLength(0)
  })
})

describe('applyControlCommand — breakpoint.add / breakpoint.remove', () => {
  test('breakpoint.add lands the breakpoint with the given id', () => {
    const result = applyControlCommand({
      kind: 'breakpoint.add',
      breakpoint: { id: 'bp-1', pattern: '/checkout', enabled: true },
    })
    expect(result).toEqual({ ok: true })
    const bps = breakpointEngine.getBreakpoints()
    expect(bps).toHaveLength(1)
    expect(bps[0]!.id).toBe('bp-1')
    expect(bps[0]!.on).toBe('request')
  })

  test('breakpoint.add with duplicate id replaces in place', () => {
    applyControlCommand({ kind: 'breakpoint.add', breakpoint: { id: 'dup-bp', pattern: '/a', enabled: true } })
    applyControlCommand({
      kind: 'breakpoint.add',
      breakpoint: { id: 'dup-bp', pattern: '/b', on: 'response', enabled: false },
    })
    const bps = breakpointEngine.getBreakpoints()
    expect(bps).toHaveLength(1)
    expect(bps[0]!.pattern).toBe('/b')
    expect(bps[0]!.on).toBe('response')
    expect(bps[0]!.enabled).toBe(false)
  })

  test('breakpoint.remove removes by id', () => {
    applyControlCommand({ kind: 'breakpoint.add', breakpoint: { id: 'bp-remove', pattern: '/x', enabled: true } })
    expect(breakpointEngine.getBreakpoints()).toHaveLength(1)
    const result = applyControlCommand({ kind: 'breakpoint.remove', id: 'bp-remove' })
    expect(result).toEqual({ ok: true })
    expect(breakpointEngine.getBreakpoints()).toHaveLength(0)
  })
})

describe('applyControlCommand — breakpoint.resume / breakpoint.abort / breakpoint.paused', () => {
  test('breakpoint.resume with requestEdits releases a request-phase pause with the edits applied', async () => {
    const pausePromise = breakpointEngine.pause('req-1', 'request', {
      url: 'https://api.example.com/x',
      method: 'GET',
      headers: {},
      body: null,
    })
    const [pending] = breakpointEngine.getPaused()
    expect(pending?.phase).toBe('request')

    const result = applyControlCommand({
      kind: 'breakpoint.resume',
      pauseId: pending!.id,
      requestEdits: { method: 'POST' },
    })
    expect(result).toEqual({ ok: true })

    const action = await pausePromise
    expect(action).toEqual({ type: 'resume', edits: { method: 'POST' } })
    expect(breakpointEngine.getPaused()).toHaveLength(0)
  })

  test('breakpoint.resume with responseEdits releases a response-phase pause with the edits applied', async () => {
    const pausePromise = breakpointEngine.pause('req-2', 'response', { status: 200, headers: {}, body: '' })
    const [pending] = breakpointEngine.getPaused()
    expect(pending?.phase).toBe('response')

    const result = applyControlCommand({
      kind: 'breakpoint.resume',
      pauseId: pending!.id,
      responseEdits: { status: 500 },
    })
    expect(result).toEqual({ ok: true })

    const action = await pausePromise
    expect(action).toEqual({ type: 'resume', edits: { status: 500 } })
  })

  test('breakpoint.resume for an unknown pauseId is still ok:true (idempotent, mirrors mock.remove)', () => {
    const result = applyControlCommand({ kind: 'breakpoint.resume', pauseId: 'never-existed' })
    expect(result).toEqual({ ok: true })
  })

  test('breakpoint.abort resolves the pause with an abort action', async () => {
    const pausePromise = breakpointEngine.pause('req-3', 'request', {
      url: 'https://api.example.com/y',
      method: 'GET',
      headers: {},
      body: null,
    })
    const [pending] = breakpointEngine.getPaused()

    const result = applyControlCommand({ kind: 'breakpoint.abort', pauseId: pending!.id })
    expect(result).toEqual({ ok: true })

    const action = await pausePromise
    expect(action).toEqual({ type: 'abort' })
  })

  test('breakpoint.paused is refused — a device must never apply its own pause notification', () => {
    const result = applyControlCommand({
      kind: 'breakpoint.paused',
      pauseId: 'pause_1',
      phase: 'request',
      device: 'ios-simulator',
      request: { url: 'https://api.example.com/x', method: 'GET', headers: {} },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('device to host only')
    }
  })
})

describe('isDeviceToHostCommand — direction guard', () => {
  test('breakpoint.paused is device-to-host', () => {
    expect(
      isDeviceToHostCommand({
        kind: 'breakpoint.paused',
        pauseId: 'p1',
        phase: 'request',
        device: 'x',
        request: { url: 'u', method: 'GET', headers: {} },
      }),
    ).toBe(true)
  })

  test('every other kind is host-to-device', () => {
    const hostToDevice: ControlCommand[] = [
      { kind: 'mock.clear' },
      { kind: 'breakpoint.resume', pauseId: 'p1' },
      { kind: 'breakpoint.abort', pauseId: 'p1' },
      { kind: 'throttle.set', profile: 'none' },
    ]
    for (const cmd of hostToDevice) {
      expect(isDeviceToHostCommand(cmd)).toBe(false)
    }
  })
})

describe('applyControlCommand — throttle.set', () => {
  test('none resets to no throttle', () => {
    ThrottleEngine.setProfile('slow-3g')
    const result = applyControlCommand({ kind: 'throttle.set', profile: 'none' })
    expect(result).toEqual({ ok: true })
    expect(ThrottleEngine.current).toEqual({ profile: 'none', latencyMs: 0, downloadKbps: 0 })
  })

  test('preset profile applies known latency/bandwidth', () => {
    const result = applyControlCommand({ kind: 'throttle.set', profile: 'slow-3g' })
    expect(result).toEqual({ ok: true })
    expect(ThrottleEngine.current.profile).toBe('slow-3g')
    expect(ThrottleEngine.current.latencyMs).toBe(400)
    expect(ThrottleEngine.current.downloadKbps).toBe(400)
  })

  test('custom profile applies caller latency + bandwidth', () => {
    const result = applyControlCommand({
      kind: 'throttle.set',
      profile: 'custom',
      latencyMs: 777,
      downloadKbps: 42,
    })
    expect(result).toEqual({ ok: true })
    expect(ThrottleEngine.current).toEqual({ profile: 'custom', latencyMs: 777, downloadKbps: 42 })
  })

  test('custom profile with no latency/bandwidth defaults latency to 0', () => {
    const result = applyControlCommand({ kind: 'throttle.set', profile: 'custom' })
    expect(result).toEqual({ ok: true })
    expect(ThrottleEngine.current.profile).toBe('custom')
    expect(ThrottleEngine.current.latencyMs).toBe(0)
  })
})

describe('applyControlCommand — request.replay', () => {
  const originalGetLog = Hakka.getLog.bind(Hakka)
  const originalFetch = globalThis.fetch

  afterEach(() => {
    Hakka.getLog = originalGetLog
    globalThis.fetch = originalFetch
  })

  test('ok:false when no request is found for the id, and never touches fetch', () => {
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response('ok')
    }) as typeof fetch

    const result = applyControlCommand({ kind: 'request.replay', requestId: 'definitely-not-a-real-id' })
    expect(result.ok).toBe(false)
    expect(fetchCalled).toBe(false)
  })

  test('ok:false for a websocket-sourced request, and never dispatches a replay', () => {
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response('ok')
    }) as typeof fetch
    Hakka.getLog = ((id: string) =>
      id === 'ws-1'
        ? { id: 'ws-1', url: 'wss://api.example.com/socket', method: 'GET', startTime: 0, source: 'websocket' }
        : undefined) as typeof Hakka.getLog

    const result = applyControlCommand({ kind: 'request.replay', requestId: 'ws-1' })
    expect(result).toEqual({ ok: false, error: 'request.replay: websocket requests are not replayable' })
    expect(fetchCalled).toBe(false)
  })

  test('ok:true and dispatches a replay (via replayRequest -> fetch) for a valid client-runtime request', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (url: string) => {
      calls.push(url)
      return new Response('ok')
    }) as typeof fetch
    Hakka.getLog = ((id: string) =>
      id === 'client-1'
        ? { id: 'client-1', url: 'https://api.example.com/x', method: 'GET', startTime: 0, runtime: 'client' }
        : undefined) as typeof Hakka.getLog

    const result = applyControlCommand({ kind: 'request.replay', requestId: 'client-1', replayMarker: 'm-1' })
    expect(result).toEqual({ ok: true })

    // request.replay dispatches fire-and-forget — give the microtask queue a turn to run replayRequest's fetch call.
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['https://api.example.com/x'])
  })
})

describe('applyControlCommand — fail-open on engine errors', () => {
  test('mock.add returns ok:false when the engine throws, never throws itself', () => {
    const originalAddRule = mockEngine.addRule.bind(mockEngine)
    mockEngine.addRule = () => {
      throw new Error('boom: engine exploded')
    }
    try {
      let result: ReturnType<typeof applyControlCommand> | undefined
      expect(() => {
        result = applyControlCommand({
          kind: 'mock.add',
          rule: { id: 'boom', pattern: '/x', response: { status: 200, body: '' }, enabled: true },
        })
      }).not.toThrow()
      expect(result).toEqual({ ok: false, error: 'boom: engine exploded' })
    } finally {
      mockEngine.addRule = originalAddRule
    }
  })

  test('breakpoint.remove returns ok:false when the engine throws, never throws itself', () => {
    const originalRemove = breakpointEngine.removeBreakpoint.bind(breakpointEngine)
    breakpointEngine.removeBreakpoint = () => {
      throw new Error('breakpoint engine boom')
    }
    try {
      let result: ReturnType<typeof applyControlCommand> | undefined
      expect(() => {
        result = applyControlCommand({ kind: 'breakpoint.remove', id: 'whatever' })
      }).not.toThrow()
      expect(result).toEqual({ ok: false, error: 'breakpoint engine boom' })
    } finally {
      breakpointEngine.removeBreakpoint = originalRemove
    }
  })

  test('throttle.set returns ok:false with stringified error when engine throws a non-Error', () => {
    const originalSetProfile = ThrottleEngine.setProfile.bind(ThrottleEngine)
    ThrottleEngine.setProfile = () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'raw string throw'
    }
    try {
      let result: ReturnType<typeof applyControlCommand> | undefined
      expect(() => {
        result = applyControlCommand({ kind: 'throttle.set', profile: 'edge' })
      }).not.toThrow()
      expect(result).toEqual({ ok: false, error: 'raw string throw' })
    } finally {
      ThrottleEngine.setProfile = originalSetProfile
    }
  })
})

describe('parseControlCommand -> applyControlCommand end-to-end', () => {
  test('valid raw payload round-trips into engine state', () => {
    const raw = {
      kind: 'mock.add',
      rule: {
        id: 'e2e-1',
        pattern: '/api/e2e',
        response: { status: 200, body: '{"ok":true}' },
        enabled: true,
      },
    }
    const cmd = parseControlCommand(raw)
    expect(cmd).not.toBeNull()
    const result = applyControlCommand(cmd!)
    expect(result).toEqual({ ok: true })
    expect(mockEngine.getRules().find((r) => r.id === 'e2e-1')).toBeDefined()
  })

  test('malformed raw payload never reaches apply (caller must check null)', () => {
    const cmd = parseControlCommand({ kind: 'mock.add', rule: { id: 'bad id with space', pattern: 'x' } })
    expect(cmd).toBeNull()
  })

  test('request.replay round-trips: unknown id parses fine, apply reports ok:false (not a throw)', () => {
    const cmd = parseControlCommand({ kind: 'request.replay', requestId: 'e2e-unknown-id' })
    expect(cmd).not.toBeNull()
    expect(() => applyControlCommand(cmd!)).not.toThrow()
    expect(applyControlCommand(cmd!).ok).toBe(false)
  })
})
