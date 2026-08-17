/**
 * Trace correlation — links one logical request across client → server →
 * upstream hops via a shared id header. Platform-neutral: hakka-node registers
 * a {@link TraceProvider} here so server captures inherit the id without core
 * ever importing node. `resolveOutgoingTrace` is the single entry point both
 * sides call. See docs/concepts/trace-correlation.md for the full flow.
 */

/** Header that carries the trace id across the client → server boundary. */
export const HAKKA_TRACE_HEADER = 'x-hakka-trace'

export interface TraceConfig {
  /**
   * Originate + inject the trace header from the client. Off by default so the
   * id is never sent without opt-in (it would otherwise leak cross-origin).
   */
  enabled: boolean
  /**
   * Cross-origin destinations the header may be sent to. Same-origin is always
   * allowed when enabled; other origins must be listed here. Compared by `origin`.
   */
  propagateOrigins?: readonly string[]
}

let config: TraceConfig = { enabled: false }

/** Configure client-side trace propagation. Shallow-merges into the current config. */
export function configureTrace(next: Partial<TraceConfig>): void {
  config = { ...config, ...next }
}

/** Generate a unique trace id (`crypto.randomUUID` when available). */
export function newTraceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Whether the trace header may be attached to a client request to `url`.
 * Same-origin always qualifies (when enabled); cross-origin only if allowlisted.
 * False in non-browser contexts (no `location`) — the server uses the provider.
 */
export function shouldPropagateTrace(url: string): boolean {
  if (!config.enabled || typeof location === 'undefined') return false
  let origin: string
  try {
    origin = new URL(url, location.href).origin
  } catch {
    return false
  }
  return origin === location.origin || (config.propagateOrigins?.includes(origin) ?? false)
}

/** Source of the ambient request-context trace id (e.g. an AsyncLocalStorage). */
export type TraceProvider = () => string | undefined

let provider: TraceProvider | null = null

/** Register the ambient trace-id source (called by hakka-node on the server). */
export function setTraceProvider(fn: TraceProvider | null): void {
  provider = fn
}

/** The trace id of the ambient request context, if any (server-side). */
export function currentTraceId(): string | undefined {
  return provider?.()
}

/**
 * Resolve the trace id for an outgoing request, unifying both sides: a server
 * context *inherits and forwards* its incoming id; otherwise the client
 * *originates* a new id for same-origin/allowlisted requests. Returns `undefined`
 * when no trace applies, leaving the request untouched.
 */
export function resolveOutgoingTrace(url: string): string | undefined {
  return currentTraceId() ?? (shouldPropagateTrace(url) ? newTraceId() : undefined)
}
