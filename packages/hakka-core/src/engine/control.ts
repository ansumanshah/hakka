/**
 * control.ts — shared control-command contract for driving the mock,
 * breakpoint, and throttle engines from an external peer (e.g. the MCP
 * server, relayed over the bridge). See /spec/control-channel for the full
 * contract (id semantics, fail-open guarantee, wire format).
 *
 * `request.replay` drives a captured request's replay via `replayRequest`
 * fire-and-forget: the command returns `{ ok: true }` once dispatched, and
 * the replay is observed later as a normal captured request — same as the
 * browser UI's own Replay button.
 */
import { breakpointEngine, type BreakpointInput } from './BreakpointEngine'
import { Hakka } from './HakkaFacade'
import { mockEngine, type MockRuleInput, type MockRuleModify } from './MockEngine'
import { replayRequest } from './replayRequest'
import { ThrottleEngine, type ThrottleProfile } from './ThrottleEngine'

/** External ids: minted by the remote caller, validated before use locally. */
const EXTERNAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const THROTTLE_PROFILES: ReadonlySet<string> = new Set(['none', 'fast-3g', 'slow-3g', 'offline', 'edge', 'custom'])
const BREAKPOINT_PHASES: ReadonlySet<string> = new Set(['request', 'response', 'both'])
/** A live pause is always at one concrete phase — never `both` (that's a rule-matching concept, not a paused-entry one). */
const PAUSE_PHASES: ReadonlySet<string> = new Set(['request', 'response'])
const MOCK_MODES: ReadonlySet<string> = new Set(['mock', 'rewrite'])

/** Pause ids are minted by the pausing device, not charset-restricted like external ids — just bounded so a hostile peer can't wedge a huge string into engine state. */
const MAX_PAUSE_ID_LEN = 256
const MAX_DEVICE_LEN = 256

/** The paused request's context — present for every `breakpoint.paused` frame regardless of phase. */
export interface BreakpointPausedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/**
 * The paused response snapshot — present only when `phase` is `'response'`.
 * `body` is required (not optional) — it mirrors `PausedResponse.body` in
 * `BreakpointEngine.ts`, which is always a string (already read from the
 * real response before pausing), never absent.
 */
export interface BreakpointPausedResponse {
  status: number
  headers: Record<string, string>
  body: string
}

/** Edits to apply to a request-phase pause on resume. All fields optional — absent means "keep original". */
export interface BreakpointRequestEdits {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

/** Edits to apply to a response-phase pause on resume. All fields optional — absent means "keep original". */
export interface BreakpointResponseEdits {
  status?: number
  headers?: Record<string, string>
  body?: string
}

export type ControlCommand =
  | { kind: 'mock.add'; rule: MockRuleInput & { id: string } }
  | { kind: 'mock.remove'; id: string }
  | { kind: 'mock.clear' }
  | { kind: 'breakpoint.add'; breakpoint: BreakpointInput & { id: string } }
  | { kind: 'breakpoint.remove'; id: string }
  | {
      /**
       * Device -> host only. Sent by the paused device when a breakpoint
       * fires; a host must never construct/send this (see
       * `isDeviceToHostCommand`) and a device must never "apply" one of its
       * own (see `applyControlCommand`'s refusal below).
       */
      kind: 'breakpoint.paused'
      pauseId: string
      ruleId?: string
      phase: 'request' | 'response'
      device: string
      request: BreakpointPausedRequest
      response?: BreakpointPausedResponse
    }
  | {
      /** Host -> device. Releases a pause, optionally with edits matching the pause's own phase. */
      kind: 'breakpoint.resume'
      pauseId: string
      requestEdits?: BreakpointRequestEdits
      responseEdits?: BreakpointResponseEdits
    }
  | { kind: 'breakpoint.abort'; pauseId: string }
  | { kind: 'throttle.set'; profile: ThrottleProfile; latencyMs?: number; downloadKbps?: number }
  | { kind: 'request.replay'; requestId: string; replayMarker?: string }

/**
 * `breakpoint.paused` is the one command kind that travels device -> host;
 * every other kind travels host -> device. This is the single source of
 * truth for that split — the host-side send seam (`dispatch()` in
 * `packages/hakka/src/mcp/tools/controlDispatch.ts`) refuses to transmit a
 * command this returns `true` for.
 */
export function isDeviceToHostCommand(cmd: ControlCommand): boolean {
  return cmd.kind === 'breakpoint.paused'
}

// Parsing below is strict and never throws.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isExternalId(v: unknown): v is string {
  return typeof v === 'string' && EXTERNAL_ID_RE.test(v)
}

