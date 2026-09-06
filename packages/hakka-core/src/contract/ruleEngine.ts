/**
 * RuleEngine describes mock, breakpoint, and throttle engines (ADR 0009).
 * Interceptors call concrete engines directly; this interface is for registration
 * and introspection. Engines are always-live rule stores with no capture lifecycle.
 * @experimental Pending validation by a third-party consumer.
 */

import type { ReadonlyRecord } from '../model/types'

/** Which phase of a request a decision applies to — before send, or after the real/substituted response returns. */
export type RuleEnginePhase = 'request' | 'response'

/**
 * Normalized inbound view a `RuleEngine` decides against. Deliberately a
 * NEW, minimal shape — not a reuse of `MockRequestContext`
 * (`engine/MockEngine.ts`) or `PausedRequest` (`engine/BreakpointEngine.ts`):
 * those two already disagree with each other on `body`'s optionality
 * (`string | undefined` vs `string | null`), so absorbing either into this
 * contract would mean changing an existing public type, which is out of
 * scope for an additive slice. First-party wrappers adapt to/from their own
 * engine's native shape at the boundary; see each wrapper's doc comment.
 */
export interface RuleEngineRequest {
  /**
   * Optional stable identifier for correlating this decision with a
   * captured record (e.g. the interceptor's own `id`). Omit for a
   * synthetic/introspection-only call — a wrapper that needs an id to talk
   * to its underlying engine (breakpoint's `pause()`) synthesizes a
   * throwaway one when this is absent.
   */
  readonly id?: string
  readonly url: string
  readonly method: string
  readonly headers: ReadonlyRecord<string, string>
  /** `undefined` when no body was captured, `null` when a body exists but wasn't read/available. */
  readonly body?: string | null
}

/** Normalized response view — both what `decideResponse` receives and what a `'rewrite'` decision hands back. */
export interface RuleEngineResponse {
  readonly status: number
  readonly headers: ReadonlyRecord<string, string>
  readonly body: string
}

/** Payload for a `'substitute'` decision — a full response served without ever reaching the network. */
export interface RuleEngineSubstituteResponse extends RuleEngineResponse {
  /** Artificial delay (ms) to hold before returning this response. 0/undefined = immediate. */
  readonly delayMs?: number
}

/**
 * The closed set of outcomes a `RuleEngine` may hand back to whatever is
 * driving it. Modeled as a discriminated union — not booleans, not an
 * open-ended options bag — specifically so a new engine cannot invent an
 * unhandled outcome: a consumer switching on `kind` gets a compile error on
 * a non-exhaustive switch the moment a member is added, and
 * `ruleEngineConformance.ts` checks every returned decision's `kind` is one
 * of these six at runtime for JS/dynamically-typed callers.
 *
 * - `'pass'` — nothing matched (or nothing to do); proceed unmodified. The
 *   implicit decision when a phase is skipped entirely (see
 *   `RuleEngine.decideResponse`'s doc comment).
 * - `'substitute'` — serve `response` without ever reaching the network.
 *   Request-phase only; `MockEngine`'s `'mock'` mode.
 * - `'block'` — abort with a network error before/instead of sending.
 *   `reason` is a human-readable message, not a machine code — mirrors
 *   `MockRule.block` and `ThrottleEngine`'s `'offline'` profile, which
 *   produce this from two unrelated engines for two unrelated reasons.
 * - `'delay'` — hold for `ms` before the request proceeds to the network
 *   unmodified. `ThrottleEngine`'s latency; request-phase only.
 * - `'rewrite'` — the real request proceeds; `request` and/or `response`
 *   carry the transformed values to use in place of the originals. At least
 *   one of the two MUST be set — an engine with nothing to change returns
 *   `'pass'` instead. `request` is only meaningful from `decideRequest`,
 *   `response` only from `decideResponse` — `MockEngine`'s `'rewrite'` mode
 *   splits its work across both calls this way (see
 *   `MockEngine.ts`'s `createMockRuleEngine` doc comment).
 * - `'pause'` — hold the request/response for external (human) input before
 *   any of the other five outcomes is known. The ONLY decision kind whose
 *   resolution may be UNBOUNDED — `resolve()` settles whenever whatever is
 *   holding the pause (a UI, a test) calls it, which may be never. This is
 *   why `'pause'` must be returned SYNCHRONOUSLY (or after only bounded
 *   work) rather than folded into an outer `Promise<RuleEngineDecision>`:
 *   an engine that instead awaited its own pause internally before
 *   resolving `decideRequest`/`decideResponse` would make every caller's
 *   await hang for as long as the human takes, indistinguishable from a
 *   hung/broken engine. `BreakpointEngine`'s wrapper is the only first-party
 *   source of this decision kind.
 */
