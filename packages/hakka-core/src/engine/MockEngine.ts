/** MockEngine — intercepts network requests and returns custom responses. */

import type {
  RuleEngine,
  RuleEngineDecision,
  RuleEngineRequest,
  RuleEngineResponse,
  RuleEngineRuleDescriptor,
} from '../contract/ruleEngine'

/** Minimal request context passed to bodyProvider and rewrite hooks. */
export interface MockRequestContext {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** Minimal response context passed to rewriteResponse. */
export interface MockResponseContext {
  status: number
  headers: Record<string, string>
  body: string
}

export interface MockResponse {
  status: number
  headers?: Record<string, string>
  body: string | object
  /** Artificial delay in ms before responding */
  delay?: number
  /**
   * Dynamic body provider. Called instead of `body` when present.
   * Receives the matched request context. May be async.
   */
  bodyProvider?: (req: MockRequestContext) => string | object | Promise<string | object>
}

/**
 * Declarative request/response edits — plain data, no functions, so a rule
 * carrying only `modify` is fully serializable and drivable over the wire
 * (`control.ts`'s `mock.add`). Applied through the rewrite path and composes
 * with `redirectTo`. v1 scope is deliberately narrow: header/query
 * set-or-remove, a status override, and plain-string (no regex) body replace.
 */
export interface MockRuleModify {
  /** Set/overwrite these headers on the outgoing request. */
  setRequestHeaders?: Record<string, string>
  /** Remove these headers (case-insensitive) from the outgoing request. */
  removeRequestHeaders?: string[]
  /** Set/overwrite these query-string parameters on the outgoing request URL. */
  setQueryParams?: Record<string, string>
  /** Remove these query-string parameters from the outgoing request URL. */
  removeQueryParams?: string[]
  /** Override the real response's status code. */
  status?: number
  /** Set/overwrite these headers on the real response. */
  setResponseHeaders?: Record<string, string>
  /** Remove these headers (case-insensitive) from the real response. */
  removeResponseHeaders?: string[]
  /**
   * Plain-string find/replace pairs applied to the response body, in order.
   * No regexes in v1 — a rule set exported/imported as JSON must not carry
   * live RegExp objects with unpredictable flags/backtracking cost.
   */
  replaceBody?: Array<{ find: string; replace: string }>
}

export interface MockRule {
  id: string
  /** URL pattern to match — string (substring/exact) or RegExp */
  pattern: string | RegExp
  /** HTTP method filter. If omitted, matches all methods */
  method?: string
  /**
   * Rule mode:
   * - `'mock'` (default): intercept and serve the rule's response without making a real request.
   * - `'rewrite'`: let the real request through, then apply `rewriteRequest`/`rewriteResponse` transforms.
   */
  mode?: 'mock' | 'rewrite'
  /**
   * Transform the outgoing request before it is sent to the network.
   * Only applied in `'rewrite'` mode, on the `fetch` interceptor. Return a new
   * context object. (XHR rewrite rules pass through untransformed — XHR hands
   * the real response to the caller directly, so it cannot be substituted.)
   */
  rewriteRequest?: (req: MockRequestContext) => MockRequestContext | Promise<MockRequestContext>
  /**
   * Transform the real response before it is surfaced to the caller.
   * Only applied in `'rewrite'` mode, on the `fetch` interceptor. Return a new
   * context object.
   */
  rewriteResponse?: (
    res: MockResponseContext,
    req: MockRequestContext,
  ) => MockResponseContext | Promise<MockResponseContext>
  /**
   * Map Remote: redirect a matched request to a different URL (declarative — no
   * function needed). Applied through the rewrite path, so the captured record
   * shows the target URL marked `rewritten`. Combinable with `rewriteResponse`.
   */
  redirectTo?: string
  /**
   * Declarative header/query/status/body edits (see `MockRuleModify`).
   * Like `redirectTo`, this triggers the rewrite path on its own — no
   * `mode: 'rewrite'` or `rewriteRequest`/`rewriteResponse` function required.
   * Applied before any rewrite function, which still runs on top if present.
   */
  modify?: MockRuleModify
  /**
   * Block: abort the matched request with a network error before it is sent.
   * Useful for testing error/offline states for one endpoint.
   */
  block?: boolean
  response: MockResponse
  enabled: boolean
  hitCount: number
}

export type MockRuleInput = Omit<MockRule, 'id' | 'hitCount'> & { id?: string }

let ruleIdCounter = 0
const SAFE_REGEXP_FLAGS = /^[gimsuy]*$/

export type NativeMockRulePayload = {
  id: string
  pattern: string
  isRegex: boolean
  regexFlags?: string
  method?: string
  status: number
  headers: Record<string, string>
  body: string
  delayMs: number
  enabled: boolean
  redirectTo?: string
  block?: boolean
  modify?: MockRuleModify
}

export interface NativeMockBridge {
  addMockRule(rule: NativeMockRulePayload): void
  removeMockRule(id: string): void
  setMockRuleEnabled(id: string, enabled: boolean): void
}

/** Revives a `{ __regexp, source, flags }` shape back into a RegExp (or the raw source if unsafe). */
function reviveRegExpPattern(source: string, flags: string): string | RegExp {
  if (!SAFE_REGEXP_FLAGS.test(flags)) {
    return source
  }
  try {
    return new RegExp(source, flags)
  } catch {
    return source
  }
}

function responseBodyToString(body: MockResponse['body']): string {
  return typeof body === 'object' ? JSON.stringify(body) : body
}

function toNativeRule(rule: MockRule): NativeMockRulePayload {
  const pattern = rule.pattern instanceof RegExp ? rule.pattern.source : rule.pattern
  const regexFlags = rule.pattern instanceof RegExp ? rule.pattern.flags : undefined
  const delayMs = Math.max(0, rule.response.delay ?? 0)

  return {
    id: rule.id,
    pattern,
    isRegex: rule.pattern instanceof RegExp,
    regexFlags,
    method: rule.method,
    status: rule.response.status,
    headers: rule.response.headers ?? {},
    body: responseBodyToString(rule.response.body),
    delayMs,
    enabled: rule.enabled,
    redirectTo: rule.redirectTo,
    block: rule.block,
    modify: rule.modify,
  }
}

// Declarative `modify` application: plain data in, plain data out, never throws.

/** Set/remove edits for a plain header map. Case-insensitive removal; exact-key set. */
function applyHeaderEdits(
  headers: Record<string, string>,
  set: Record<string, string> | undefined,
  remove: string[] | undefined,
): Record<string, string> {
  if (!set && !remove) return headers
  const next = { ...headers }
  if (remove && remove.length > 0) {
    const removeLower = new Set(remove.map((h) => h.toLowerCase()))
    for (const key of Object.keys(next)) {
      if (removeLower.has(key.toLowerCase())) delete next[key]
    }
  }
  if (set) {
    for (const [key, value] of Object.entries(set)) {
      next[key] = value
    }
  }
  return next
}

/**
 * Set/remove edits for a URL's query string. Handles absolute URLs directly;
 * falls back to patching just the query-string portion for relative URLs
 * (`new URL()` without a base throws on those).
 */
function applyQueryEdits(url: string, set: Record<string, string> | undefined, remove: string[] | undefined): string {
  if (!set && !remove) return url
  try {
    const parsed = new URL(url)
    if (remove) for (const key of remove) parsed.searchParams.delete(key)
    if (set) for (const [key, value] of Object.entries(set)) parsed.searchParams.set(key, value)
    return parsed.toString()
  } catch {
    const [base, query = ''] = url.split('?')
    const params = new URLSearchParams(query)
    if (remove) for (const key of remove) params.delete(key)
    if (set) for (const [key, value] of Object.entries(set)) params.set(key, value)
    const next = params.toString()
    return next ? `${base}?${next}` : (base ?? '')
  }
}

/** Plain-string (no regex) find/replace, applied in order. Empty `find` is skipped (would loop pathologically). */
function applyBodyReplacements(
  body: string,
  replacements: Array<{ find: string; replace: string }> | undefined,
): string {
  if (!replacements || replacements.length === 0) return body
  let next = body
  for (const { find, replace } of replacements) {
    if (!find) continue
    next = next.split(find).join(replace)
  }
  return next
}

function applyModifyToRequest(req: MockRequestContext, modify: MockRuleModify): MockRequestContext {
  const url = applyQueryEdits(req.url, modify.setQueryParams, modify.removeQueryParams)
  const headers = applyHeaderEdits(req.headers, modify.setRequestHeaders, modify.removeRequestHeaders)
  if (url === req.url && headers === req.headers) return req
  return { ...req, url, headers }
}

function applyModifyToResponse(res: MockResponseContext, modify: MockRuleModify): MockResponseContext {
  const status = modify.status ?? res.status
  const headers = applyHeaderEdits(res.headers, modify.setResponseHeaders, modify.removeResponseHeaders)
  const body = applyBodyReplacements(res.body, modify.replaceBody)
  if (status === res.status && headers === res.headers && body === res.body) return res
  return { status, headers, body }
}

class MockEngine {
  private rules: MockRule[] = []
  private rulesById = new Map<string, MockRule>()
  private stringMatchersById = new Map<string, (url: string) => boolean>()
  private nativeSyncedRuleIds = new Set<string>()
  private nativeBridge: NativeMockBridge | null = null

