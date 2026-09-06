import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mockEngine } from '../MockEngine'
import { createRuleBundle, parseRuleBundle } from '../ruleBundle'

describe('portable rule bundles', () => {
  beforeEach(() => mockEngine.clearRules())
  afterEach(() => mockEngine.clearRules())
  it('round-trips declarative overrides without losing headers, delays or match budgets', () => {
    const engine = mockEngine
    engine.addRule({
      id: 'override',
      pattern: '/api',
      enabled: true,
      mode: 'rewrite',
      response: { status: 201, body: { ok: true }, delay: 25, headers: { 'x-test': 'yes' } },
      modify: { setRequestHeaders: { 'x-debug': 'true' }, replaceBody: [{ find: 'old', replace: 'new' }] },
      skipCount: 2,
      stopAfter: 3,
    })
    const bundle = parseRuleBundle(JSON.parse(JSON.stringify(createRuleBundle(engine.getRules()))))
    const expected = engine.getRules()
    engine.clearRules()
    const restored = mockEngine
    for (const rule of bundle.rules) restored.addRule(rule)
    expect(restored.getRules()).toEqual(expected)
    expect(JSON.stringify(bundle)).not.toContain('hitCount')
  })

  it('rejects invalid members and duplicate IDs before returning a usable bundle', () => {
    const rule = { id: 'one', pattern: '/api', enabled: true, response: { status: 200, body: '' } }
    expect(() => parseRuleBundle({ version: 1, rules: [rule, { ...rule, id: 'two', enabled: 'yes' }] })).toThrow(
      'index 1',
    )
    expect(() => parseRuleBundle({ version: 1, rules: [rule, rule] })).toThrow('Duplicate')
    expect(() => parseRuleBundle({ version: 2, rules: [] })).toThrow('version 1')
  })

  it('refuses export when it would discard executable behavior', () => {
    const engine = mockEngine
    engine.addRule({ pattern: /api/, enabled: true, response: { status: 200, body: '' } })
    expect(() => createRuleBundle(engine.getRules())).toThrow('executable')
  })
})