function isHeaders(v: unknown): v is Record<string, string> {
  if (!isPlainObject(v)) return false
  return Object.values(v).every((val) => typeof val === 'string')
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string')
}

function isReplaceBodyList(v: unknown): v is Array<{ find: string; replace: string }> {
  return (
    Array.isArray(v) && v.every((e) => isPlainObject(e) && typeof e.find === 'string' && typeof e.replace === 'string')
  )
}

/**
 * Validates the `MockRuleModify` shape (see `MockEngine.ts`) — plain data
 * only, no functions. Matches `parseMockRuleInput`'s style: any malformed
 * sub-field rejects the whole `modify` block (and, via the caller, the whole
 * `mock.add` command) rather than silently dropping just that field.
 */
function parseMockRuleModify(v: unknown): MockRuleModify | null {
  if (!isPlainObject(v)) return null
  const {
    setRequestHeaders,
    removeRequestHeaders,
    setQueryParams,
    removeQueryParams,
    status,
    setResponseHeaders,
    removeResponseHeaders,
    replaceBody,
  } = v

  if (setRequestHeaders !== undefined && !isHeaders(setRequestHeaders)) return null
  if (removeRequestHeaders !== undefined && !isStringArray(removeRequestHeaders)) return null
  if (setQueryParams !== undefined && !isHeaders(setQueryParams)) return null
  if (removeQueryParams !== undefined && !isStringArray(removeQueryParams)) return null
  if (status !== undefined && (typeof status !== 'number' || !Number.isFinite(status))) return null
  if (setResponseHeaders !== undefined && !isHeaders(setResponseHeaders)) return null
  if (removeResponseHeaders !== undefined && !isStringArray(removeResponseHeaders)) return null
  if (replaceBody !== undefined && !isReplaceBodyList(replaceBody)) return null

  return {
    setRequestHeaders: setRequestHeaders as Record<string, string> | undefined,
    removeRequestHeaders: removeRequestHeaders as string[] | undefined,
    setQueryParams: setQueryParams as Record<string, string> | undefined,
    removeQueryParams: removeQueryParams as string[] | undefined,
    status: status as number | undefined,
    setResponseHeaders: setResponseHeaders as Record<string, string> | undefined,
    removeResponseHeaders: removeResponseHeaders as string[] | undefined,
    replaceBody: replaceBody as Array<{ find: string; replace: string }> | undefined,
  }
}

/** Validates the subset of `MockResponse` accepted over the wire (no functions — those cannot cross the bridge). */
function parseMockResponse(
  v: unknown,
): { status: number; headers?: Record<string, string>; body: string | object; delay?: number } | null {
  if (!isPlainObject(v)) return null
  const { status, headers, body, delay } = v
  if (typeof status !== 'number' || !Number.isFinite(status)) return null
  if (headers !== undefined && !isHeaders(headers)) return null
  if (typeof body !== 'string' && !isPlainObject(body) && !Array.isArray(body)) return null
  if (delay !== undefined && (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0)) return null
  return {
    status: status as number,
    headers: headers as Record<string, string> | undefined,
    body: body as string | object,
    delay: delay as number | undefined,
  }
}

function parseMockRuleInput(v: unknown): (MockRuleInput & { id: string }) | null {
  if (!isPlainObject(v)) return null
  const { id, pattern, method, mode, response, enabled, redirectTo, block, modify } = v

  if (!isExternalId(id)) return null
  if (typeof pattern !== 'string' || pattern.length === 0) return null
  if (method !== undefined && typeof method !== 'string') return null
  if (mode !== undefined && (typeof mode !== 'string' || !MOCK_MODES.has(mode))) return null
  if (typeof enabled !== 'boolean') return null
  if (redirectTo !== undefined && typeof redirectTo !== 'string') return null
  if (block !== undefined && typeof block !== 'boolean') return null

  let parsedModify: MockRuleModify | undefined
  if (modify !== undefined) {
    const m = parseMockRuleModify(modify)
    if (!m) return null
    parsedModify = m
  }

  const parsedResponse = parseMockResponse(response)
  if (!parsedResponse) return null

  return {
    id,
    pattern,
    method: method as string | undefined,
    mode: mode as 'mock' | 'rewrite' | undefined,
    response: parsedResponse,
    enabled,
    redirectTo: redirectTo as string | undefined,
    block: block as boolean | undefined,
    modify: parsedModify,
  }
}

function isPauseId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_PAUSE_ID_LEN
}