export type RuleEngineDecision =
  | { readonly kind: 'pass' }
  | { readonly kind: 'substitute'; readonly response: RuleEngineSubstituteResponse }
  | { readonly kind: 'block'; readonly reason: string }
  | { readonly kind: 'delay'; readonly ms: number }
  | { readonly kind: 'rewrite'; readonly request?: RuleEngineRequest; readonly response?: RuleEngineResponse }
  | { readonly kind: 'pause'; readonly phase: RuleEnginePhase; readonly resolve: () => Promise<RuleEngineDecision> }

/** Every `RuleEngineDecision['kind']` value, for runtime validation (conformance harness, or a third party's own check) against the closed union. */
export const RULE_ENGINE_DECISION_KINDS = ['pass', 'substitute', 'block', 'delay', 'rewrite', 'pause'] as const

/**
 * One rule, summarized for introspection (a settings panel, a registry
 * listing what's active) — never matched against; matching stays internal
 * to the engine. `label` is free-form (not the same closed vocabulary as
 * `RuleEngineDecision['kind']`) because a rule's *configured* behavior
 * (e.g. `'rewrite'`) and the *decision* it eventually produces are related
 * but not identical — a disabled rule has a label but produces no decision
 * at all.
 */
export interface RuleEngineRuleDescriptor {
  readonly id: string
  readonly enabled: boolean
  readonly label: string
}

/** Identity fields describing a `RuleEngine` without running it. */
export interface RuleEngineIdentity {
  readonly id: string
  /** Free-form — not a closed enum, so a third-party engine can self-describe without widening this contract. First-party values: `'mock'`, `'breakpoint'`, `'throttle'`. */
  readonly kind: string
}

/**
 * A rule engine: holds a set of rules (or, for an engine like throttle with
 * no discrete rule list, one active configuration) and decides what should
 * happen to a request/response pair against them — the `RuleEngine` axis
 * from ADR 0009.
 *
 * There is deliberately no `matches()`-only method separate from
 * `decideRequest`/`decideResponse` — for this contract, "does anything
 * match" and "what happens as a result" are the same question; splitting
 * them (as `MockEngine.peek()` vs `.match()` does, to avoid inflating hit
 * counts on a preview-only check) is left to each engine's own
 * wrapper/hit-counting policy, not encoded in the shared interface. See
 * `createMockRuleEngine`'s doc comment for the concrete tradeoff this
 * causes for that engine.
 */
export interface RuleEngine extends RuleEngineIdentity {
  /**
   * List current rules for introspection. Optional — an engine with no
   * per-rule matching (see `createThrottleRuleEngine`'s doc comment for why
   * a single active profile is still represented as one descriptor here)
   * may still implement it, but a consumer must treat its absence as
   * "nothing to list", not an error. NOT a hot path — call at most once per
   * UI render, never once per request.
   */
  describeRules?(): readonly RuleEngineRuleDescriptor[]

  /**
   * Decide what should happen to a request BEFORE it is sent. Called once
   * per request, pre-network. May return synchronously or resolve a Promise
   * for BOUNDED async work only (e.g. a mock rule's dynamic `bodyProvider`)
   * — see `RuleEngineDecision`'s `'pause'` member for the one outcome whose
   * settlement may be unbounded, which must be surfaced as that decision
   * kind rather than awaited away inside this call.
   */
  decideRequest(request: RuleEngineRequest): RuleEngineDecision | Promise<RuleEngineDecision>

  /**
   * Decide what should happen to the REAL (or substituted) response, after
   * the network call resolved and before it reaches the original caller.
   * Optional — an engine whose entire effect happens at the request phase
   * (a plain substitute, a block, a throttle delay) has nothing to do here
   * and omits it entirely; a consumer that finds no `decideResponse` on an
   * engine MUST treat that as an implicit `'pass'` for every response,
   * never as an error or a reason to skip the engine elsewhere.
   */
  decideResponse?(
    request: RuleEngineRequest,
    response: RuleEngineResponse,
  ): RuleEngineDecision | Promise<RuleEngineDecision>
}