  /** Register the native bridge for syncing rules to native. Call once at startup. */
  registerNativeBridge(bridge: NativeMockBridge | null): void {
    this.nativeBridge = bridge
  }

  /**
   * Adds a rule and returns its id (caller-supplied, or generated). If
   * `rule.id` matches an existing rule, replaces it in place, preserving
   * insertion order.
   */
  addRule(rule: MockRuleInput): string {
    const id = rule.id ?? `mock_${++ruleIdCounter}_${Date.now()}`
    const { id: _ignored, ...rest } = rule
    const storedRule: MockRule = { ...rest, id, hitCount: 0 }

    const existingIndex = this.rules.findIndex((r) => r.id === id)
    if (existingIndex >= 0) {
      this.rules[existingIndex] = storedRule
    } else {
      this.rules.push(storedRule)
    }
    this.rulesById.set(id, storedRule)
    this.stringMatchersById.delete(id)
    if (typeof storedRule.pattern === 'string') {
      // Captures the pattern value, not the mutable rule reference.
      const pattern = storedRule.pattern
      this.stringMatchersById.set(id, (url) => url.includes(pattern))
    }
    this.syncNativeAdd(storedRule)
    return id
  }

  removeRule(id: string): void {
    if (!this.rulesById.delete(id)) return
    this.stringMatchersById.delete(id)
    this.rules = this.rules.filter((r) => r.id !== id)
    this.syncNativeRemove(id)
  }

