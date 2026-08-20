/**
 * BreakpointEngine — pauses matching requests so they can be inspected and
 * edited before they're sent, then resumed or aborted. Runs in-process: no
 * proxy, no certificate. The fetch interceptor awaits the Promise `pause()`
 * returns; the overlay resolves it via `resume()`/`abort()`.
 */

import type {
  RuleEngine,
  RuleEngineDecision,
  RuleEngineRequest,
  RuleEngineResponse,
  RuleEngineRuleDescriptor,
} from '../contract/ruleEngine'

/**
 * Which phase a breakpoint pauses on: before the request is sent (`request`),
 * after the real response returns but before the caller sees it (`response`),
 * or `both`. The interceptor only ever queries `matches()` with `request` or
 * `response`; a `both` rule matches either.
 */
export type BreakpointPhase = 'request' | 'response' | 'both'

export interface Breakpoint {
  id: string
  /** Substring matched against the request URL. */
  pattern: string
  /** Optional HTTP method filter (case-insensitive). */
  method?: string
  /** Phase to pause on. Default `request`. */
  on: BreakpointPhase
  enabled: boolean
}

export type BreakpointInput = Omit<Breakpoint, 'id'> & { id?: string }

/** The editable request shown while paused at the request phase. */
export interface PausedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

/** The editable response shown while paused at the response phase. */
export interface PausedResponse {
  status: number
  headers: Record<string, string>
  /** Body as text — already read from the real response before pausing. */
  body: string
}

/**
 * A held request/response, discriminated by `phase`:
 * - `request`  — paused before send; the user edits `request`.
 * - `response` — paused after the real response returned; the user edits `response`.
 */
export type PausedEntry =
  | { id: string; requestId: string; phase: 'request'; request: PausedRequest }
  | { id: string; requestId: string; phase: 'response'; response: PausedResponse }

/** What the user did with a request-phase pause. */
export type ResumeAction = { type: 'resume'; edits?: Partial<PausedRequest> } | { type: 'abort' }

/** What the user did with a response-phase pause. */
export type ResumeResponseAction = { type: 'resume'; edits?: Partial<PausedResponse> } | { type: 'abort' }

let ruleCounter = 0
let pauseCounter = 0

class BreakpointEngine {
  private breakpoints: Breakpoint[] = []
  private pending = new Map<string, { entry: PausedEntry; resolve: (a: ResumeAction | ResumeResponseAction) => void }>()
  private listeners = new Set<() => void>()

  /**
   * Adds a breakpoint and returns its id (caller-supplied, or generated). If
   * `input.id` matches an existing breakpoint, replaces it in place,
   * preserving insertion order.
   */
  addBreakpoint(input: BreakpointInput): string {
    const id = input.id ?? `bp_${++ruleCounter}`
    const breakpoint: Breakpoint = {
      id,
      pattern: input.pattern,
      method: input.method,
      on: input.on ?? 'request',
      enabled: input.enabled,
    }
    const existingIndex = this.breakpoints.findIndex((b) => b.id === id)
    if (existingIndex >= 0) {
      this.breakpoints[existingIndex] = breakpoint
    } else {
      this.breakpoints.push(breakpoint)
    }
    this.notify()
    return id
  }

  removeBreakpoint(id: string): void {
    this.breakpoints = this.breakpoints.filter((b) => b.id !== id)
    this.notify()
  }

  setEnabled(id: string, enabled: boolean): void {
    const bp = this.breakpoints.find((b) => b.id === id)
    if (bp) {
      bp.enabled = enabled
      this.notify()
    }
  }

  getBreakpoints(): Breakpoint[] {
    return [...this.breakpoints]
  }

  clearBreakpoints(): void {
    this.breakpoints = []
    this.notify()
  }

  /**
   * True if an enabled breakpoint matches this request for the given phase.
   * A `both` rule matches either phase.
   */
  matches(url: string, method: string, phase: 'request' | 'response'): boolean {
    const m = method.toUpperCase()
    return this.breakpoints.some(
      (b) =>
        b.enabled &&
        (b.on === phase || b.on === 'both') &&
        url.includes(b.pattern) &&
        (!b.method || b.method.toUpperCase() === m),
    )
  }

  /** Pause a request before send; resolves when the overlay calls resume()/abort(). */
  pause(requestId: string, phase: 'request', request: PausedRequest): Promise<ResumeAction>
  /** Pause after the real response returned; resolves when the overlay resolves it. */
  pause(requestId: string, phase: 'response', response: PausedResponse): Promise<ResumeResponseAction>
  pause(
    requestId: string,
    phase: 'request' | 'response',
    payload: PausedRequest | PausedResponse,
  ): Promise<ResumeAction | ResumeResponseAction> {
    const id = `pause_${++pauseCounter}`
    return new Promise<ResumeAction | ResumeResponseAction>((resolve) => {
      const entry: PausedEntry =
        phase === 'response'
          ? { id, requestId, phase, response: payload as PausedResponse }
          : { id, requestId, phase, request: payload as PausedRequest }
      this.pending.set(id, { entry, resolve })
      this.notify()
    })
  }

