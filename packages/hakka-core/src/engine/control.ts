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
const MOCK_MODES: ReadonlySet<string> = new Set(['mock', 'rewrite'])

export type ControlCommand =
  | { kind: 'mock.add'; rule: MockRuleInput & { id: string } }
  | { kind: 'mock.remove'; id: string }
  | { kind: 'mock.clear' }
  | { kind: 'breakpoint.add'; breakpoint: BreakpointInput & { id: string } }
  | { kind: 'breakpoint.remove'; id: string }
  | { kind: 'throttle.set'; profile: ThrottleProfile; latencyMs?: number; downloadKbps?: number }
  | { kind: 'request.replay'; requestId: string; replayMarker?: string }

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
