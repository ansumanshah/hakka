/**
 * startEdgeCapture — fetch-only capture that's actually safe to run on the
 * Next.js Edge runtime.
 *
 * `startServerCapture` (this package's other Next entry) can't be used here:
 * its underlying `../serverCapture.ts` statically imports `node:crypto`,
 * `node:http`/`node:https`, and the `ws`-based bridge client — none of which
 * exist in the Edge sandbox. Even the file's own `runtime: 'edge'` branch
 * doesn't help, because those imports are hoisted at module scope regardless
 * of which branch runs; see `next/index.ts`'s module doc for the full story
 * of why that path can never be reached from the one-line Edge hook.
 *
 * This module imports ONLY `enableFetchInterceptor` (plus a couple of pure
 * helpers) from `hakka-core` — the same interceptor the browser build ships
 * — so its import graph has nothing node-shaped in it, and Next's Edge
 * bundler can include it safely.
 *
 * There is no embedded bridge here (the `ws` package and the `node:crypto`-
 * based bridge client this package uses elsewhere aren't Edge-safe either),
 * so a captured record's only way out is `options.sink` — pass one to
 * forward records anywhere you like: a KV store polled by a pull route in
 * the shape of `hakka-node/prod`'s `createPullHandler`, a log line, your own
 * relay. Without a sink, `fetch` is still intercepted (and pays that cost)
 * but every record is captured and immediately discarded — `startEdgeCapture`
 * warns about this once in development (see `next/index.ts`) rather than
 * failing silently.
 */
import { DEFAULT_CONFIG, enableFetchInterceptor, type NetworkRequest } from 'hakka-core'

import { globToUrlRegExp } from '../urlGlob'

export interface EdgeCaptureOptions {
  /** Max captured body size in bytes. Default: hakka-core's default (256 KB). */
  maxBodySize?: number
  /** Sensitive header names to redact. Default: hakka-core's default list. */
  redactHeaders?: string[]
  /** Full-URL `*`-glob patterns whose captures are dropped before reaching `sink`. */
  ignorePatterns?: string[]
  /** Every captured record is tagged `runtime: 'edge'` and passed here — the only way a record leaves this module (see the module doc: no bridge on Edge). */
  sink?: (req: NetworkRequest) => void
}

export interface EdgeCapture {
  stop(): void
  readonly runtime: 'edge'
}

let active: EdgeCapture | null = null

/** Start Edge fetch capture. Idempotent — a second call while active returns the first handle. */
export function startEdgeCapture(options: EdgeCaptureOptions = {}): EdgeCapture {
  if (active) return active

  const maxBodySize = options.maxBodySize ?? DEFAULT_CONFIG.maxBodySize
  const redactHeaders = options.redactHeaders ?? DEFAULT_CONFIG.redactHeaders
  const ignoreRegexps = options.ignorePatterns?.length ? options.ignorePatterns.map(globToUrlRegExp) : null

  const onRequest = (req: NetworkRequest): void => {
    if (ignoreRegexps?.some((re) => re.test(req.url))) return
    options.sink?.(req.runtime ? req : { ...req, runtime: 'edge' })
  }

  const teardown = enableFetchInterceptor(onRequest, maxBodySize, redactHeaders)

  active = {
    runtime: 'edge',
    stop() {
      teardown()
      active = null
    },
  }
  return active
}

/** Stop the active Edge capture, if any. */
export function stopEdgeCapture(): void {
  active?.stop()
}
