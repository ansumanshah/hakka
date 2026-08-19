import type { CaptureSource, CaptureSourceContext } from '../contract/captureSource'
import { createCycleGuard } from '../contract/cycleGuard'
import { breakpointEngine } from '../engine/BreakpointEngine'
import { mockEngine, type MockRequestContext, type MockResponseContext } from '../engine/MockEngine'
import { ThrottleEngine } from '../engine/ThrottleEngine'
import { HAKKA_TRACE_HEADER, resolveOutgoingTrace } from '../engine/trace'
import { TRACEPARENT_HEADER, buildTraceparent } from '../engine/traceparent'
import {
  DEFAULT_CONFIG,
  type NetworkRequest,
  type HttpMethod,
  type RequestListener,
  type GraphQLInfo,
} from '../model/types'
import { getBodyRedactionFields, redactJsonBody, redactParsedBody, tryParseJsonBody } from '../utils/bodyRedaction'
import { isSensitiveHeader } from '../utils/headerRedaction'
import { captureBody } from './bodyCapture'
import { isOwnBridgeUrl } from './bridgeHosts'
import { readCappedBody } from './readCappedBody'
import { captureSseBody } from './sseCapture'
import { captureInitiator } from './stackTrace'

/** Extract GraphQL metadata from a POST request body (operationName first, else parsed from `query`). */
function extractGraphQLInfo(method: string, body: string | null | undefined): GraphQLInfo | undefined {
  if (method !== 'POST' || !body) return undefined
  // Cheap substring pre-check before JSON.parse — a GraphQL body always carries a "query" key.
  if (!body.includes('"query"')) return undefined
  try {
    return extractGraphQLInfoFromParsed(JSON.parse(body))
  } catch {
    // not JSON — ignore
  }
  return undefined
}

/** Same extraction as extractGraphQLInfo, from an already-parsed value — avoids re-parsing a body the caller already parsed once (shared with redaction). */
function extractGraphQLInfoFromParsed(parsed: unknown): GraphQLInfo | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const obj = parsed as Record<string, unknown>

  const query = obj.query
  if (typeof query !== 'string') return undefined

  const typeMatch = query.match(/^\s*(query|mutation|subscription)\b/i)
  if (!typeMatch) return undefined

  const operationType = typeMatch[1].toLowerCase() as GraphQLInfo['operationType']

  let operationName: string | undefined
  if (typeof obj.operationName === 'string' && obj.operationName) {
    operationName = obj.operationName
  } else {
    const nameMatch = query.match(/(?:query|mutation|subscription)\s+(\w+)/i)
    operationName = nameMatch?.[1]
  }

  const variables =
    obj.variables && typeof obj.variables === 'object' ? (obj.variables as Record<string, unknown>) : undefined

  return { operationType, operationName, variables }
}

/** Detect protocol from a URL string — JS can't distinguish h2 from h1.1, only http from https. */
function detectProtocol(url: string): string | undefined {
  try {
    const scheme = url.split('://')[0]?.toLowerCase()
    if (scheme === 'https') return 'https'
    if (scheme === 'http') return 'http'
  } catch {
    // ignore
  }
  return undefined
}

let originalFetch: typeof globalThis.fetch | null = null
let counter = 0
type FetchInput = Parameters<typeof globalThis.fetch>[0]

function getFetchUrl(input: FetchInput): string {
  if (typeof input === 'string') return absolutizeUrl(input)
  if (input && typeof input === 'object' && 'url' in input && typeof input.url === 'string') {
    return absolutizeUrl(input.url)
  }
  return String(input)
}

/**
 * Resolve a relative URL against the page origin so captured records always carry an
 * absolute URL — otherwise host grouping, ignoreHosts/ignorePatterns, and the host
 * column all silently break on relative input. Browser-only; Node/RN fetches are
 * already absolute.
 */
function absolutizeUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || typeof location === 'undefined') return url
  try {
    return new URL(url, location.href).toString()
  } catch {
    return url
  }
}

export interface FetchInterceptorOptions {
  /** Pre-capture gate evaluated before any capture work; false sends the request through untouched — makes cohort sampling free for non-cohort traffic (ADR 0002), not "captured then dropped". */
  shouldCapture?: () => boolean
}

