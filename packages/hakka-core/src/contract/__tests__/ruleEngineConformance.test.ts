import { describe, expect, test } from 'bun:test'

import { breakpointEngine, createBreakpointRuleEngine } from '../../engine/BreakpointEngine'
import { createMockRuleEngine, mockEngine } from '../../engine/MockEngine'
import { createThrottleRuleEngine, ThrottleEngine } from '../../engine/ThrottleEngine'
import type { RuleEngine, RuleEngineDecision, RuleEngineRequest } from '../ruleEngine'
import { checkRuleEngineConformance, type RuleEngineProbe } from '../ruleEngineConformance'

function req(url: string): RuleEngineRequest {
  return { url, method: 'GET', headers: {} }
}
function res(): { status: number; headers: Record<string, string>; body: string } {
  return { status: 200, headers: {}, body: '{}' }
}

// ---------------------------------------------------------------------------
// A trivial in-memory RuleEngine fake — no real matching machinery, just a
// `configureMatch(url)` hook a probe can call to make exactly one URL trigger
// a non-pass decision. Mirrors conformance.test.ts's WellBehavedFakeSource.
// ---------------------------------------------------------------------------
class WellBehavedFakeRuleEngine implements RuleEngine {
  readonly id = 'test.fake-rule-engine'
  readonly kind = 'fake'
  private matchingUrl: string | null = null

  configureMatch(url: string): void {
    this.matchingUrl = url
  }

  decideRequest(request: RuleEngineRequest): RuleEngineDecision {
    if (request.url !== this.matchingUrl) return { kind: 'pass' }
    return { kind: 'block', reason: 'matched by fake' }
  }
}

const wellBehavedProbe: RuleEngineProbe = {
  createEngine: () => new WellBehavedFakeRuleEngine(),
  arrangeMatch: (engine) => {
    const url = 'https://example.test/fake-match'
    ;(engine as WellBehavedFakeRuleEngine).configureMatch(url)
    return req(url)
  },
  unmatchedRequest: () => req('https://example.test/fake-unmatched'),
  sampleResponse: res,
}

describe('checkRuleEngineConformance — well-behaved fake', () => {
  test('passes every check', async () => {
    const report = await checkRuleEngineConformance(wellBehavedProbe)
    const failures = report.checks.filter((c) => !c.passed)
    expect(failures).toEqual([])
    expect(report.passed).toBe(true)
  })
})

/**
 * Deliberately broken: ignores matching entirely and blocks EVERY request,
 * including ones nothing was ever configured to match. Proves the harness
 * catches an engine that over-triggers.
 */
class AlwaysBlocksFakeRuleEngine implements RuleEngine {
  readonly id = 'test.broken-always-blocks'
  readonly kind = 'fake'
  decideRequest(): RuleEngineDecision {
    return { kind: 'block', reason: 'always blocked — BUG: ignores matching' }
  }
}

describe('checkRuleEngineConformance — catches an engine that ignores matching', () => {
  test('flags only the unmatched-yields-pass check', async () => {
    const probe: RuleEngineProbe = {
      createEngine: () => new AlwaysBlocksFakeRuleEngine(),
      arrangeMatch: () => req('https://example.test/anything'),
      unmatchedRequest: () => req('https://example.test/anything-else'),
      sampleResponse: res,
    }
    const report = await checkRuleEngineConformance(probe)
    expect(report.passed).toBe(false)
    const unmatchedCheck = report.checks.find((c) => c.name === 'decideRequest on an unmatched request yields pass')
    expect(unmatchedCheck?.passed).toBe(false)
    // Checks unrelated to the bug still pass.
    const matchedCheck = report.checks.find(
      (c) => c.name === 'decideRequest on a matched request yields a non-pass decision',
    )
    expect(matchedCheck?.passed).toBe(true)
  })
})

/**
 * Deliberately broken: never actually applies a configured rule — always
 * returns 'pass'. Proves the harness catches an engine that silently no-ops.
 */
class NeverAppliesFakeRuleEngine implements RuleEngine {
  readonly id = 'test.broken-never-applies'
  readonly kind = 'fake'
  decideRequest(): RuleEngineDecision {
    return { kind: 'pass' } // BUG: ignores any configured match
  }
}

