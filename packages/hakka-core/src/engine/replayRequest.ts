import type { NetworkRequest } from '../model/types'

/**
 * replayRequest.ts — re-issue a captured request as a real `fetch`. Shared by
 * `engine/control.ts`'s `request.replay` case and the browser's own Replay
 * button, so the GET/HEAD-drops-body, POST/PUT/PATCH-keeps-body logic lives
 * in one place instead of two.
 */

/** Header stamped on a replay's outgoing request so a caller (`replay_request`/`verify_fix`) can correlate it back by watching newly-captured requests. */
export const REPLAY_MARKER_HEADER = 'x-hakka-replay-marker'

export interface ReplayInit {
  method: string
  headers?: Record<string, string>
  body?: string
}

/**
 * Pure builder for a replay's fetch init. GET/HEAD never carry a body (fetch
 * throws if given one); POST/PUT/PATCH/etc. keep it. Empty header maps are
 * omitted rather than sent as `{}`.
 */
export function buildReplayInit(req: NetworkRequest): ReplayInit {
  const method = req.method.toUpperCase()
  const init: ReplayInit = { method }
  if (req.requestHeaders && Object.keys(req.requestHeaders).length > 0) {
    init.headers = { ...req.requestHeaders }
  }
  if (req.requestBody != null && method !== 'GET' && method !== 'HEAD') {
    init.body = req.requestBody
  }
  return init
}

/**
 * Re-issue a captured request as a real fetch. The fetch/XHR interceptor
 * captures it as an ordinary new request — there is no separate "replay"
 * record type. `marker`, when given, is stamped as `REPLAY_MARKER_HEADER` so
 * a caller can correlate the replay back to the command that triggered it.
 * Rejections are swallowed — the failure is still captured as a normal
 * errored request by the interceptor.
 */
export async function replayRequest(req: NetworkRequest, marker?: string): Promise<void> {
  const init = buildReplayInit(req)
  const headers = marker != null ? { ...init.headers, [REPLAY_MARKER_HEADER]: marker } : init.headers
  const fetchInit: RequestInit = { method: init.method }
  if (headers) fetchInit.headers = headers
  if (init.body !== undefined) fetchInit.body = init.body
  try {
    await fetch(req.url, fetchInit)
  } catch {
    // the replayed request (and any failure) is captured by the interceptor
  }
}