  enableRule(id: string): void {
    const rule = this.rulesById.get(id)
    if (rule) {
      rule.enabled = true
      this.syncNativeEnabled(id, true)
    }
  }

  disableRule(id: string): void {
    const rule = this.rulesById.get(id)
    if (rule) {
      rule.enabled = false
      this.syncNativeEnabled(id, false)
    }
  }

  getRules(): MockRule[] {
    return [...this.rules]
  }

  clearRules(): void {
    this.clearNativeSyncedRules()
    this.rules = []
    this.rulesById.clear()
    this.stringMatchersById.clear()
  }

  syncNativeRules(): void {
    this.clearNativeSyncedRules()
    for (const rule of this.rules) {
      this.syncNativeAdd(rule)
    }
  }

  /**
   * Finds the matching enabled rule without recording a hit — use when a
   * match may not actually be applied (e.g. XHR rewrite rules pass through,
   * or a throttle/offline error aborts the request).
   */
  peek(url: string, method: string): MockRule | null {
    for (const rule of this.rules) {
      if (!rule.enabled) continue
      if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) continue

      if (typeof rule.pattern === 'string') {
        const matcher = this.stringMatchersById.get(rule.id)
        if (!matcher?.(url)) continue
      } else {
        const pattern = rule.pattern
        if (pattern.global || pattern.sticky) pattern.lastIndex = 0
        // Bound the tested input to limit ReDoS from user-supplied patterns.
        try {
          if (!pattern.test(url.length > 4096 ? url.slice(0, 4096) : url)) continue
        } catch {
          continue
        }
      }

      return rule
    }
    return null
  }