describe('checkRuleEngineConformance — catches an engine that never applies its rules', () => {
  test('flags only the matched-yields-non-pass check', async () => {
    const probe: RuleEngineProbe = {
      createEngine: () => new NeverAppliesFakeRuleEngine(),
      arrangeMatch: () => req('https://example.test/should-match'),
      unmatchedRequest: () => req('https://example.test/should-not-match'),
      sampleResponse: res,
    }
    const report = await checkRuleEngineConformance(probe)
    expect(report.passed).toBe(false)
    const matchedCheck = report.checks.find(
      (c) => c.name === 'decideRequest on a matched request yields a non-pass decision',
    )
    expect(matchedCheck?.passed).toBe(false)
    const unmatchedCheck = report.checks.find((c) => c.name === 'decideRequest on an unmatched request yields pass')
    expect(unmatchedCheck?.passed).toBe(true)
  })
})

/**
 * Deliberately broken: on a match, invents a decision kind the closed union
 * doesn't define. Proves the closed-union check actually rejects an
 * unhandled outcome, not just a hypothetical TypeScript compile error — a
 * JS/dynamically-typed third party could return exactly this.
 */
class UnknownKindFakeRuleEngine implements RuleEngine {
  readonly id = 'test.broken-unknown-kind'
  readonly kind = 'fake'
  private matchingUrl: string | null = null

  configureMatch(url: string): void {
    this.matchingUrl = url
  }

  decideRequest(request: RuleEngineRequest): RuleEngineDecision {
    if (request.url !== this.matchingUrl) return { kind: 'pass' }
    // BUG: 'teleport' is not one of RULE_ENGINE_DECISION_KINDS.
    return { kind: 'teleport' } as unknown as RuleEngineDecision
  }
}

