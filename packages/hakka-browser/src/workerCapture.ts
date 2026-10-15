/**
 * hakka-browser/worker — capture network traffic from INSIDE a Web Worker.
 *
 * Hakka's normal interceptors live on the main thread, so traffic originating
 * in a Worker (a data worker doing `fetch`, a Partytown-sandboxed script) is
 * invisible to it. Import this shim in the worker and call `captureInWorker()`;
 * it patches the worker's own fetch/XHR/WebSocket and posts each record to the
 * main thread, where the host app (`captureWorkers: true`) ingests it into the
 * same store the overlay reads. No import side effects — capture only starts
 * once `captureInWorker()` is called explicitly.
 */
import {
  DEFAULT_CONFIG,
  enableFetchInterceptor,
  enableWebSocketInterceptor,
  enableXHRInterceptor,
  redactHeaders as redactHeaderMap,
  redactHeaderValues,
  redactJsonBody,
  type NetworkRequest,
} from 'hakka-core'

/** Key of the envelope posted from a worker to the main thread for each record. */
export const HAKKA_WORKER_MESSAGE = '__hakka_worker_record'

export interface WorkerCaptureOptions {
  /** Max captured body size in bytes. Default: hakka-core's default (256 KB). */
  maxBodySize?: number
  /** Sensitive header names to redact. Default: hakka-core's default list. */
  redactHeaders?: string[]
}

/**
 * Re-apply the host's redaction settings to a record that arrived from a worker.
 * The worker runs its own copy of hakka-core, so the host's `redactHeaders` and
 * `redactBodyFields` never reach it; the main thread is the one place that knows both.
 */
export function redactWorkerRecord(req: NetworkRequest, headerNames: string[], bodyFields: string[]): NetworkRequest {
  const out: NetworkRequest = { ...req }
  if (req.requestHeaders) out.requestHeaders = redactHeaderMap(req.requestHeaders, headerNames)
  if (req.responseHeaders) out.responseHeaders = redactHeaderMap(req.responseHeaders, headerNames)
  if (req.responseHeaderValues) out.responseHeaderValues = redactHeaderValues(req.responseHeaderValues, headerNames)
  if (bodyFields.length > 0) {
    if (typeof req.requestBody === 'string')
      out.requestBody = redactJsonBody(req.requestBody, bodyFields) ?? req.requestBody
    if (typeof req.responseBody === 'string')
      out.responseBody = redactJsonBody(req.responseBody, bodyFields) ?? req.responseBody
    if (req.graphql?.variables) {
      const redacted = redactJsonBody(JSON.stringify(req.graphql.variables), bodyFields)
      if (redacted) out.graphql = { ...req.graphql, variables: JSON.parse(redacted) as typeof req.graphql.variables }
    }
    if (req.messages) {
      out.messages = req.messages.map((m) =>
        typeof m.data === 'string' && !m.binary ? { ...m, data: redactJsonBody(m.data, bodyFields) ?? m.data } : m,
      )
    }
  }
  return out
}

/** True when running inside a Worker global scope (not the main window). */
function inWorker(): boolean {
  return (
    typeof self !== 'undefined' &&
    typeof (self as { postMessage?: unknown }).postMessage === 'function' &&
    typeof (globalThis as { window?: unknown }).window === 'undefined'
  )
}

/**
 * Enable capture inside the current Worker and stream records to the main thread.
 * Idempotent-safe to call once per worker. Returns a teardown. No-op (returns a
 * no-op teardown) when not in a Worker.
 */
export function captureInWorker(options: WorkerCaptureOptions = {}): () => void {
  if (!inWorker()) return () => {}
  const maxBodySize = options.maxBodySize ?? DEFAULT_CONFIG.maxBodySize
  const redactHeaders = options.redactHeaders ?? DEFAULT_CONFIG.redactHeaders
  const scope = self as unknown as { postMessage: (m: unknown) => void }

  let active = true
  const post = (req: NetworkRequest): void => {
    if (!active) return
    try {
      scope.postMessage({ [HAKKA_WORKER_MESSAGE]: req })
    } catch {
      /* record not structured-clone-safe — drop it rather than break the worker */
    }
  }

  const teardowns: Array<() => void> = [enableFetchInterceptor(post, maxBodySize, redactHeaders)]
  if (typeof XMLHttpRequest !== 'undefined') teardowns.push(enableXHRInterceptor(post, maxBodySize, redactHeaders))
  if (typeof WebSocket !== 'undefined') teardowns.push(enableWebSocketInterceptor(post))

  return () => {
    active = false
    for (const t of teardowns) t()
  }
}