  /** Record that a matched rule was actually applied. */
  recordHit(rule: MockRule): void {
    rule.hitCount++
  }

  /** Finds a matching rule and records a hit. Returns null if no match. */
  match(url: string, method: string): MockRule | null {
    const rule = this.peek(url, method)
    if (rule) this.recordHit(rule)
    return rule
  }

  /**
   * True when a matched rule should let the real request through and
   * transform it (`rewrite` mode). `redirectTo`/`modify` also route through
   * the rewrite path on their own, without `mode: 'rewrite'`.
   */
  isRewrite(rule: MockRule): boolean {
    return rule.mode === 'rewrite' || rule.redirectTo != null || rule.modify != null
  }

  /**
   * Resolves the response body for a matched mock-mode rule, awaiting
   * `bodyProvider` when present. Falls back to the static body if it throws.
   */
  async resolveMockBody(rule: MockRule, req: MockRequestContext): Promise<string> {
    const provider = rule.response.bodyProvider
    if (provider) {
      try {
        return responseBodyToString(await provider(req))
      } catch {
        // A throwing provider must not break capture — fall back to the static body.
      }
    }
    return responseBodyToString(rule.response.body)
  }

  /**
   * Applies a rewrite rule's transforms to the outgoing request, in order:
   * `redirectTo` (Map Remote), then declarative `modify`, then `rewriteRequest`
   * — so the function sees the fully declaratively-edited request. Returns
   * the original context unchanged if nothing applies or the transform throws.
   */
  async applyRewriteRequest(rule: MockRule, req: MockRequestContext): Promise<MockRequestContext> {
    let next = req
    if (rule.redirectTo) next = { ...next, url: rule.redirectTo }
    if (rule.modify) next = applyModifyToRequest(next, rule.modify)
    if (rule.mode === 'rewrite' && rule.rewriteRequest) {
      try {
        next = await rule.rewriteRequest(next)
      } catch {
        /* keep the (possibly redirected/modified) request */
      }
    }
    return next
  }

  /**
   * Applies a rule's declarative `modify` block and/or `rewriteResponse` to
   * the real response, in that order. A throwing `rewriteResponse` keeps
   * whatever `modify` already produced rather than discarding it.
   */
  async applyRewriteResponse(
    rule: MockRule,
    res: MockResponseContext,
    req: MockRequestContext,
  ): Promise<MockResponseContext> {
    let next = res
    if (rule.modify) next = applyModifyToResponse(next, rule.modify)
    if (rule.mode === 'rewrite' && rule.rewriteResponse) {
      try {
        next = await rule.rewriteResponse(next, req)
      } catch {
        /* keep the (possibly modified) response */
      }
    }
    return next
  }

