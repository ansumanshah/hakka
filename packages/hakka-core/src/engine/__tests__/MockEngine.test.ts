import { describe, expect, test, beforeEach } from 'bun:test'

import type { MockRequestContext } from '../MockEngine'

// Each describe uses a fresh import via query-param versioning to avoid
// singleton state leaking between suites.

function makeCtx(url = 'https://api.example.com/data', method = 'GET'): MockRequestContext {
  return { url, method, headers: {}, body: undefined }
}

describe('MockEngine — existing mock mode (regression)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fresh: any

  beforeEach(async () => {
    const mod = await import('../MockEngine?v=regression-' + Math.random())
    fresh = mod.mockEngine
  })

  test('addRule returns an id and match finds it', () => {
    const id = fresh.addRule({
      pattern: '/api/users',
      response: { status: 200, body: '[]' },
      enabled: true,
    })
    expect(typeof id).toBe('string')
    const rule = fresh.match('https://example.com/api/users', 'GET')
    expect(rule).not.toBeNull()
    expect(rule!.id).toBe(id)
    expect(rule!.hitCount).toBe(1)
  })

  test('match returns null when no rules match', () => {
    expect(fresh.match('https://example.com/unknown', 'GET')).toBeNull()
  })

  test('match respects enabled flag', () => {
    const id = fresh.addRule({
      pattern: '/data',
      response: { status: 200, body: '' },
      enabled: false,
    })
    expect(fresh.match('https://example.com/data', 'GET')).toBeNull()
    fresh.enableRule(id)
    expect(fresh.match('https://example.com/data', 'GET')).not.toBeNull()
  })

  test('match is method-filtered', () => {
    fresh.addRule({
      pattern: '/items',
      method: 'POST',
      response: { status: 201, body: '{}' },
      enabled: true,
    })
    expect(fresh.match('https://example.com/items', 'GET')).toBeNull()
    expect(fresh.match('https://example.com/items', 'POST')).not.toBeNull()
  })

  test('default mode is undefined (treated as mock)', () => {
    fresh.addRule({
      pattern: '/ping',
      response: { status: 200, body: 'pong' },
      enabled: true,
    })
    const rule = fresh.match('https://example.com/ping', 'GET')
    expect(rule!.mode).toBeUndefined()
  })
})

describe('MockEngine — bodyProvider', () => {
  test('rule accepts a bodyProvider function (sync)', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=bp-sync-' + Math.random())
    fresh.addRule({
      pattern: '/echo',
      response: {
        status: 200,
        body: 'fallback',
        bodyProvider: (req) => `echo:${req.url}`,
      },
      enabled: true,
    })
    const rule = fresh.match('https://example.com/echo', 'GET')
    expect(rule).not.toBeNull()
    const ctx = makeCtx('https://example.com/echo')
    const result = await Promise.resolve(rule!.response.bodyProvider!(ctx))
    expect(result).toBe('echo:https://example.com/echo')
  })
})

describe('MockEngine — rule priority (first-match wins)', () => {
  test('match() returns the first-added rule when two enabled rules match the same url+method', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=priority-basic-' + Math.random())
    const id1 = fresh.addRule({
      pattern: '/api/data',
      response: { status: 200, body: 'first' },
      enabled: true,
    })
    const id2 = fresh.addRule({
      pattern: '/api/data',
      response: { status: 201, body: 'second' },
      enabled: true,
    })
    const rule = fresh.match('https://example.com/api/data', 'GET')
    expect(rule).not.toBeNull()
    expect(rule!.id).toBe(id1)
    expect(rule!.response.body).toBe('first')
    expect(rule!.id).not.toBe(id2)
  })

  test('peek() also returns the first-added rule (no hit recorded)', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=priority-peek-' + Math.random())
    const id1 = fresh.addRule({
      pattern: '/resource',
      response: { status: 200, body: 'rule-one' },
      enabled: true,
    })
    fresh.addRule({
      pattern: '/resource',
      response: { status: 404, body: 'rule-two' },
      enabled: true,
    })
    const rule = fresh.peek('https://example.com/resource', 'GET')
    expect(rule).not.toBeNull()
    expect(rule!.id).toBe(id1)
    expect(rule!.hitCount).toBe(0)
  })

  test('disabling the first rule causes the second rule to match', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=priority-disable-' + Math.random())
    const id1 = fresh.addRule({
      pattern: '/items',
      response: { status: 200, body: 'first' },
      enabled: true,
    })
    const id2 = fresh.addRule({
      pattern: '/items',
      response: { status: 200, body: 'second' },
      enabled: true,
    })
    expect(fresh.match('https://example.com/items', 'GET')!.id).toBe(id1)
    fresh.disableRule(id1)
    const rule = fresh.match('https://example.com/items', 'GET')
    expect(rule).not.toBeNull()
    expect(rule!.id).toBe(id2)
  })

  test('removing the first rule causes the second rule to match', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=priority-remove-' + Math.random())
    const id1 = fresh.addRule({
      pattern: '/posts',
      response: { status: 200, body: 'first' },
      enabled: true,
    })
    const id2 = fresh.addRule({
      pattern: '/posts',
      response: { status: 200, body: 'second' },
      enabled: true,
    })
    fresh.removeRule(id1)
    const rule = fresh.match('https://example.com/posts', 'GET')
    expect(rule).not.toBeNull()
    expect(rule!.id).toBe(id2)
  })

  test('priority is independent per method — each method gets its first matching rule', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=priority-method-' + Math.random())
    const idGet1 = fresh.addRule({
      pattern: '/things',
      method: 'GET',
      response: { status: 200, body: 'get-first' },
      enabled: true,
    })
    fresh.addRule({
      pattern: '/things',
      method: 'GET',
      response: { status: 200, body: 'get-second' },
      enabled: true,
    })
    const idPost = fresh.addRule({
      pattern: '/things',
      method: 'POST',
      response: { status: 201, body: 'post-only' },
      enabled: true,
    })
    expect(fresh.match('https://example.com/things', 'GET')!.id).toBe(idGet1)
    expect(fresh.match('https://example.com/things', 'POST')!.id).toBe(idPost)
  })
})

