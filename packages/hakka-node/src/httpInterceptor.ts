/**
 * Node `http` / `https` interceptor — covers what `fetch` doesn't: `axios`
 * (node adapter), `got`, `node-fetch`, and any SDK built on `http.request`,
 * by patching `request`/`get` on both modules. See
 * [What it captures](/node/overview/#what-it-captures) for the response-body
 * and phase-timing caveats (stream-safety: never taps the response body
 * stream, only `.once()` listeners on `socket`/`response` and their
 * end/close/aborted counterparts — full bodies are `fetch`-only).
 *
 * Trace propagation: when a `correlationId` is active for the current async
 * context (see `trace.ts`), every outgoing call gets BOTH `x-hakka-trace` and
 * a W3C `traceparent` header merged onto its outgoing headers, without
 * clobbering headers the caller already set.
 */
import nodeHttp from 'node:http'
import type { ClientRequest, IncomingMessage } from 'node:http'
import nodeHttps from 'node:https'
import type { Socket } from 'node:net'

import type { HttpMethod, NetworkRequest, RequestListener } from 'hakka-core'
import { HAKKA_TRACE_HEADER, currentTraceId, isSensitiveHeader } from 'hakka-core'

import { TRACEPARENT_HEADER, buildTraceparent } from './trace'

let patched = false
let counter = 0
const saved: Array<{ mod: typeof nodeHttp | typeof nodeHttps; key: 'request' | 'get'; fn: unknown }> = []

/** Bridge hub hosts skipped by default to avoid self-capture loops. */
export const DEFAULT_BRIDGE_HOSTS = ['localhost:8989', 'localhost:8990']

export interface HttpInterceptorOptions {
  /**
   * Pre-capture gate, evaluated per request right after the bridge-host skip
   * and BEFORE any capture work (timing, trace lookup, header injection). A
   * `false` return sends the original call straight through untouched — a
   * gated-out request carries none of Hakka's headers either. Mirrors
   * `hakka-core`'s fetch interceptor gate so `serverCapture.ts` can compose
   * one gate function shared by both interceptors.
   */
  shouldCapture?: () => boolean
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node
}

interface ParsedArgs {
  url: string
  method: HttpMethod
  rawHeaders: Record<string, string>
}

/** Normalize the (url|options, options?, cb?) overloads into url/method/headers. */
function parseArgs(args: unknown[], defaultProtocol: string): ParsedArgs {
  let urlArg: string | URL | undefined
  let options: Record<string, unknown> = {}

  if (typeof args[0] === 'string' || args[0] instanceof URL) {
    urlArg = args[0]
    if (args[1] && typeof args[1] === 'object') options = args[1] as Record<string, unknown>
  } else if (args[0] && typeof args[0] === 'object') {
    options = args[0] as Record<string, unknown>
  }

  let url: string
  if (urlArg !== undefined) {
    url = typeof urlArg === 'string' ? urlArg : urlArg.toString()
  } else {
    const protocol = (options.protocol as string) ?? defaultProtocol
    const host = (options.hostname as string) ?? (options.host as string) ?? 'localhost'
    const port = options.port ? `:${String(options.port)}` : ''
    const path = (options.path as string) ?? '/'
    url = `${protocol}//${host}${port}${path}`
  }

  const method = ((options.method as string) ?? 'GET').toUpperCase() as HttpMethod

  const rawHeaders: Record<string, string> = {}
  const headers = options.headers as Record<string, unknown> | undefined
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (v != null) rawHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v)
    }
  }

  return { url, method, rawHeaders }
}

/**
 * Merge `extra` headers onto the (url|options, options?, cb?) overload args,
 * inserting an options object if none is present, without clobbering headers
 * the caller already set. Returns `args` unchanged if `extra` is empty.
 */
function injectHeaders(args: unknown[], extra: Record<string, string>): unknown[] {
  if (Object.keys(extra).length === 0) return args
  const out = [...args]

  let optIdx = -1
  if (typeof out[0] === 'string' || out[0] instanceof URL) {
    if (out[1] && typeof out[1] === 'object') optIdx = 1
  } else if (out[0] && typeof out[0] === 'object') {
    optIdx = 0
  }

  if (optIdx === -1) {
    // No options object in this call shape — insert an empty one right after
    // the url (or at the front, for the options-less/callback-only overload).
    const insertAt = typeof out[0] === 'string' || out[0] instanceof URL ? 1 : 0
    out.splice(insertAt, 0, {})
    optIdx = insertAt
  }

  const opts = { ...(out[optIdx] as Record<string, unknown>) }
  const headers: Record<string, unknown> = { ...(opts.headers as Record<string, unknown> | undefined) }
  for (const [k, v] of Object.entries(extra)) {
    if (headers[k] == null) headers[k] = v
  }
  opts.headers = headers
  out[optIdx] = opts
  return out
}

