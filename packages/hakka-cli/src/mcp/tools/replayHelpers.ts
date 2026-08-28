import { REPLAY_MARKER_HEADER } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

import type { RequestStore } from '../RequestStore.js'

/**
 * Shared "can this be replayed" gate and wait-for-the-replay-to-land loop
 * used by both `replay_request` and `verify_fix`, so they cannot drift on
 * wait semantics or on which requests are refused. hakka-node's
 * `bridgeClient.ts` is send-only (no `'message'` handler), so
 * `mock.add`/`breakpoint.add`/`throttle.set`/`request.replay` already
 * silently no-op for every server/edge-captured (Next.js) request;
 * `checkReplayable` turns that into an immediate, typed tool error instead
 * of a silent timeout.
 */

export type ReplayableCheck =
  | { ok: true }
  | {
      ok: false
      reason: 'websocket_not_replayable' | 'runtime_not_replayable' | 'redacted_headers_not_replayable'
      message: string
    }

/** The placeholder capture-time redaction writes over sensitive header values (see hakka-core's `redactHeaders`). */
const REDACTED_PLACEHOLDER = '[REDACTED]'

/** Fast-fail gate run BEFORE dispatching a `request.replay` control command. Never throws. */
export function checkReplayable(req: NetworkRequest): ReplayableCheck {
  if (req.source === 'websocket') {
    return {
      ok: false,
      reason: 'websocket_not_replayable',
      message:
        'WebSocket connections cannot be replayed as a single request — replay_request/verify_fix only support HTTP requests.',
    }
  }
  if (req.runtime === 'server' || req.runtime === 'edge') {
    return {
      ok: false,
      reason: 'runtime_not_replayable',
      message:
        'server/edge-captured requests (hakka-node) cannot be replayed — its bridge client is send-only (no ' +
        'control-channel listener) by design (ADR 0002). Replay only works for client-runtime (browser/RN) ' +
        'captures. Diagnose/verify with get_trace + export_evidence instead of replay_request for this request.',
    }
  }
  const redactedHeader = Object.entries(req.requestHeaders ?? {}).find(([, v]) => v === REDACTED_PLACEHOLDER)
  if (redactedHeader) {
    return {
      ok: false,
      reason: 'redacted_headers_not_replayable',
      message:
        `the '${redactedHeader[0]}' header was redacted at capture time and would replay as the literal string ` +
        '"[REDACTED]" instead of the real credential, producing a misleading auth failure that looks like an ' +
        'unfixed bug. Reproduce this request manually instead of replaying it.',
    }
  }
  return { ok: true }
}

/**
 * Await the first request whose `x-hakka-replay-marker` header equals
 * `marker`. Event-driven via `RequestStore.onAdd`, not polling; resolves
 * `null` if `timeoutMs` elapses with no match.
 */
export function awaitReplayResult(
  store: RequestStore,
  marker: string,
  timeoutMs: number,
): Promise<NetworkRequest | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: NetworkRequest | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(result)
    }
    const unsubscribe = store.onAdd((req) => {
      if (req.requestHeaders?.[REPLAY_MARKER_HEADER] === marker) {
        finish(req)
      }
    })
    const timer = setTimeout(() => finish(null), timeoutMs)
  })
}