describe('MockEngine — serialize mode field', () => {
  test('mode field survives serialize/deserialize round-trip', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=serial-mode-' + Math.random())
    fresh.addRule({
      pattern: '/rw',
      mode: 'rewrite',
      response: { status: 200, body: '' },
      enabled: true,
    })
    const json = fresh.serialize()
    const { mockEngine: fresh2 } = await import('../MockEngine?v=serial-mode2-' + Math.random())
    fresh2.deserialize(json)
    const rules = fresh2.getRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.mode).toBe('rewrite')
  })

  test('functions (bodyProvider, rewriteResponse) are not serialized', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=serial-fn-' + Math.random())
    fresh.addRule({
      pattern: '/fn',
      mode: 'rewrite',
      rewriteResponse: (res) => res,
      response: { status: 200, body: '', bodyProvider: () => 'x' },
      enabled: true,
    })
    const json = fresh.serialize()
    const { mockEngine: fresh2 } = await import('../MockEngine?v=serial-fn2-' + Math.random())
    fresh2.deserialize(json)
    const rules = fresh2.getRules()
    expect(rules[0]!.rewriteResponse).toBeUndefined()
    expect(rules[0]!.response.bodyProvider).toBeUndefined()
  })

  // redirectTo/block/modify are plain serializable data (unlike bodyProvider/
  // rewriteRequest/rewriteResponse) and must survive the round-trip below.

  test('redirectTo survives serialize/deserialize round-trip', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=serial-redirect-' + Math.random())
    fresh.addRule({
      pattern: '/api/data',
      redirectTo: 'https://staging.example.com/api/data',
      response: { status: 200, body: '' },
      enabled: true,
    })
    const json = fresh.serialize()
    const { mockEngine: fresh2 } = await import('../MockEngine?v=serial-redirect2-' + Math.random())
    fresh2.deserialize(json)
    const rules = fresh2.getRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.redirectTo).toBe('https://staging.example.com/api/data')
  })

  test('block survives serialize/deserialize round-trip', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=serial-block-' + Math.random())
    fresh.addRule({
      pattern: '/api/blocked',
      block: true,
      response: { status: 200, body: '' },
      enabled: true,
    })
    const json = fresh.serialize()
    const { mockEngine: fresh2 } = await import('../MockEngine?v=serial-block2-' + Math.random())
    fresh2.deserialize(json)
    const rules = fresh2.getRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.block).toBe(true)
  })

  test('modify block survives serialize/deserialize round-trip', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=serial-modify-' + Math.random())
    fresh.addRule({
      pattern: '/api/modify',
      modify: {
        setRequestHeaders: { 'x-hakka': '1' },
        removeQueryParams: ['debug'],
        status: 201,
        replaceBody: [{ find: 'foo', replace: 'bar' }],
      },
      response: { status: 200, body: '' },
      enabled: true,
    })
    const json = fresh.serialize()
    const { mockEngine: fresh2 } = await import('../MockEngine?v=serial-modify2-' + Math.random())
    fresh2.deserialize(json)
    const rules = fresh2.getRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.modify).toEqual({
      setRequestHeaders: { 'x-hakka': '1' },
      removeQueryParams: ['debug'],
      status: 201,
      replaceBody: [{ find: 'foo', replace: 'bar' }],
    })
  })

  test('redirectTo, block, and modify all survive together on one rule', async () => {
    const { mockEngine: fresh } = await import('../MockEngine?v=serial-combo-' + Math.random())
    fresh.addRule({
      pattern: '/api/combo',
      redirectTo: 'https://staging.example.com/api/combo',
      block: false,
      modify: { setResponseHeaders: { 'x-hakka-modified': '1' } },
      response: { status: 200, body: '' },
      enabled: true,
    })
    const json = fresh.serialize()
    const { mockEngine: fresh2 } = await import('../MockEngine?v=serial-combo2-' + Math.random())
    fresh2.deserialize(json)
    const rules = fresh2.getRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.redirectTo).toBe('https://staging.example.com/api/combo')
    expect(rules[0]!.block).toBe(false)
    expect(rules[0]!.modify).toEqual({ setResponseHeaders: { 'x-hakka-modified': '1' } })
  })
})