function redact(headers: Record<string, string>, redactHeaders: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) out[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : v
  return out
}

function headersFromResponse(res: IncomingMessage, redactHeaders: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(res.headers)) {
    if (v == null) continue
    const val = Array.isArray(v) ? v.join(', ') : String(v)
    out[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : val
  }
  return out
}

function instrument(
  original: (...a: unknown[]) => ClientRequest,
  defaultProtocol: string,
  onRequest: RequestListener,
  maxBodySize: number,
  redactHeaders: string[],
  bridgeHosts: string[],
  interceptorOptions: HttpInterceptorOptions | undefined,
  args: unknown[],
): ClientRequest {
  const preParsed = parseArgs(args, defaultProtocol)

  // Skip Hakka's own bridge sockets to avoid self-capture loops.
  if (bridgeHosts.some((h) => preParsed.url.includes(h))) {
    return original(...args)
  }

  // Sampling / custom capture gate — evaluated before ANY capture work
  // (timing, trace lookup, header injection) so a gated-out request pays only
  // this check and goes out exactly as the caller built it. A throwing gate
  // means skip: fails toward "not captured" so a Hakka-internal bug in the
  // gate can never loop back into breaking the app's real request.
  const shouldCapture = interceptorOptions?.shouldCapture
  if (shouldCapture) {
    let capture = true
    try {
      capture = shouldCapture()
    } catch {
      capture = false
    }
    if (!capture) return original(...args)
  }

  const startTime = Date.now()
  const id = `http_${++counter}_${startTime}`
  // Captured synchronously, inside the incoming request's async context.
  const correlationId = currentTraceId()

  // Propagate the trace onward: emit BOTH the Hakka header and a W3C
  // traceparent so the next hop can link up however it reads trace context.
  const traceHeaders: Record<string, string> = correlationId
    ? { [HAKKA_TRACE_HEADER]: correlationId, [TRACEPARENT_HEADER]: buildTraceparent(correlationId) }
    : {}
  const finalArgs = injectHeaders(args, traceHeaders)
  // `injectHeaders` returns the SAME array reference when there's nothing to add
  // (no active trace), so the common untraced call reuses the parse already
  // done for the bridge-host check instead of walking the args a second time.
  const { url, method, rawHeaders } = finalArgs === args ? preParsed : parseArgs(finalArgs, defaultProtocol)
  const requestHeaders = redact(rawHeaders, redactHeaders)

  const req = original(...finalArgs)

  // Capture the request body by tapping write()/end() (bounded).
  let bodyBytes = 0
  const bodyParts: string[] = []
  const capture = (chunk: unknown): void => {
    if (bodyBytes >= maxBodySize || chunk == null || typeof chunk === 'function') return
    const str = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : ''
    if (!str) return
    bodyBytes += Buffer.byteLength(str)
    if (bodyParts.join('').length < maxBodySize) bodyParts.push(str)
  }
  const origWrite = req.write.bind(req)
  const origEnd = req.end.bind(req)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req.write = ((chunk: unknown, ...rest: unknown[]) => {
    capture(chunk)
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req.end = ((chunk: unknown, ...rest: unknown[]) => {
    capture(chunk)
    return (origEnd as (...a: unknown[]) => ClientRequest)(chunk, ...rest)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

  // ── Phase timing (dns/connect/tls/ttfb/download) off the socket lifecycle ──
  // `fetch` treats network timing as a black box; `http.request` doesn't, so
  // these phases are recovered here instead of leaving http-module captures
  // looking second-class in the timing waterfall.
  let dnsMs: number | undefined
  let connectMs: number | undefined
  let tlsMs: number | undefined
  let ttfbMs: number | undefined
  let downloadMs: number | undefined

  req.once('socket', (socket: Socket) => {
    try {
      const tSocket = Date.now()
      // A socket handed back from the agent's keep-alive pool is already
      // connected — `connecting` is only true while a NEW connection is being
      // established. Measuring a reused socket here would report near-zero
      // dns/connect/tls, which would be a lie: those phases ran (if at all)
      // for some EARLIER request on this socket, not this one. Leave them
      // undefined rather than fabricate a number.
      if (socket.connecting === false) return

      let lookupTime: number | undefined
      let connectTime: number | undefined
      // Not every request triggers a lookup — localhost/IP-literal targets
      // can skip DNS entirely, so this may simply never fire.
      socket.once('lookup', () => {
        lookupTime = Date.now()
        dnsMs = lookupTime - tSocket
      })
      socket.once('connect', () => {
        connectTime = Date.now()
        // Fall back to the socket's creation time when 'lookup' never fired
        // (see above) so connectMs still measures something meaningful.
        connectMs = connectTime - (lookupTime ?? tSocket)
      })
      // Only TLS (https) sockets ever emit this; plain http sockets won't.
      socket.once('secureConnect', () => {
        if (connectTime !== undefined) tlsMs = Date.now() - connectTime
      })
    } catch {
      /* a listener must never break the request */
    }
  })

  let emitted = false
  const emit = (extra: Partial<NetworkRequest>): void => {
    if (emitted) return
    emitted = true
    const endTime = Date.now()
    const duration = endTime - startTime
    const requestBody = bodyParts.length > 0 ? bodyParts.join('').slice(0, maxBodySize) : null
    const record: NetworkRequest = {
      id,
      url,
      method,
      correlationId,
      startTime,
      endTime,
      duration,
      requestHeaders,
      requestBody,
      requestBodySize: bodyBytes,
      responseBody: null,
      source: 'http',
      dnsMs,
      connectMs,
      tlsMs,
      ttfbMs,
      downloadMs,
      // Mirrors the fetch interceptor's timing shape so the UI's waterfall
      // doesn't need to special-case http-module captures.
      timing: { dnsMs, connectMs, tlsMs, ttfbMs, downloadMs, total: duration },
      ...extra,
    }
    try {
      onRequest(record)
    } catch {
      /* a listener must never break the request */
    }
  }

  req.on('response', (res: IncomingMessage) => {
    const responseTime = Date.now()
    ttfbMs = responseTime - startTime
    const responseHeaders = headersFromResponse(res, redactHeaders)
    const finish = (completed: boolean) => {
      // downloadMs only means something when the body actually finished
      // streaming — on 'close'/'aborted' the transfer was cut short, so it's
      // left undefined instead of reporting a bogus partial duration.
      if (completed) downloadMs = Date.now() - responseTime
      emit({
        status: res.statusCode ?? null,
        responseHeaders,
        contentType: res.headers['content-type'],
      })
    }
    res.on('end', () => finish(true))
    res.on('close', () => finish(false))
    res.on('aborted', () => finish(false))
  })
  req.on('error', (err: Error) => emit({ status: null, error: err.message }))
  req.on('timeout', () => emit({ status: null, error: 'timeout' }))

  return req
}

/**
 * Patch `http`/`https` `request` + `get` to report captured requests to
 * `onRequest`. No-op (and returns a no-op teardown) outside a Node runtime.
 */
export function enableHttpInterceptor(
  onRequest: RequestListener,
  maxBodySize: number,
  redactHeaders: string[],
  bridgeHosts: string[] = DEFAULT_BRIDGE_HOSTS,
  interceptorOptions?: HttpInterceptorOptions,
): () => void {
  if (patched) return () => disableHttpInterceptor()
  if (!isNodeRuntime()) return () => {}
  patched = true

  for (const mod of [nodeHttp, nodeHttps]) {
    const defaultProtocol = mod === nodeHttps ? 'https:' : 'http:'
    for (const key of ['request', 'get'] as const) {
      const original = mod[key] as unknown as (...a: unknown[]) => ClientRequest
      saved.push({ mod, key, fn: mod[key] })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mod as any)[key] = (...args: unknown[]): ClientRequest =>
        instrument(
          original,
          defaultProtocol,
          onRequest,
          maxBodySize,
          redactHeaders,
          bridgeHosts,
          interceptorOptions,
          args,
        )
    }
  }

  return () => disableHttpInterceptor()
}

/** Restore the original `http`/`https` methods. */
export function disableHttpInterceptor(): void {
  for (const { mod, key, fn } of saved) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mod as any)[key] = fn
  }
  saved.length = 0
  patched = false
}
