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
      // When input is a Request, its own headers are the base — but init.headers
      // (if the caller also passed one) must be overlaid on top, matching the
      // Fetch/Request spec's own "init overrides input" semantics for this call
      // shape. Building `headers` from only ONE of the two sources (the prior
      // bug) meant whichever one wasn't included here still had to travel via
      // `nextInit`/`nextInput` separately — and since only one of those two was
      // ever updated below, the other one's original headers won outright,
      // silently clobbering the merged/injected set.
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
      const requestWithInitHeaders = input instanceof Request && !!init?.headers
      if (requestWithInitHeaders) {
        for (const [key, value] of new Headers(init.headers)) headers.set(key, value)
      }
      let injectedTraceparent = false
      if (!headers.has(TRACEPARENT_HEADER)) {
        headers.set(TRACEPARENT_HEADER, buildTraceparent(correlationId))
        injectedTraceparent = true
      }
      // Rebuild nextInput/nextInit from the merged `headers` whenever EITHER
      // reason applies — a merge happened (the Request's own headers must
      // survive init.headers, which would otherwise override them wholesale
      // when both are passed to fetch()), or a traceparent was just injected
      // (so it actually reaches the wire). Gating this on injection alone (the
      // prior bug) meant a Request that already carried its own traceparent
      // took the early-return path whenever init.headers was ALSO present —
      // reproducing the same wholesale-clobbering bug this fix closed, just
      // in the "traceparent already set" case instead of the "missing" one.
      if (input instanceof Request) {
        if (requestWithInitHeaders || injectedTraceparent) {
          nextInput = new Request(input, { headers })
          nextInit = init ? { ...init, headers } : init
        }
      } else if (injectedTraceparent) {
        nextInit = { ...init, headers }
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