  /** Serializes rules to plain JSON; RegExp patterns become `{ __regexp: true, source, flags }`. */
  serialize(): string {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      const lossy = this.rules.some((r) => r.response.bodyProvider || r.rewriteRequest || r.rewriteResponse)
      if (lossy) {
        console.warn(
          '[Hakka MockEngine] Serializing rules with bodyProvider/rewriteRequest/rewriteResponse — ' +
            'those functions cannot be persisted and will be lost on reload. Re-register them in code.',
        )
      }
    }
    const serializable = this.rules.map((rule) => ({
      ...rule,
      pattern:
        rule.pattern instanceof RegExp
          ? { __regexp: true, source: rule.pattern.source, flags: rule.pattern.flags }
          : rule.pattern,
    }))
    return JSON.stringify(serializable)
  }

  deserialize(json: string): void {
    try {
      const parsed = JSON.parse(json) as Array<
        Omit<MockRule, 'pattern'> & { pattern: string | { __regexp: boolean; source: string; flags: string } }
      >
      const hydratedRules: MockRule[] = []
      let droppedRewriteCallbacks = false
      for (const rule of parsed) {
        // `rewrite` rules carry callbacks that cannot survive JSON; flag it
        // to warn the caller to re-register them in code.
        if (rule.mode === 'rewrite') droppedRewriteCallbacks = true
        let pattern: string | RegExp
        if (typeof rule.pattern === 'object' && (rule.pattern as { __regexp?: boolean }).__regexp) {
          const { source, flags } = rule.pattern as { source: string; flags: string }
          pattern = reviveRegExpPattern(source, flags)
        } else {
          pattern = rule.pattern as string
        }
        hydratedRules.push({
          id: rule.id,
          method: rule.method,
          mode: rule.mode,
          response: rule.response,
          enabled: rule.enabled,
          hitCount: rule.hitCount,
          pattern,
          // Plain serializable data — must round-trip like everything else here.
          redirectTo: rule.redirectTo,
          block: rule.block,
          modify: rule.modify,
          // rewriteRequest / rewriteResponse / bodyProvider are functions
          // and cannot be serialized; they are intentionally omitted here.
        })
      }
      this.rules = hydratedRules
      this.rulesById = new Map(this.rules.map((rule) => [rule.id, rule]))
      this.stringMatchersById = new Map(
        this.rules.flatMap((rule) =>
          typeof rule.pattern === 'string' ? [[rule.id, (url: string) => url.includes(rule.pattern as string)]] : [],
        ),
      )
      // Keep id counter ahead
      const maxId = this.rules.reduce((max, r) => {
        const n = parseInt(r.id.split('_')[1] ?? '0', 10)
        return n > max ? n : max
      }, 0)
      if (maxId >= ruleIdCounter) ruleIdCounter = maxId + 1
      this.syncNativeRules()
      if (droppedRewriteCallbacks && typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(
          '[Hakka MockEngine] Reloaded one or more `rewrite` rules whose ' +
            'rewriteRequest/rewriteResponse/bodyProvider functions could not be persisted. ' +
            'Re-register those callbacks in code, or the rules will pass through untransformed.',
        )
      }
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.error('[Hakka MockEngine] Failed to deserialize rules:', e)
    }
  }

  private syncNativeAdd(rule: MockRule): void {
    if (!this.nativeBridge?.addMockRule) return
    try {
      this.nativeBridge.addMockRule(toNativeRule(rule))
      this.nativeSyncedRuleIds.add(rule.id)
    } catch {
      // Keep JS mocks working when native mock sync is unavailable.
    }
  }

  private syncNativeRemove(id: string): void {
    if (this.nativeBridge?.removeMockRule && this.nativeSyncedRuleIds.has(id)) {
      try {
        this.nativeBridge.removeMockRule(id)
      } catch {
        // Native sync is best-effort; JS mock state remains authoritative.
      }
    }
    this.nativeSyncedRuleIds.delete(id)
  }

  private syncNativeEnabled(id: string, enabled: boolean): void {
    if (!this.nativeBridge?.setMockRuleEnabled || !this.nativeSyncedRuleIds.has(id)) return
    try {
      this.nativeBridge.setMockRuleEnabled(id, enabled)
    } catch {
      // Native sync is best-effort; JS mock state remains authoritative.
    }
  }

  private clearNativeSyncedRules(): void {
    const ids = [...this.nativeSyncedRuleIds]
    for (const id of ids) {
      this.syncNativeRemove(id)
    }
  }
}

/** Singleton instance shared by interceptors */
export const mockEngine = new MockEngine()

function toMockRequestContext(request: RuleEngineRequest): MockRequestContext {
  return { url: request.url, method: request.method, headers: { ...request.headers }, body: request.body ?? undefined }
}