  /**
   * Resume a paused request/response. `edits` is interpreted against the pause's
   * phase: `Partial<PausedRequest>` for a request pause, `Partial<PausedResponse>`
   * for a response pause.
   */
  resume(pauseId: string, edits?: Partial<PausedRequest> | Partial<PausedResponse>): void {
    const p = this.pending.get(pauseId)
    if (!p) return
    this.pending.delete(pauseId)
    if (p.entry.phase === 'response') {
      p.resolve({ type: 'resume', edits: edits as Partial<PausedResponse> | undefined })
    } else {
      p.resolve({ type: 'resume', edits: edits as Partial<PausedRequest> | undefined })
    }
    this.notify()
  }

  abort(pauseId: string): void {
    const p = this.pending.get(pauseId)
    if (!p) return
    this.pending.delete(pauseId)
    p.resolve({ type: 'abort' })
    this.notify()
  }

  /** Resume/abort every paused request (used on teardown). */
  resumeAll(): void {
    for (const [, p] of this.pending) p.resolve({ type: 'resume' })
    this.pending.clear()
    this.notify()
  }

  getPaused(): PausedEntry[] {
    return [...this.pending.values()].map((p) => p.entry)
  }

  hasPaused(): boolean {
    return this.pending.size > 0
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }
}

export const breakpointEngine = new BreakpointEngine()

let ruleEngineRequestCounter = 0

/** `pause()` wants a `requestId` purely for `getPaused()` display metadata — synthesize a throwaway one when the caller (a bare `RuleEngineRequest`, not a real interceptor record) didn't supply one. */
function synthesizeRequestId(request: RuleEngineRequest): string {
  return request.id ?? `ruleEngine_bp_${++ruleEngineRequestCounter}_${Date.now()}`
}

function decideBreakpointRequest(request: RuleEngineRequest): RuleEngineDecision {
  if (!breakpointEngine.matches(request.url, request.method, 'request')) return { kind: 'pass' }
  return {
    kind: 'pause',
    phase: 'request',
    resolve: async (): Promise<RuleEngineDecision> => {
      const action = await breakpointEngine.pause(synthesizeRequestId(request), 'request', {
        url: request.url,
        method: request.method,
        headers: { ...request.headers },
        body: request.body ?? null,
      })
      if (action.type === 'abort') return { kind: 'block', reason: 'Aborted by Hakka' }
      const edits = action.edits
      if (!edits) return { kind: 'pass' }
      return {
        kind: 'rewrite',
        request: {
          url: edits.url ?? request.url,
          method: edits.method ?? request.method,
          headers: edits.headers ?? request.headers,
          body: edits.body !== undefined ? edits.body : (request.body ?? null),
        },
      }
    },
  }
}

function decideBreakpointResponse(request: RuleEngineRequest, response: RuleEngineResponse): RuleEngineDecision {
  if (!breakpointEngine.matches(request.url, request.method, 'response')) return { kind: 'pass' }
  return {
    kind: 'pause',
    phase: 'response',
    resolve: async (): Promise<RuleEngineDecision> => {
      const action = await breakpointEngine.pause(synthesizeRequestId(request), 'response', {
        status: response.status,
        headers: { ...response.headers },
        body: response.body,
      })
      if (action.type === 'abort') return { kind: 'block', reason: 'Aborted by Hakka' }
      const edits = action.edits
      if (!edits) return { kind: 'pass' }
      return {
        kind: 'rewrite',
        response: {
          status: edits.status ?? response.status,
          headers: edits.headers ?? response.headers,
          body: edits.body !== undefined ? edits.body : response.body,
        },
      }
    },
  }
}

/**
 * `RuleEngine` (ADR 0009) wrapper around the `breakpointEngine` singleton.
 * Additive — `capture/fetch.ts` keeps calling `breakpointEngine.matches()` /
 * `.pause()` directly, unchanged.
 *
 * **The only first-party source of the `'pause'` decision kind.** Both
 * `decideRequest` and `decideResponse` return synchronously: a match
 * produces `{ kind: 'pause', phase, resolve }` immediately, never an
 * internally-awaited outer Promise — `resolve()` is what actually calls
 * `breakpointEngine.pause()` and can take arbitrarily long (a human decides
 * when to resume). See `RuleEngineDecision`'s doc comment on `'pause'` for
 * why that split is load-bearing, not stylistic.
 *
 * **`resolve()` is a fresh Promise chain per call**, matching
 * `breakpointEngine.pause()`'s own one-shot-per-call semantics — calling
 * `resolve()` twice on the same decision registers two independent pauses,
 * same as calling `breakpointEngine.pause()` twice would.
 */
export function createBreakpointRuleEngine(): RuleEngine {
  return {
    id: 'hakka.breakpoint',
    kind: 'breakpoint',

    describeRules(): readonly RuleEngineRuleDescriptor[] {
      return breakpointEngine.getBreakpoints().map((bp) => ({ id: bp.id, enabled: bp.enabled, label: bp.on }))
    },

    decideRequest(request: RuleEngineRequest): RuleEngineDecision {
      return decideBreakpointRequest(request)
    },

    decideResponse(request: RuleEngineRequest, response: RuleEngineResponse): RuleEngineDecision {
      return decideBreakpointResponse(request, response)
    },
  }
}