export function enableFetchInterceptor(
  onRequest: RequestListener,
  maxBodySize: number,
  redactHeaders: string[],
  interceptorOptions?: FetchInterceptorOptions,
): () => void {
  if (originalFetch) return () => disableFetchInterceptor()
  const shouldCapture = interceptorOptions?.shouldCapture

  originalFetch = globalThis.fetch
  const savedFetch = originalFetch

  // @ts-ignore bun-types adds extra properties to fetch
  globalThis.fetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const startTime = Date.now()
    const id = `fetch_${++counter}_${startTime}`

    // Pristine request, before any Hakka transform mutates input/init — used to fail open if our own prologue throws.
    const origInput = input
    const origInit = init

    // Capture the call site synchronously (opt-in; no-op + zero cost when off); undefined when disabled.
    const initiator = captureInitiator()

    // `let` so a request breakpoint can edit url/method/headers/body before send.
    let url = getFetchUrl(input)

    // Skip Hakka's own bridge connections to avoid self-capture noise
    if (isOwnBridgeUrl(url)) {
      return savedFetch(input, init)
    }

    // Per-request opt-out: `(init as any)._noHakka = true`, or a Request carrying the
    // 'x-hakka-ignore' header, bypasses all capture + throttle and calls the real fetch directly.
    const hasNoHakkaFlag = (init as Record<string, unknown> | undefined)?._noHakka === true
    const hasIgnoreHeader =
      input instanceof Request &&
      (input.headers.has('x-hakka-ignore') || (init as Record<string, unknown> | undefined)?._noHakka === true)
    if (hasNoHakkaFlag || hasIgnoreHeader) {
      return savedFetch(input, init)
    }

    // Cohort/sampling gate, decided before any capture allocation — a non-sampled request pays
    // only this call. A throwing gate means skip: fail open to the untouched request.
    if (shouldCapture) {
      let capture = true
      try {
        capture = shouldCapture()
      } catch {
        capture = false
      }
      if (!capture) return savedFetch(input, init)
    }

    // Best-effort Hakka work on user-controlled input/config (redaction regexes, mock matchers,
    // exotic Headers) — any throw here fails OPEN to the app's original, uncaptured request.
    let traceId: string | undefined
    let method: HttpMethod = (init?.method ?? 'GET').toUpperCase() as HttpMethod
    let requestHeaders: Record<string, string> = {}
    const rawRequestHeaders: Record<string, string> = {}
    let requestBodySize = 0
    const redactionFields = getBodyRedactionFields()
    let requestBody: string | null = null
    let graphql: GraphQLInfo | undefined
    let reqCtx!: MockRequestContext
    let mockRule!: ReturnType<typeof mockEngine.peek>
    try {
      // Trace correlation (docs/concepts/trace-correlation.md): injects Hakka's header + a W3C
      // traceparent using the same derived trace-id so an OTel-instrumented next hop continues
      // the trace instead of minting a new one.
      traceId = resolveOutgoingTrace(url)
      // Set only in the non-Request-input branch, where `h` becomes init.headers itself — lets
      // the pass below iterate `h` directly instead of a second `new Headers()` copy.
      let outgoingHeaders: Headers | undefined
      if (traceId) {
        const h = new Headers(input instanceof Request ? input.headers : init?.headers)
        if (!h.has(HAKKA_TRACE_HEADER)) h.set(HAKKA_TRACE_HEADER, traceId)
        if (!h.has(TRACEPARENT_HEADER)) h.set(TRACEPARENT_HEADER, buildTraceparent(traceId))
        if (input instanceof Request) {
          // `h` was seeded from the Request's own headers, not init.headers — recording below
          // reads init.headers only, so `h` must not be reused as outgoingHeaders here.
          input = new Request(input, { headers: h })
        } else {
          init = { ...init, headers: h }
          outgoingHeaders = h
        }
      }

      // Build redacted + raw headers in one pass, reading init.headers ONLY — a Request's own
      // headers are intentionally not recorded unless mirrored into init.headers above (relied
      // on elsewhere; do not "fix"). Reuses `h` from the trace branch when available.
      if (!outgoingHeaders && init?.headers) outgoingHeaders = new Headers(init.headers)
      outgoingHeaders?.forEach((v, k) => {
        rawRequestHeaders[k] = v
        requestHeaders[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : v
      })

      // Capture the body without corrupting non-string types (FormData/Blob/ArrayBuffer/stream).
      const bodyCapture = captureBody(init?.body)
      requestBodySize = bodyCapture.size
      if (bodyCapture.preview != null && bodyCapture.size <= maxBodySize) {
        const preview = bodyCapture.preview
        // Cheap substring pre-check before JSON.parse; redaction only replaces values, never
        // key names, so this check holds before or after redaction.
        const looksLikeGraphQL = method === 'POST' && preview.includes('"query"')
        if (redactionFields.length > 0) {
          // Parse once; feed the same parsed value to redaction and GraphQL extraction below.
          const parsed = tryParseJsonBody(preview)
          const redaction = redactParsedBody(preview, parsed, redactionFields)
          requestBody = redaction.text
          // Derived from the redacted value — a redacted field must not leak into the graphql summary.
          graphql = looksLikeGraphQL ? extractGraphQLInfoFromParsed(redaction.value) : undefined
        } else {
          requestBody = preview
          graphql = looksLikeGraphQL ? extractGraphQLInfoFromParsed(tryParseJsonBody(preview)) : undefined
        }
      } else {
        requestBody = null
        graphql = undefined
      }

      // Shared by mock body providers and rewrite transforms — raw (unredacted) so transforms see real values.
      reqCtx = {
        url,
        method,
        headers: rawRequestHeaders,
        body: bodyCapture.preview ?? undefined,
      }

      // peek() does not count a hit — recorded only when a rule is actually applied.
      mockRule = mockEngine.peek(url, method)
    } catch {
      // Hakka's own capture/redaction/mock-matching threw — never break the app.
      return savedFetch(origInput, origInit)
    }

    // Block: abort the matched request with a network error before it is sent.
    if (mockRule?.block) {
      mockEngine.recordHit(mockRule)
      const endTime = Date.now()
      try {
        onRequest({
          id,
          url,
          method,
          status: null,
          startTime,
          endTime,
          duration: endTime - startTime,
          requestHeaders,
          requestBody,
          requestBodySize,
          responseBody: null,
          error: 'Blocked by Hakka',
          source: 'fetch',
          initiator,
          mocked: true,
          graphql,
        } as NetworkRequest)
      } catch {
        /* never break the real request */
      }
      throw new TypeError('Failed to fetch')
    }

    // Mock mode: serve a canned (optionally dynamic via bodyProvider) response without hitting the network.
    if (mockRule && !mockEngine.isRewrite(mockRule)) {
      mockEngine.recordHit(mockRule)
      const mockDelay = Math.min(mockRule.response.delay ?? 0, 30_000)
      if (mockDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve as () => void, mockDelay))
      }
      const endTime = Date.now()
      const duration = endTime - startTime
      const bodyStr = await mockEngine.resolveMockBody(mockRule, reqCtx)
      const mockHeaders = new Headers({
        'content-type': 'application/json',
        ...mockRule.response.headers,
      })
      const mockResponse = new Response(bodyStr, {
        status: mockRule.response.status,
        headers: mockHeaders,
      })
      try {
        onRequest({
          id,
          url,
          method,
          status: mockRule.response.status,
          startTime,
          duration,
          endTime,
          requestHeaders,
          requestBody,
          requestBodySize,
          responseHeaders: Object.fromEntries(mockHeaders.entries()),
          responseBody: bodyStr,
          responseBodySize: bodyStr.length,
          error: null,
          source: 'fetch',
          initiator,
          mocked: true,
          graphql,
        } as NetworkRequest)
      } catch {
        /* never break the real request */
      }
      return mockResponse
    }

    // Rewrite mode: let the real request through, transforming outgoing request and/or response.
    const rewriteRule = mockRule && mockEngine.isRewrite(mockRule) ? mockRule : null

    try {
      // Apply throttle delay or throw offline error before sending. Guarded on isActive to skip
      // the awaited call when throttling is off; the 'offline' profile stays active either way.
      if (ThrottleEngine.isActive) await ThrottleEngine.applyDelay()

      if (rewriteRule) {
        // applyDelay() above already passed (no offline abort), so the request
        // will go out — count the hit now.
        mockEngine.recordHit(rewriteRule)
        const sentCtx = await mockEngine.applyRewriteRequest(rewriteRule, reqCtx)
        const reqChanged = sentCtx !== reqCtx
        const rwStartMs = Date.now()
        const realResponse = reqChanged
          ? await savedFetch(sentCtx.url, { method: sentCtx.method, headers: sentCtx.headers, body: sentCtx.body })
          : await savedFetch(input, init)
        const ttfbMs = Date.now() - rwStartMs

        const realHeaders: Record<string, string> = {}
        realResponse.headers.forEach((v, k) => {
          realHeaders[k] = v
        })
        const realBody = await realResponse.clone().text()

        const resInput: MockResponseContext = { status: realResponse.status, headers: realHeaders, body: realBody }
        const resCtx = await mockEngine.applyRewriteResponse(rewriteRule, resInput, sentCtx)
        const resChanged = resCtx !== resInput

        const endTime = Date.now()
        const duration = endTime - startTime
        const sentBody = sentCtx.body ?? null
        const sentBodySize = sentBody != null ? sentBody.length : 0
        // Re-derive GraphQL metadata from the rewritten request, not the original.
        const rewrittenGraphql = extractGraphQLInfo(sentCtx.method, sentBody)

        const recordedReqHeaders: Record<string, string> = {}
        for (const [k, v] of Object.entries(sentCtx.headers)) {
          recordedReqHeaders[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : v
        }
        const recordedResHeaders: Record<string, string> = {}
        for (const [k, v] of Object.entries(resCtx.headers)) {
          recordedResHeaders[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : v
        }

        try {
          onRequest({
            id,
            url: sentCtx.url,
            method: sentCtx.method as HttpMethod,
            status: resCtx.status,
            startTime,
            endTime,
            duration,
            requestHeaders: recordedReqHeaders,
            responseHeaders: recordedResHeaders,
            requestBodySize: sentBodySize,
            responseBodySize: resCtx.body.length,
            requestBody:
              sentBody != null && sentBodySize <= maxBodySize
                ? (redactJsonBody(sentBody, redactionFields) ?? sentBody)
                : null,
            responseBody:
              resCtx.body.length <= maxBodySize ? (redactJsonBody(resCtx.body, redactionFields) ?? resCtx.body) : null,
            error: null,
            source: 'fetch',
            initiator,
            mocked: false,
            rewritten: true,
            graphql: rewrittenGraphql,
            timing: {
              dnsMs: undefined,
              connectMs: undefined,
              tlsMs: undefined,
              ttfbMs,
              downloadMs: undefined,
              total: duration,
            },
            ttfbMs,
          } as NetworkRequest)
        } catch {
          /* never break the real request */
        }

        // If the response wasn't transformed, hand back the real (intact, possibly binary/streamed)
        // response — only reconstruct from text when the response was actually rewritten.
        if (!resChanged) return realResponse
        const canHaveBody = resCtx.status >= 200 && resCtx.status !== 204 && resCtx.status !== 304
        try {
          return new Response(canHaveBody ? resCtx.body : null, {
            status: resCtx.status,
            headers: new Headers(resCtx.headers),
          })
        } catch {
          return realResponse
        }
      }

      let effInput: FetchInput = input
      let effInit = init
      if (breakpointEngine.matches(url, method, 'request')) {
        const action = await breakpointEngine.pause(id, 'request', {
          url,
          method,
          headers: rawRequestHeaders,
          body: requestBody,
        })
        if (action.type === 'abort') {
          // Throw with the abort reason — the interceptor's own catch records it, so there's no double-record.
          throw new TypeError('Aborted by Hakka')
        }
        const e = action.edits
        if (e) {
          if (e.url != null) {
            url = e.url
            effInput = e.url
          }
          if (e.method != null) method = e.method.toUpperCase() as HttpMethod
          if (e.body !== undefined) {
            requestBody = e.body
            requestBodySize = e.body ? e.body.length : 0
          }
          if (e.headers != null) {
            // Re-derive the redacted (recorded) headers from the edited raw set.
            requestHeaders = {}
            for (const [k, v] of Object.entries(e.headers)) {
              requestHeaders[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : v
            }
          }
          effInit = {
            ...init,
            method,
            headers: e.headers ?? init?.headers,
            body: e.body !== undefined ? (e.body ?? undefined) : init?.body,
          }
        }
      }

      const fetchStartMs = Date.now()
      let response = await savedFetch(effInput, effInit)
      // TTFB: time from fetch start to when response headers arrived
      const ttfbMs = Date.now() - fetchStartMs

      // Apply bandwidth throttling if active — must happen BEFORE any clone/read below, since
      // the body can only be consumed once and both caller and capture must see it throttled.
      if (ThrottleEngine.isActive) {
        const downloadKbps = ThrottleEngine.current.downloadKbps ?? 0
        if (downloadKbps > 0) {
          response = ThrottleEngine.throttleResponse(response, downloadKbps)
        }
      }

      // Only when a `response`/`both` rule matches; body is read inline here (the pause needs
      // it), leaving the common path below untouched with its non-blocking background read.
      if (breakpointEngine.matches(url, method, 'response')) {
        const rawResHeaders: Record<string, string> = {}
        response.headers.forEach((v, k) => {
          rawResHeaders[k] = v
        })
        let resStatus = response.status
        let resHeaders = rawResHeaders
        let resBody: string
        try {
          resBody = await response.clone().text()
        } catch {
          resBody = ''
        }

        const action = await breakpointEngine.pause(id, 'response', {
          status: resStatus,
          headers: rawResHeaders,
          body: resBody,
        })
        if (action.type === 'abort') {
          // Caught by this interceptor's own catch — records status null + error.
          throw new TypeError('Aborted by Hakka')
        }
        const e = action.edits
        if (e) {
          if (e.status != null) resStatus = e.status
          if (e.headers != null) resHeaders = e.headers
          if (e.body !== undefined) resBody = e.body
        }

        const recordedResHeaders: Record<string, string> = {}
        for (const [k, v] of Object.entries(resHeaders)) {
          recordedResHeaders[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : v
        }

        const endTime = Date.now()
        const duration = endTime - startTime
        const downloadMs = endTime - fetchStartMs - ttfbMs
        const redirected = response.redirected === true
        try {
          onRequest({
            id,
            url,
            method,
            status: resStatus,
            startTime,
            endTime,
            duration,
            requestHeaders,
            responseHeaders: recordedResHeaders,
            requestBodySize,
            responseBodySize: resBody.length,
            requestBody,
            responseBody: resBody.length <= maxBodySize ? (redactJsonBody(resBody, redactionFields) ?? resBody) : null,
            error: null,
            source: 'fetch',
            initiator,
            graphql,
            timing: { dnsMs: undefined, connectMs: undefined, tlsMs: undefined, ttfbMs, downloadMs, total: duration },
            ttfbMs,
            downloadMs,
            redirectCount: redirected ? 1 : 0,
            redirectUrls: redirected && response.url !== url ? [response.url] : [],
            networkProtocol: detectProtocol(response.url || url),
          } as NetworkRequest)
        } catch {
          /* never break the real request */
        }

        // Reconstruct the response the caller receives with the (edited) values.
        const canHaveBody = resStatus >= 200 && resStatus !== 204 && resStatus !== 304
        try {
          return new Response(canHaveBody ? resBody : null, {
            status: resStatus,
            headers: new Headers(resHeaders),
          })
        } catch {
          // Edited status outside the constructable range, etc. — hand back the real one.
          return response
        }
      }

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => {
        responseHeaders[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : v
      })

      const redirected = response.redirected === true
      const redirectCount = redirected ? 1 : 0
      const redirectUrls: string[] = redirected && response.url !== url ? [response.url] : []
      const networkProtocol = detectProtocol(response.url || url)

      // Return response immediately; read body in background — awaiting it here would add latency proportional to response size.
      const headerTime = Date.now()
      const headerDuration = headerTime - startTime

      const request: NetworkRequest = {
        id,
        url,
        method,
        correlationId: traceId,
        status: response.status,
        startTime,
        endTime: headerTime,
        duration: headerDuration,
        requestHeaders,
        responseHeaders,
        requestBodySize,
        responseBodySize: 0,
        requestBody,
        responseBody: null,
        error: null,
        source: 'fetch',
        initiator,
        graphql,
        timing: {
          dnsMs: undefined,
          connectMs: undefined,
          tlsMs: undefined,
          ttfbMs,
          downloadMs: undefined,
          total: headerDuration,
        },
        ttfbMs,
        redirectCount,
        redirectUrls,
        networkProtocol,
      }
      onRequest(request)

      // Skip the body clone where cloning is harmful — application/wasm: clone() makes the
      // browser re-fetch the module and breaks WebAssembly.instantiateStreaming(). Plain
      // `chunked` transfer is NOT skipped; those bodies clone fine.
      const contentType = response.headers.get('content-type') ?? ''
      const isWasm = contentType.includes('application/wasm') || url.toLowerCase().split('?')[0].endsWith('.wasm')
      const isEventStream = contentType.includes('text/event-stream')
      if (isWasm) {
        return response
      }

      // SSE (text/event-stream): incremental capture, not a skip.
      // A plain clone().text() would await forever on a long-lived stream (e.g. an LLM token
      // stream). Hand a synchronous clone to sseCapture's incremental reader as a detached task
      // instead — it pushes throttled updates through the same onRequest path as the ordinary
      // body-read below. `return response` still resolves at headers-received time. A stream
      // that never closes emits at most maxBodySize worth of updates, then cancels (sseCapture.ts).
      // NetworkRequest has no `streaming` field; `contentType` doubles as that signal here.
      if (isEventStream) {
        const sseClone = response.clone()
        void (async () => {
          try {
            await captureSseBody(sseClone, maxBodySize, (update) => {
              const endTime = Date.now()
              const duration = endTime - startTime
              onRequest({
                ...request,
                endTime,
                duration,
                contentType,
                responseBodySize: update.size,
                responseBody: update.text ? (redactJsonBody(update.text, redactionFields) ?? update.text) : null,
                responseBodyTruncated: update.truncated,
                streaming: !update.done,
                timing: { ...request.timing, total: duration },
              })
            })
          } catch {
            // Body may not be readable — the header-only event above already stands in.
          }
        })()
        return response
      }

      // Clone synchronously (before the caller can consume the original), then read + emit the
      // body in a detached task — awaiting it here would delay the caller until the whole body
      // downloaded and break incremental reads (LLM token streams, progressive JSON). The clone
      // reads independently, so the app's own response.body/.json() is untouched.
      const bodyClone = response.clone()
      void (async () => {
        try {
          const downloadStartMs = Date.now()
          // Streams the body, capping retained memory at maxBodySize while still reporting the exact size (see readCappedBody).
          const { preview, size, truncated } = await readCappedBody(bodyClone, maxBodySize)
          const downloadMs = Date.now() - downloadStartMs
          const responseBodySize = size
          const endTime = Date.now()
          const duration = endTime - startTime

          onRequest({
            ...request,
            endTime,
            duration,
            responseBodySize,
            responseBody: preview != null ? (redactJsonBody(preview, redactionFields) ?? preview) : null,
            // Only set when the cap was actually crossed (size then best-known, not exact).
            responseBodyTruncated: truncated,
            timing: { dnsMs: undefined, connectMs: undefined, tlsMs: undefined, ttfbMs, downloadMs, total: duration },
            downloadMs,
          })
        } catch {
          // Body may not be readable — header-only event already emitted
        }
      })()

      return response
    } catch (err) {
      const endTime = Date.now()
      const duration = endTime - startTime
      const request: NetworkRequest = {
        id,
        url,
        method,
        status: null,
        startTime,
        endTime,
        duration,
        requestHeaders,
        responseHeaders: {},
        requestBodySize,
        responseBodySize: 0,
        requestBody,
        responseBody: null,
        correlationId: traceId,
        error: err instanceof Error ? err.message : String(err),
        source: 'fetch',
        initiator,
        graphql,
      }
      onRequest(request)
      throw err
    }
  }

  return () => disableFetchInterceptor()
}

function disableFetchInterceptor(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch
    originalFetch = null
  }
}

/** Options for {@link createFetchCaptureSource}, mirroring `enableFetchInterceptor`'s own parameters (positional there; grouped here since a `CaptureSource` factory takes no per-start arguments). */
export interface FetchCaptureSourceOptions {
  /** Bytes above which a request/response body is dropped, keeping only its size. Defaults to `DEFAULT_CONFIG.maxBodySize` (the same default `HakkaFacade` uses). */
  maxBodySize?: number
  /** Header names redacted to `'[REDACTED]'` before capture. Defaults to `DEFAULT_CONFIG.redactHeaders`. */
  redactHeaders?: string[]
  /** Forwarded to `enableFetchInterceptor` unchanged — the cohort/sampling pre-capture gate (ADR 0002). */
  interceptorOptions?: FetchInterceptorOptions
}

/**
 * `CaptureSource` (ADR 0006) wrapper around `enableFetchInterceptor()`. `runtime` is a fixed
 * `'client'` literal — this factory only wraps the browser/RN-global patch in THIS file.
 * `hakka-node`'s server-side reuse of the very same `enableFetchInterceptor` (in
 * `serverCapture.ts`/`prod.ts`) re-tags emitted records `runtime: 'server'`
 * itself, after the fact, via its own `onRequest` wrapper — that is a SEPARATE call site with its
 * own `CaptureSource` migration to do later, not something this factory can or should special-case
 * (see ADR 0006 row 1's Fit note).
 *
 * **Double-emission is intentional, not a bug this wrapper papers over.** A successful,
 * non-WASM, non-SSE fetch calls `onRequest` up to TWICE for the SAME `id` — once at
 * headers-received time (`responseBody: null`), once more from a detached background task once
 * the body finishes downloading (see the two `onRequest(...)` call sites above, and
 * `fetchBasics.test.ts`'s "two-phase emission" test, which this file's own conformance test
 * exercises the same way). Unlike `hakka-node/prod.ts`'s `onRequest`, which folds the second call
 * into its own bare `RingBuffer` by hand (`ring.update(tagged) || ring.add(tagged)` — that
 * `RingBuffer` has no merge-by-id of its own), this wrapper forwards BOTH calls to `ctx.ingest`
 * unchanged. That is correct here because `ctx.ingest` on a real host is backed by
 * `HakkaFacade#ingestRequest`, which already merges same-`id` records
 * (`findDuplicateRequest`/`mergeDuplicateRequest`) — the identical mechanism the WebSocket source
 * relies on for its own repeated same-`id` emissions (ADR 0006 row 3). A naive recording `ctx`
 * (a plain array push, no merge-by-id — e.g. `conformance.ts`'s harness, or this file's own
 * double-emission unit test below) will legitimately see two records sharing one `id`; that is
 * the documented contract, not a double-wiring defect.
 */
export function createFetchCaptureSource(options?: FetchCaptureSourceOptions): CaptureSource {
  let disposer: (() => void) | null = null
  const cycle = createCycleGuard()

  return {
    id: 'hakka.fetch',
    runtime: 'client',
    transport: 'fetch',
    correlation: 'originates',
    start(ctx: CaptureSourceContext) {
      if (disposer) return // already started — idempotent per the CaptureSource contract
      const isCurrent = cycle.begin()
      disposer = enableFetchInterceptor(
        (request) => {
          // A body-phase (or any other) emission that resolves after stop() must not reach ctx.ingest.
          if (!isCurrent()) return
          ctx.ingest(request)
        },
        options?.maxBodySize ?? DEFAULT_CONFIG.maxBodySize,
        options?.redactHeaders ?? DEFAULT_CONFIG.redactHeaders,
        options?.interceptorOptions,
      )
    },
    stop() {
      if (!disposer) return // never started, or already stopped — idempotent per the contract
      cycle.end()
      disposer()
      disposer = null
    },
  }
}