function parseBreakpointPausedRequest(v: unknown): BreakpointPausedRequest | null {
  if (!isPlainObject(v)) return null
  const { url, method, headers, body } = v
  if (typeof url !== 'string' || url.length === 0) return null
  if (typeof method !== 'string' || method.length === 0) return null
  if (!isHeaders(headers)) return null
  if (body !== undefined && typeof body !== 'string') return null
  return { url, method, headers: headers as Record<string, string>, body: body as string | undefined }
}

function parseBreakpointPausedResponse(v: unknown): BreakpointPausedResponse | null {
  if (!isPlainObject(v)) return null
  const { status, headers, body } = v
  if (typeof status !== 'number' || !Number.isFinite(status)) return null
  if (!isHeaders(headers)) return null
  if (typeof body !== 'string') return null
  return { status, headers: headers as Record<string, string>, body }
}

function parseBreakpointRequestEdits(v: unknown): BreakpointRequestEdits | null {
  if (!isPlainObject(v)) return null
  const { url, method, headers, body } = v
  if (url !== undefined && typeof url !== 'string') return null
  if (method !== undefined && typeof method !== 'string') return null
  if (headers !== undefined && !isHeaders(headers)) return null
  if (body !== undefined && typeof body !== 'string') return null
  return {
    url: url as string | undefined,
    method: method as string | undefined,
    headers: headers as Record<string, string> | undefined,
    body: body as string | undefined,
  }
}

function parseBreakpointResponseEdits(v: unknown): BreakpointResponseEdits | null {
  if (!isPlainObject(v)) return null
  const { status, headers, body } = v
  if (status !== undefined && (typeof status !== 'number' || !Number.isFinite(status))) return null
  if (headers !== undefined && !isHeaders(headers)) return null
  if (body !== undefined && typeof body !== 'string') return null
  return {
    status: status as number | undefined,
    headers: headers as Record<string, string> | undefined,
    body: body as string | undefined,
  }
}

function parseBreakpointInput(v: unknown): (BreakpointInput & { id: string }) | null {
  if (!isPlainObject(v)) return null
  const { id, pattern, method, on, enabled } = v

  if (!isExternalId(id)) return null
  if (typeof pattern !== 'string' || pattern.length === 0) return null
  if (method !== undefined && typeof method !== 'string') return null
  if (on !== undefined && (typeof on !== 'string' || !BREAKPOINT_PHASES.has(on))) return null
  if (typeof enabled !== 'boolean') return null

  return {
    id,
    pattern,
    method: method as string | undefined,
    on: on as 'request' | 'response' | 'both' | undefined,
    enabled,
  }
}

/**
 * Validate an untyped payload into a `ControlCommand`. Strict shape
 * checking — returns `null` on anything malformed. Never throws.
 */
