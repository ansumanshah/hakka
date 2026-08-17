/**
 * Thin `fetch` wrapper that adds a W3C `traceparent` header alongside
 * hakka-core's own `x-hakka-trace` injection.
 *
 * hakka-core's fetch interceptor (`enableFetchInterceptor`) already injects
 * `x-hakka-trace` on outgoing requests when a trace id is active — but it has
 * no notion of `traceparent` (core stays platform-neutral and knows nothing of
 * Node's AsyncLocalStorage-backed trace provider vs. the W3C format). Rather
 * than teach core a second header format, this installs a second, outer
 * wrapper AFTER core's patch, so the call chain is:
 *
 *   app code → this wrapper (adds traceparent) → core's patched fetch
 *   (adds x-hakka-trace + captures) → real fetch
 *
 * Must be installed after `enableFetchInterceptor` and torn down before it
 * (LIFO) — see `serverCapture.ts`.
 */
import { currentTraceId } from 'hakka-core'

import { TRACEPARENT_HEADER, buildTraceparent } from './trace'

let previousFetch: typeof globalThis.fetch | null = null

type FetchInput = Parameters<typeof globalThis.fetch>[0]

/** Install the traceparent-injecting fetch wrapper. Idempotent; returns a teardown. */
export function enableTraceparentFetch(): () => void {
  if (previousFetch) return () => disableTraceparentFetch()
  previousFetch = globalThis.fetch
  const inner = previousFetch

  globalThis.fetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const correlationId = currentTraceId()
    if (!correlationId) return inner(input, init)

    let nextInput = input
    let nextInit = init
    try {
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
      if (!headers.has(TRACEPARENT_HEADER)) {
        headers.set(TRACEPARENT_HEADER, buildTraceparent(correlationId))
        if (input instanceof Request) nextInput = new Request(input, { headers })
        else nextInit = { ...init, headers }
      }
    } catch {
      // Never let header construction break the real request.
      nextInput = input
      nextInit = init
    }
    return inner(nextInput, nextInit)
  }

  return () => disableTraceparentFetch()
}

/** Restore the fetch this wrapper saw at install time. */
export function disableTraceparentFetch(): void {
  if (previousFetch) {
    globalThis.fetch = previousFetch
    previousFetch = null
  }
}