describe('checkRuleEngineConformance — catches an invented decision kind', () => {
  test('flags only the closed-union membership check', async () => {
    const probe: RuleEngineProbe = {
      createEngine: () => new UnknownKindFakeRuleEngine(),
      arrangeMatch: (engine) => {
        const url = 'https://example.test/unknown-kind-match'
        ;(engine as UnknownKindFakeRuleEngine).configureMatch(url)
        return req(url)
      },
      unmatchedRequest: () => req('https://example.test/unknown-kind-unmatched'),
      sampleResponse: res,
    }
    const report = await checkRuleEngineConformance(probe)
    expect(report.passed).toBe(false)
    const unionCheck = report.checks.find(
      (c) => c.name === "every decideRequest decision's kind is a member of the closed union",
    )
    expect(unionCheck?.passed).toBe(false)
    // The unmatched/matched-yields-non-pass checks don't inspect WHICH kind — both still pass.
    const unmatchedCheck = report.checks.find((c) => c.name === 'decideRequest on an unmatched request yields pass')
    const matchedCheck = report.checks.find(
      (c) => c.name === 'decideRequest on a matched request yields a non-pass decision',
    )
    expect(unmatchedCheck?.passed).toBe(true)
    expect(matchedCheck?.passed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Real first-party wrappers — every engine ADR 0009 named for this axis.
// ---------------------------------------------------------------------------

describe('checkRuleEngineConformance — createMockRuleEngine, plain mock rule', () => {
  const probe: RuleEngineProbe = {
    createEngine: () => {
      mockEngine.clearRules()
      return createMockRuleEngine()
    },
    arrangeMatch: () => {
      mockEngine.addRule({ pattern: '/plain-mock', response: { status: 200, body: '{"ok":true}' }, enabled: true })
      return req('https://example.test/plain-mock')
    },
    unmatchedRequest: () => req('https://example.test/unmatched-mock'),
    sampleResponse: res,
  }

  test('passes every check', async () => {
    const report = await checkRuleEngineConformance(probe)
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })
})

describe('checkRuleEngineConformance — createMockRuleEngine, block rule', () => {
  const probe: RuleEngineProbe = {
    createEngine: () => {
      mockEngine.clearRules()
      return createMockRuleEngine()
    },
    arrangeMatch: () => {
      mockEngine.addRule({
        pattern: '/block-me',
        block: true,
        response: { status: 503, body: 'blocked' },
        enabled: true,
      })
      return req('https://example.test/block-me')
    },
    unmatchedRequest: () => req('https://example.test/unmatched-block'),
    sampleResponse: res,
  }

  test('passes every check', async () => {
    const report = await checkRuleEngineConformance(probe)
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })
})

describe('checkRuleEngineConformance — createMockRuleEngine, rewrite rule', () => {
  const probe: RuleEngineProbe = {
    createEngine: () => {
      mockEngine.clearRules()
      return createMockRuleEngine()
    },
    arrangeMatch: () => {
      mockEngine.addRule({
        pattern: '/rewrite-me',
        modify: { setRequestHeaders: { 'x-test': '1' } },
        response: { status: 200, body: 'unused' },
        enabled: true,
      })
      return req('https://example.test/rewrite-me')
    },
    unmatchedRequest: () => req('https://example.test/unmatched-rewrite'),
    sampleResponse: res,
  }

  test('passes every check', async () => {
    const report = await checkRuleEngineConformance(probe)
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })
})

describe('checkRuleEngineConformance — createThrottleRuleEngine', () => {
  const probe: RuleEngineProbe = {
    createEngine: () => {
      ThrottleEngine.setProfile('none')
      return createThrottleRuleEngine()
    },
    arrangeMatch: () => {
      ThrottleEngine.setProfile('slow-3g')
      return req('https://example.test/anything')
    },
    unmatchedRequest: () => req('https://example.test/anything-else'),
    sampleResponse: res,
  }

  test('passes every check', async () => {
    const report = await checkRuleEngineConformance(probe)
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })

  test('resets to none after the run (no leaked global state)', () => {
    ThrottleEngine.setProfile('none')
    expect(ThrottleEngine.isActive).toBe(false)
  })
})

describe('checkRuleEngineConformance — createBreakpointRuleEngine, request phase', () => {
  const probe: RuleEngineProbe = {
    createEngine: () => {
      breakpointEngine.resumeAll()
      breakpointEngine.clearBreakpoints()
      return createBreakpointRuleEngine()
    },
    arrangeMatch: () => {
      breakpointEngine.addBreakpoint({ pattern: '/bp-request', on: 'request', enabled: true })
      return req('https://example.test/bp-request')
    },
    unmatchedRequest: () => req('https://example.test/unmatched-bp'),
    sampleResponse: res,
  }

  test('passes every check', async () => {
    const report = await checkRuleEngineConformance(probe)
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Content-level checks beyond "is the kind right" — the conformance harness
// only checks shape/kind, not that a wrapper carries the RIGHT payload.
// ---------------------------------------------------------------------------

describe('createMockRuleEngine — decision content', () => {
  test('substitute carries the rule response body/status/delay', async () => {
    mockEngine.clearRules()
    mockEngine.addRule({
      pattern: '/content-mock',
      response: { status: 201, body: '{"hello":"world"}', delay: 5 },
      enabled: true,
    })
    const engine = createMockRuleEngine()
    const decision = await engine.decideRequest(req('https://example.test/content-mock'))
    expect(decision.kind).toBe('substitute')
    if (decision.kind === 'substitute') {
      expect(decision.response.status).toBe(201)
      expect(decision.response.body).toBe('{"hello":"world"}')
      expect(decision.response.delayMs).toBe(5)
    }
  })

  test('block rule yields block, not substitute, with the reason set', async () => {
    // Guards against a block-only rule (no mode/redirectTo/modify) silently
    // falling through to the substitute branch — the generic conformance
    // harness only asserts "non-pass", so 'substitute' would satisfy it too.
    mockEngine.clearRules()
    mockEngine.addRule({
      pattern: '/content-block',
      block: true,
      response: { status: 503, body: 'blocked' },
      enabled: true,
    })
    const engine = createMockRuleEngine()
    const decision = await engine.decideRequest(req('https://example.test/content-block'))
    expect(decision.kind).toBe('block')
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('Blocked by Hakka')
    }
  })

  test('rewrite reflects both phases of a modify rule', async () => {
    mockEngine.clearRules()
    mockEngine.addRule({
      pattern: '/content-rewrite',
      modify: {
        setRequestHeaders: { 'x-test': '1' },
        setResponseHeaders: { 'x-mock': 'yes' },
        status: 201,
      },
      response: { status: 200, body: 'unused' },
      enabled: true,
    })
    const engine = createMockRuleEngine()
    const request = req('https://example.test/content-rewrite')

    const reqDecision = await engine.decideRequest(request)
    expect(reqDecision.kind).toBe('rewrite')
    if (reqDecision.kind === 'rewrite') {
      expect(reqDecision.request?.headers['x-test']).toBe('1')
    }

    const resDecision = await engine.decideResponse!(request, { status: 200, headers: {}, body: '{"a":1}' })
    expect(resDecision.kind).toBe('rewrite')
    if (resDecision.kind === 'rewrite') {
      expect(resDecision.response?.status).toBe(201)
      expect(resDecision.response?.headers['x-mock']).toBe('yes')
    }
  })
})

describe('createThrottleRuleEngine — decision content', () => {
  test('offline profile yields block, not delay', () => {
    ThrottleEngine.setProfile('offline')
    const engine = createThrottleRuleEngine()
    const decision = engine.decideRequest(req('https://example.test/anything')) as RuleEngineDecision
    expect(decision.kind).toBe('block')
    ThrottleEngine.setProfile('none')
  })

  test('a latency profile yields delay with the profile’s ms', () => {
    ThrottleEngine.setProfile('fast-3g')
    const engine = createThrottleRuleEngine()
    const decision = engine.decideRequest(req('https://example.test/anything')) as RuleEngineDecision
    expect(decision.kind).toBe('delay')
    if (decision.kind === 'delay') expect(decision.ms).toBe(150)
    ThrottleEngine.setProfile('none')
  })
})

describe('createBreakpointRuleEngine — pause resolves to the real outcome', () => {
  test('request-phase pause resolves to rewrite when the overlay supplies edits', async () => {
    breakpointEngine.resumeAll()
    breakpointEngine.clearBreakpoints()
    breakpointEngine.addBreakpoint({ pattern: '/pause-edit', on: 'request', enabled: true })
    const engine = createBreakpointRuleEngine()
    const decision = engine.decideRequest(req('https://example.test/pause-edit')) as RuleEngineDecision
    expect(decision.kind).toBe('pause')
    if (decision.kind !== 'pause') return

    const resolved = decision.resolve()
    // The pause is now pending — resume it as the overlay would.
    const [paused] = breakpointEngine.getPaused()
    expect(paused).toBeDefined()
    breakpointEngine.resume(paused!.id, { url: 'https://example.test/pause-edit?edited=1' })

    const final = await resolved
    expect(final.kind).toBe('rewrite')
    if (final.kind === 'rewrite') expect(final.request?.url).toBe('https://example.test/pause-edit?edited=1')

    breakpointEngine.clearBreakpoints()
  })

  test('request-phase pause resolves to block when the overlay aborts', async () => {
    breakpointEngine.resumeAll()
    breakpointEngine.clearBreakpoints()
    breakpointEngine.addBreakpoint({ pattern: '/pause-abort', on: 'request', enabled: true })
    const engine = createBreakpointRuleEngine()
    const decision = engine.decideRequest(req('https://example.test/pause-abort')) as RuleEngineDecision
    expect(decision.kind).toBe('pause')
    if (decision.kind !== 'pause') return

    const resolved = decision.resolve()
    const [paused] = breakpointEngine.getPaused()
    breakpointEngine.abort(paused!.id)

    const final = await resolved
    expect(final.kind).toBe('block')

    breakpointEngine.clearBreakpoints()
  })

  test('response-phase pause resolves to rewrite carrying the edited response', async () => {
    breakpointEngine.resumeAll()
    breakpointEngine.clearBreakpoints()
    breakpointEngine.addBreakpoint({ pattern: '/pause-response', on: 'response', enabled: true })
    const engine = createBreakpointRuleEngine()
    const request = req('https://example.test/pause-response')
    const decision = engine.decideResponse!(request, { status: 200, headers: {}, body: 'orig' }) as RuleEngineDecision
    expect(decision.kind).toBe('pause')
    if (decision.kind !== 'pause') return

    const resolved = decision.resolve()
    const [paused] = breakpointEngine.getPaused()
    breakpointEngine.resume(paused!.id, { status: 500, body: 'edited' })

    const final = await resolved
    expect(final.kind).toBe('rewrite')
    if (final.kind === 'rewrite') {
      expect(final.response?.status).toBe(500)
      expect(final.response?.body).toBe('edited')
    }

    breakpointEngine.clearBreakpoints()
  })
})
