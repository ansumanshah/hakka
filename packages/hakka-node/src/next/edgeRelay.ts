/**
 * Edge relay, Edge side. The Edge sandbox has no embedded bridge (no `ws`, no
 * `node:crypto`), so a captured record leaves it by being POSTed, same origin,
 * to a Node-runtime route that holds the bridge client. This module is the
 * sender; `createEdgeRelayHandler` in `hakka-node/next/server` is the route.
 *
 * Edge-safe: no `node:*` imports, only a type import from `hakka-core`.
 */
import type { NetworkRequest } from 'hakka-core'

/** Route the relay handler is mounted at. Next treats `_`-prefixed folders as private, so the folder is `app/api/%5F%5Fhakka/edge-relay`. */
export const EDGE_RELAY_PATH = '/api/__hakka/edge-relay'

/** Ignore pattern that keeps the relay's own POST out of capture (it would otherwise relay itself forever). */
export const EDGE_RELAY_IGNORE_PATTERN = `*${EDGE_RELAY_PATH}*`

export interface EdgeRelaySinkOptions {
  /**
   * Origin of the Next.js dev server that hosts the relay route. Default
   * `HAKKA_EDGE_RELAY_ORIGIN`, else `http://localhost:` plus `PORT` (3000).
   */
  origin?: string
}

function defaultOrigin(): string {
  return process.env.HAKKA_EDGE_RELAY_ORIGIN ?? `http://localhost:${process.env.PORT ?? '3000'}`
}

/**
 * A `sink` for Edge capture that forwards each `runtime: 'edge'` record to the
 * relay route. Dev-only by design: `register()` installs it only outside
 * production. Pair it with `EDGE_RELAY_IGNORE_PATTERN` in `ignorePatterns`.
 */
export function createEdgeRelaySink(options: EdgeRelaySinkOptions = {}): (req: NetworkRequest) => void {
  const url = `${options.origin ?? defaultOrigin()}${EDGE_RELAY_PATH}`
  let warned = false
  return (req) => {
    if (req.runtime !== 'edge') return
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
      .then((res) => {
        if (res.status !== 404 || warned) return
        warned = true
        console.warn(
          `[hakka] Edge capture is running but ${EDGE_RELAY_PATH} returned 404, so Edge records are dropped. ` +
            "Add app/api/%5F%5Fhakka/edge-relay/route.ts: `import { createEdgeRelayHandler } from 'hakka-node/next/server'; " +
            'export const POST = createEdgeRelayHandler()`.',
        )
      })
      .catch(() => {})
  }
}
