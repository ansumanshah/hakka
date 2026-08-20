/**
 * A runnable check that a `RuleEngine` implementation honors the
 * matching/decision contract documented on `RuleEngine` (see
 * `ruleEngine.ts`). A third party implementing the interface can run
 * `checkRuleEngineConformance` against their own engine the same way
 * `ruleEngineConformance.test.ts` runs it against the three first-party
 * wrappers and a deliberately broken fake.
 */

import type { RuleEngine, RuleEngineDecision, RuleEngineRequest, RuleEngineResponse } from './ruleEngine'
import { RULE_ENGINE_DECISION_KINDS } from './ruleEngine'

/**
 * How a conformance run drives the engine under test. `createEngine` gives
 * the harness a fresh, unconfigured instance per check, so one check's
 * setup never leaks into another's. `arrangeMatch`/`unmatchedRequest` are
 * the parts every real engine needs its own implementation for — there is
 * no generic way to "configure a rule" or "pick a URL that won't match one".
 */
export interface RuleEngineProbe {
  /** Construct a fresh engine instance with no rules configured/active. */
  createEngine(): RuleEngine
  /**
   * Configure `engine` (freshly created, still unconfigured) so that the
   * returned request will match a rule and produce a non-`'pass'` decision
   * from `decideRequest`. Mutates `engine`'s underlying rule store; called
   * once per check that needs a match.
   */
  arrangeMatch(engine: RuleEngine): RuleEngineRequest
  /** A request guaranteed not to match anything on a freshly created, unconfigured engine. */
  unmatchedRequest(): RuleEngineRequest
  /** A well-formed response view to feed `decideResponse` — content is irrelevant to every check. */
  sampleResponse(): RuleEngineResponse
}

/** One named assertion's outcome. */
export interface RuleEngineConformanceCheck {
  readonly name: string
  readonly passed: boolean
  /** Present only when `passed` is false. */
  readonly detail?: string
}

/** The full result of a conformance run. */
export interface RuleEngineConformanceReport {
  readonly passed: boolean
  readonly checks: readonly RuleEngineConformanceCheck[]
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function isKnownDecisionKind(kind: string): kind is RuleEngineDecision['kind'] {
  return (RULE_ENGINE_DECISION_KINDS as readonly string[]).includes(kind)
}

async function runCheck(name: string, fn: () => Promise<void> | void): Promise<RuleEngineConformanceCheck> {
  try {
    await fn()
    return { name, passed: true }
  } catch (error: unknown) {
    return { name, passed: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Run every conformance check against `probe` and return a report. Each
 * check builds its own fresh engine, so one failure never cascades into an
 * unrelated false failure.
 */
export async function checkRuleEngineConformance(probe: RuleEngineProbe): Promise<RuleEngineConformanceReport> {
  const checks: RuleEngineConformanceCheck[] = []

  checks.push(
    await runCheck('decideRequest on an unmatched request yields pass', async () => {
      const engine = probe.createEngine()
      const decision = await engine.decideRequest(probe.unmatchedRequest())
      assert(decision.kind === 'pass', `expected 'pass' for an unmatched request, got '${decision.kind}'`)
    }),
  )

  checks.push(
    await runCheck('decideRequest on a matched request yields a non-pass decision', async () => {
      const engine = probe.createEngine()
      const request = probe.arrangeMatch(engine)
      const decision = await engine.decideRequest(request)
      assert(decision.kind !== 'pass', "expected a non-'pass' decision once a rule was arranged to match, got 'pass'")
      // A 'pause' decision is only meaningful if it actually carries a way to resolve it.
      if (decision.kind === 'pause') {
        assert(typeof decision.resolve === 'function', "'pause' decision is missing a callable resolve()")
      }
    }),
  )

  checks.push(
    await runCheck("every decideRequest decision's kind is a member of the closed union", async () => {
      const unmatchedEngine = probe.createEngine()
      const unmatched = await unmatchedEngine.decideRequest(probe.unmatchedRequest())
      assert(
        isKnownDecisionKind(unmatched.kind),
        `decideRequest returned an unknown decision kind '${unmatched.kind}' — not one of [${RULE_ENGINE_DECISION_KINDS.join(', ')}]`,
      )

      const matchedEngine = probe.createEngine()
      const request = probe.arrangeMatch(matchedEngine)
      const matched = await matchedEngine.decideRequest(request)
      assert(
        isKnownDecisionKind(matched.kind),
        `decideRequest returned an unknown decision kind '${matched.kind}' — not one of [${RULE_ENGINE_DECISION_KINDS.join(', ')}]`,
      )
    }),
  )

  checks.push(
    await runCheck('decideResponse, when implemented, is pass on an unmatched request/response pair', async () => {
      const engine = probe.createEngine()
      if (!engine.decideResponse) return // optional member — absence is not a failure
      const decision = await engine.decideResponse(probe.unmatchedRequest(), probe.sampleResponse())
      assert(
        decision.kind === 'pass',
        `expected 'pass' from decideResponse on an unmatched pair, got '${decision.kind}'`,
      )
      assert(
        isKnownDecisionKind(decision.kind),
        `decideResponse returned an unknown decision kind '${decision.kind}' — not one of [${RULE_ENGINE_DECISION_KINDS.join(', ')}]`,
      )
    }),
  )

  checks.push(
    await runCheck('describeRules(), when implemented, returns well-formed descriptors', async () => {
      const engine = probe.createEngine()
      if (!engine.describeRules) return // optional member — absence is not a failure
      probe.arrangeMatch(engine)
      const rules = engine.describeRules()
      assert(Array.isArray(rules), 'describeRules() did not return an array')
      for (const rule of rules) {
        assert(typeof rule.id === 'string' && rule.id.length > 0, 'a rule descriptor has a non-string or empty id')
        assert(typeof rule.enabled === 'boolean', 'a rule descriptor has a non-boolean enabled field')
        assert(typeof rule.label === 'string', 'a rule descriptor has a non-string label field')
      }
    }),
  )

  return { passed: checks.every((c) => c.passed), checks }
}