export function parseControlCommand(raw: unknown): ControlCommand | null {
  try {
    if (!isPlainObject(raw)) return null
    const { kind } = raw
    if (typeof kind !== 'string') return null

    switch (kind) {
      case 'mock.add': {
        const rule = parseMockRuleInput(raw.rule)
        if (!rule) return null
        return { kind: 'mock.add', rule }
      }
      case 'mock.remove': {
        if (!isExternalId(raw.id)) return null
        return { kind: 'mock.remove', id: raw.id }
      }
      case 'mock.clear': {
        return { kind: 'mock.clear' }
      }
      case 'breakpoint.add': {
        const breakpoint = parseBreakpointInput(raw.breakpoint)
        if (!breakpoint) return null
        return { kind: 'breakpoint.add', breakpoint }
      }
      case 'breakpoint.remove': {
        if (!isExternalId(raw.id)) return null
        return { kind: 'breakpoint.remove', id: raw.id }
      }
      case 'breakpoint.paused': {
        const { pauseId, ruleId, phase, device, request, response } = raw
        if (!isPauseId(pauseId)) return null
        if (ruleId !== undefined && !isExternalId(ruleId)) return null
        if (typeof phase !== 'string' || !PAUSE_PHASES.has(phase)) return null
        if (typeof device !== 'string' || device.length === 0 || device.length > MAX_DEVICE_LEN) return null
        const parsedRequest = parseBreakpointPausedRequest(request)
        if (!parsedRequest) return null
        let parsedResponse: BreakpointPausedResponse | undefined
        if (response !== undefined) {
          const r = parseBreakpointPausedResponse(response)
          if (!r) return null
          parsedResponse = r
        }
        return {
          kind: 'breakpoint.paused',
          pauseId,
          ruleId: ruleId as string | undefined,
          phase: phase as 'request' | 'response',
          device,
          request: parsedRequest,
          response: parsedResponse,
        }
      }
      case 'breakpoint.resume': {
        const { pauseId, requestEdits, responseEdits } = raw
        if (!isPauseId(pauseId)) return null
        let parsedRequestEdits: BreakpointRequestEdits | undefined
        if (requestEdits !== undefined) {
          const r = parseBreakpointRequestEdits(requestEdits)
          if (!r) return null
          parsedRequestEdits = r
        }
        let parsedResponseEdits: BreakpointResponseEdits | undefined
        if (responseEdits !== undefined) {
          const r = parseBreakpointResponseEdits(responseEdits)
          if (!r) return null
          parsedResponseEdits = r
        }
        return {
          kind: 'breakpoint.resume',
          pauseId,
          requestEdits: parsedRequestEdits,
          responseEdits: parsedResponseEdits,
        }
      }
      case 'breakpoint.abort': {
        const { pauseId } = raw
        if (!isPauseId(pauseId)) return null
        return { kind: 'breakpoint.abort', pauseId }
      }
      case 'throttle.set': {
        const { profile, latencyMs, downloadKbps } = raw
        if (typeof profile !== 'string' || !THROTTLE_PROFILES.has(profile)) return null
        if (latencyMs !== undefined && (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0))
          return null
        if (
          downloadKbps !== undefined &&
          (typeof downloadKbps !== 'number' || !Number.isFinite(downloadKbps) || downloadKbps < 0)
        )
          return null
        return {
          kind: 'throttle.set',
          profile: profile as ThrottleProfile,
          latencyMs: latencyMs as number | undefined,
          downloadKbps: downloadKbps as number | undefined,
        }
      }
      case 'request.replay': {
        const { requestId, replayMarker } = raw
        if (typeof requestId !== 'string' || requestId.length === 0) return null
        if (replayMarker !== undefined && !isExternalId(replayMarker)) return null
        return { kind: 'request.replay', requestId, replayMarker: replayMarker as string | undefined }
      }
      default:
        return null
    }
  } catch {
    // Fail-open: malformed input must never throw.
    return null
  }
}

/**
 * Applies a validated `ControlCommand` to the singleton engines. Fail-open:
 * every engine call is wrapped in try/catch, never propagated — a malformed
 * control frame must never throw into the host app.
 */
export function applyControlCommand(cmd: ControlCommand): { ok: true } | { ok: false; error: string } {
  try {
    switch (cmd.kind) {
      case 'mock.add': {
        mockEngine.addRule(cmd.rule)
        return { ok: true }
      }
      case 'mock.remove': {
        mockEngine.removeRule(cmd.id)
        return { ok: true }
      }
      case 'mock.clear': {
        mockEngine.clearRules()
        return { ok: true }
      }
      case 'breakpoint.add': {
        breakpointEngine.addBreakpoint(cmd.breakpoint)
        return { ok: true }
      }
      case 'breakpoint.remove': {
        breakpointEngine.removeBreakpoint(cmd.id)
        return { ok: true }
      }
      case 'breakpoint.paused': {
        // Device-to-host only (see `isDeviceToHostCommand`) — a device
        // applying its own pause notification is a protocol bug, not
        // something to silently no-op. Still must never throw.
        return { ok: false, error: 'breakpoint.paused travels device to host only; a device must never apply it' }
      }
      case 'breakpoint.resume': {
        breakpointEngine.resume(cmd.pauseId, cmd.requestEdits ?? cmd.responseEdits)
        return { ok: true }
      }
      case 'breakpoint.abort': {
        breakpointEngine.abort(cmd.pauseId)
        return { ok: true }
      }
      case 'throttle.set': {
        if (cmd.profile === 'custom') {
          ThrottleEngine.setCustom(cmd.latencyMs ?? 0, cmd.downloadKbps)
        } else {
          ThrottleEngine.setProfile(cmd.profile)
        }
        return { ok: true }
      }
      case 'request.replay': {
        const req = Hakka.getLog(cmd.requestId)
        if (!req) return { ok: false, error: `request.replay: no request found for id "${cmd.requestId}"` }
        if (req.source === 'websocket') {
          return { ok: false, error: 'request.replay: websocket requests are not replayable' }
        }
        void replayRequest(req, cmd.replayMarker)
        return { ok: true }
      }
      default: {
        // Exhaustiveness guard — parseControlCommand should never produce this.
        const _exhaustive: never = cmd
        return { ok: false, error: `Unknown control command kind: ${JSON.stringify(_exhaustive)}` }
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message }
  }
}