/**
 * `RuleEngine` (ADR 0003) wrapper around the `mockEngine` singleton. Additive —
 * `capture/fetch.ts` and `capture/xhr.ts` keep calling `mockEngine.peek()` /
 * `.isRewrite()` / `.recordHit()` / `.resolveMockBody()` /
 * `.applyRewriteRequest()` / `.applyRewriteResponse()` directly, unchanged;
 * this wrapper is a second, additive view over the same singleton for a
 * registry or third-party consumer, not a replacement call site.
 *
 * **Does not call `recordHit()`.** Unlike the real interceptors — which only
 * ever call `decideRequest`'s underlying logic when they are actually about
 * to act on the result — a `RuleEngine` consumer may be pure introspection
 * (preview what a request WOULD do without sending it). Recording a hit here
 * unconditionally would silently inflate `MockRule.hitCount` for callers that
 * never apply the decision. A third-party consumer that DOES act on a
 * `'substitute'`/`'block'`/`'rewrite'` decision from this wrapper is
 * responsible for calling `mockEngine.recordHit(rule)` itself if it wants the
 * hit counted — this wrapper has no rule reference to hand back for that
 * (see the next note), so it can't do it on the caller's behalf even if it
 * wanted to.
 *
 * **`decideResponse` re-derives its rule independently of `decideRequest`.**
 * `RuleEngineDecision` carries no "which rule matched" reference, so
 * `decideResponse` calls `mockEngine.peek()` again rather than reusing a rule
 * captured earlier. `capture/fetch.ts` avoids this by closing over one
 * `rewriteRule` object for both phases of a single request; a rule
 * enabled/disabled/edited between this wrapper's `decideRequest` and
 * `decideResponse` calls for the "same" logical request can make the two
 * calls disagree about which rule applies. Left as observed debt, matching
 * ADR 0006's own precedent of naming an awkward fit rather than silently
 * declaring it solved (see that ADR's Resource Timing row).
 */
export function createMockRuleEngine(): RuleEngine {
  return {
    id: 'hakka.mock',
    kind: 'mock',

    describeRules(): readonly RuleEngineRuleDescriptor[] {
      return mockEngine.getRules().map((rule) => ({
        id: rule.id,
        enabled: rule.enabled,
        label: rule.block ? 'block' : mockEngine.isRewrite(rule) ? 'rewrite' : 'mock',
      }))
    },

    async decideRequest(request: RuleEngineRequest): Promise<RuleEngineDecision> {
      const rule = mockEngine.peek(request.url, request.method)
      if (!rule) return { kind: 'pass' }

      if (rule.block) return { kind: 'block', reason: 'Blocked by Hakka' }

      const reqCtx = toMockRequestContext(request)

      if (!mockEngine.isRewrite(rule)) {
        const body = await mockEngine.resolveMockBody(rule, reqCtx)
        return {
          kind: 'substitute',
          response: {
            status: rule.response.status,
            headers: rule.response.headers ?? {},
            body,
            delayMs: rule.response.delay,
          },
        }
      }

      const rewritten = await mockEngine.applyRewriteRequest(rule, reqCtx)
      if (rewritten === reqCtx) return { kind: 'pass' } // rewrite rule matched but changed nothing about the request
      return {
        kind: 'rewrite',
        request: {
          url: rewritten.url,
          method: rewritten.method,
          headers: rewritten.headers,
          body: rewritten.body ?? null,
        },
      }
    },

    async decideResponse(request: RuleEngineRequest, response: RuleEngineResponse): Promise<RuleEngineDecision> {
      const rule = mockEngine.peek(request.url, request.method)
      if (!rule || !mockEngine.isRewrite(rule)) return { kind: 'pass' }

      const reqCtx = toMockRequestContext(request)
      const resCtx = { status: response.status, headers: { ...response.headers }, body: response.body }
      const rewritten = await mockEngine.applyRewriteResponse(rule, resCtx, reqCtx)
      if (rewritten === resCtx) return { kind: 'pass' } // rewrite rule matched but changed nothing about the response
      return {
        kind: 'rewrite',
        response: { status: rewritten.status, headers: rewritten.headers, body: rewritten.body },
      }
    },
  }
}
