import type { CaptureSource, CaptureSourceContext } from '../contract/captureSource'
import { createCycleGuard } from '../contract/cycleGuard'
import { breakpointEngine } from '../engine/BreakpointEngine'
import { MOCK_FAILURE_MESSAGES, mockEngine, type MockRequestContext } from '../engine/MockEngine'
import { ThrottleEngine } from '../engine/ThrottleEngine'
import { HAKKA_TRACE_HEADER, resolveOutgoingTrace } from '../engine/trace'
import { TRACEPARENT_HEADER, buildTraceparent } from '../engine/traceparent'
import type { NetworkRequest, HttpMethod, RequestListener, NetworkTiming } from '../model/types'
import { getBodyRedactionFields, redactJsonBody } from '../utils/bodyRedaction'
import { isSensitiveHeader } from '../utils/headerRedaction'
import { captureBody } from './bodyCapture'
import { isOwnBridgeUrl } from './bridgeHosts'
import { captureInitiator } from './stackTrace'

interface XHRState {
  id: string
  url: string
  method: HttpMethod
  startTime: number
  requestHeaders: Record<string, string>
  requestBody: string | null
  requestBodySize: number
  /** Call-site stack — populated only when stack capture is enabled. */
  initiator?: string
  headersReceivedTime: number
  firstDataTime: number
  /** Raw headers captured during open() for replay after a breakpoint edit */
  rawRequestHeaders: Record<string, string>
  /**
   * Lowercased header names the caller has already set — `setRequestHeader` APPENDS on a
   * repeat call rather than overwriting, so trace injection must skip (not re-call) any
   * name already in this set to avoid corrupting a caller-supplied value.
   */
  setHeaderNamesLower: Set<string>
  /** Resolved once per `send()`; mirrors fetch.ts's trace correlation. Undefined when trace propagation is disabled or no ambient/server context applies. */
  correlationId?: string
}

const xhrState = new WeakMap<XMLHttpRequest, XHRState>()
let counter = 0
let origOpen: typeof XMLHttpRequest.prototype.open | null = null
let origSend: typeof XMLHttpRequest.prototype.send | null = null
let origSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null

export function enableXHRInterceptor(
  onRequest: RequestListener,
  maxBodySize: number,
  redactHeaders: string[],
): () => void {
  if (origOpen) return () => disableXHRInterceptor()

  origOpen = XMLHttpRequest.prototype.open
  origSend = XMLHttpRequest.prototype.send
  origSetHeader = XMLHttpRequest.prototype.setRequestHeader

  const savedOpen = origOpen
  const savedSend = origSend
  const savedSetHeader = origSetHeader

  /**
   * Inject Hakka's trace headers, mirroring fetch.ts's dual-header contract — the raw
   * correlationId plus a derived W3C traceparent, so an OTel-instrumented next hop
   * continues the same trace. Guarded against caller-supplied duplicates per the
   * `setHeaderNamesLower` doc above (setRequestHeader appends, so it can't just re-call).
   */
  function injectTraceHeaders(xhr: XMLHttpRequest, state: XHRState, traceId: string): void {
    if (!state.setHeaderNamesLower.has(HAKKA_TRACE_HEADER)) {
      savedSetHeader.call(xhr, HAKKA_TRACE_HEADER, traceId)
      state.rawRequestHeaders[HAKKA_TRACE_HEADER] = traceId
      state.requestHeaders[HAKKA_TRACE_HEADER] = isSensitiveHeader(HAKKA_TRACE_HEADER, redactHeaders)
        ? '[REDACTED]'
        : traceId
    }
    if (!state.setHeaderNamesLower.has(TRACEPARENT_HEADER)) {
      const traceparent = buildTraceparent(traceId)
      savedSetHeader.call(xhr, TRACEPARENT_HEADER, traceparent)
      state.rawRequestHeaders[TRACEPARENT_HEADER] = traceparent
      state.requestHeaders[TRACEPARENT_HEADER] = isSensitiveHeader(TRACEPARENT_HEADER, redactHeaders)
        ? '[REDACTED]'
        : traceparent
    }
  }

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
    const rawUrl = typeof url === 'string' ? url : url.toString()
    // Absolutize relative URLs against the page — same reasoning as fetch.ts's absolutizeUrl.
    let urlStr = rawUrl
    if (!/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) && typeof location !== 'undefined') {
      try {
        urlStr = new URL(rawUrl, location.href).toString()
      } catch {
        /* keep the raw value */
      }
    }

    // Skip Hakka's own bridge connections to avoid self-capture noise
    if (isOwnBridgeUrl(urlStr)) {
      // eslint-disable-next-line prefer-rest-params
      return savedOpen.apply(this, arguments as unknown as Parameters<typeof savedOpen>)
    }

    const state: XHRState = {
      id: `xhr_${++counter}_${Date.now()}`,
      url: urlStr,
      method: method.toUpperCase() as HttpMethod,
      startTime: Date.now(),
      requestHeaders: {},
      rawRequestHeaders: {},
      setHeaderNamesLower: new Set(),
      requestBody: null,
      requestBodySize: 0,
      headersReceivedTime: 0,
      firstDataTime: 0,
      // Captured at open() so the frames are the app's call site (opt-in).
      initiator: captureInitiator(),
    }
    xhrState.set(this, state)
    // eslint-disable-next-line prefer-rest-params
    savedOpen.apply(this, arguments as unknown as Parameters<typeof savedOpen>)
  }

  XMLHttpRequest.prototype.setRequestHeader = function (header: string, value: string) {
    const state = xhrState.get(this)
    if (state) {
      state.rawRequestHeaders[header] = value
      state.requestHeaders[header] = isSensitiveHeader(header, redactHeaders) ? '[REDACTED]' : value
      state.setHeaderNamesLower.add(header.toLowerCase())
    }
    savedSetHeader.call(this, header, value)
  }

  XMLHttpRequest.prototype.send = function (data?: unknown) {
    const state = xhrState.get(this)
    if (state) {
      if (data != null) {
        const capture = captureBody(data)
        state.requestBodySize = capture.size
        const redactionFields = getBodyRedactionFields()
        const rawPreview = capture.preview != null && capture.size <= maxBodySize ? capture.preview : null
        state.requestBody = rawPreview != null ? (redactJsonBody(rawPreview, redactionFields) ?? rawPreview) : null
      }
      state.startTime = Date.now() // More accurate timing
    }

    // oxlint-disable-next-line typescript/no-this-alias
    const xhr = this

    // Per-request opt-out: `(xhr as any)._noHakka = true` before send() bypasses all capture.
    if ((xhr as Record<string, unknown>)._noHakka === true) {
      // eslint-disable-next-line prefer-rest-params
      savedSend.apply(xhr, arguments as unknown as Parameters<typeof savedSend>)
      return
    }

    // Trace correlation (mirrors fetch.ts's resolveOutgoingTrace): injected BEFORE the
    // offline/block/mock decisions below so every emitted record carries the same
    // correlationId; the setRequestHeader call is a no-op for paths that never reach savedSend
    // (offline/block/mock-serve), since the headers are then never sent.
    if (state) {
      state.correlationId = resolveOutgoingTrace(state.url)
      if (state.correlationId) injectTraceHeaders(xhr, state, state.correlationId)
    }

    // XHR can't be dropped mid-flight, so this short-circuits before savedSend and emits a
    // synthetic error record + error event.
    if (state && ThrottleEngine.isOffline) {
      setTimeout(() => {
        const endTime = Date.now()
        const duration = endTime - state.startTime
        const errRecord: NetworkRequest = {
          id: state.id,
          url: state.url,
          method: state.method,
          status: null,
          startTime: state.startTime,
          endTime,
          duration,
          requestHeaders: state.requestHeaders,
          responseHeaders: {},
          requestBodySize: state.requestBodySize,
          responseBodySize: 0,
          requestBody: state.requestBody,
          responseBody: null,
          correlationId: state.correlationId,
          error: 'Network request failed — offline mode (Hakka)',
          source: 'xhr',
          initiator: state.initiator,
        }
        try {
          onRequest(errRecord)
        } catch {
          /* never break callers */
        }
        // Dispatch a synthetic error event so the caller's onerror/event handler fires.
        // _fire is the test suite's FakeXHR hook; ProgressEvent may be undefined in non-DOM envs.
        ;(xhr as unknown as { _fire?: (e: string) => void })._fire?.('error')
        if (typeof ProgressEvent !== 'undefined') {
          xhr.dispatchEvent?.(new ProgressEvent('error'))
        }
      }, 0)
      return
    }

    let mockRule = state ? mockEngine.peek(state.url, state.method) : null
    // skipCount/stopAfter gate — see fetch.ts's identical comment. Consumes
    // the rule's match budget; `false` means treat this request as unmatched.
    if (mockRule && !mockEngine.admitMatch(mockRule)) mockRule = null

    // Mirrors fetch.ts's failure semantics: a failure-only rule carries no
    // mode/redirectTo/modify, so isRewrite() is false for it — without this
    // check first, it would fall through to mock-serve and be SERVED instead
    // of failed. XHR can't throw synchronously like fetch rejects, so this
    // defers to the next tick, like the offline short-circuit above.
    if (mockRule?.failure && state) {
      const failure = mockRule.failure
      mockEngine.recordHit(mockRule)
      setTimeout(() => {
        const endTime = Date.now()
        const duration = endTime - state.startTime
        const errRecord: NetworkRequest = {
          id: state.id,
          url: state.url,
          method: state.method,
          status: null,
          startTime: state.startTime,
          endTime,
          duration,
          requestHeaders: state.requestHeaders,
          responseHeaders: {},
          requestBodySize: state.requestBodySize,
          responseBodySize: 0,
          requestBody: state.requestBody,
          responseBody: null,
          correlationId: state.correlationId,
          error: MOCK_FAILURE_MESSAGES[failure.code],
          source: 'xhr',
          initiator: state.initiator,
          mocked: true,
        }
        try {
          onRequest(errRecord)
        } catch {
          /* never break callers */
        }
        ;(xhr as unknown as { _fire?: (e: string) => void })._fire?.('error')
        if (typeof ProgressEvent !== 'undefined') {
          xhr.dispatchEvent?.(new ProgressEvent('error'))
        }
      }, 0)
      // Don't call savedSend — request failed before any real response.
      return
    }

    // Mirrors fetch.ts's block semantics: a block-only rule carries no mode/redirectTo/modify, so
    // isRewrite() is false for it — without this check first, it would fall through to
    // mock-serve and be SERVED instead of blocked. XHR can't throw synchronously like fetch
    // rejects, so this defers to the next tick, like the offline short-circuit above.
    if (mockRule?.block && state) {
      mockEngine.recordHit(mockRule)
      setTimeout(() => {
        const endTime = Date.now()
        const duration = endTime - state.startTime
        const errRecord: NetworkRequest = {
          id: state.id,
          url: state.url,
          method: state.method,
          status: null,
          startTime: state.startTime,
          endTime,
          duration,
          requestHeaders: state.requestHeaders,
          responseHeaders: {},
          requestBodySize: state.requestBodySize,
          responseBodySize: 0,
          requestBody: state.requestBody,
          responseBody: null,
          correlationId: state.correlationId,
          error: 'Blocked by Hakka',
          source: 'xhr',
          initiator: state.initiator,
          mocked: true,
        }
        try {
          onRequest(errRecord)
        } catch {
          /* never break callers */
        }
        // Dispatch a synthetic error event so the caller's onerror / event handler fires.
        ;(xhr as unknown as { _fire?: (e: string) => void })._fire?.('error')
        if (typeof ProgressEvent !== 'undefined') {
          xhr.dispatchEvent?.(new ProgressEvent('error'))
        }
      }, 0)
      // Don't call savedSend — request is blocked
      return
    }

    // Only mock-mode rules short-circuit; rewrite-mode rules pass through to the real network
    // (rewrite transforms are fetch-only — XHR delivers responseText directly, so the
    // interceptor can't substitute it without breaking the contract).
    if (mockRule && state && !mockEngine.isRewrite(mockRule)) {
      // Record the hit here, not in peek(), to avoid inflating rewrite counts.
      mockEngine.recordHit(mockRule)
      const reqCtx: MockRequestContext = {
        url: state.url,
        method: state.method,
        headers: state.requestHeaders,
        body: state.requestBody ?? undefined,
      }
      const applyMock = async () => {
        const bodyStr = await mockEngine.resolveMockBody(mockRule, reqCtx)
        const endTime = Date.now()
        const duration = endTime - state.startTime

        const request: NetworkRequest = {
          id: state.id,
          url: state.url,
          method: state.method,
          status: mockRule.response.status,
          startTime: state.startTime,
          endTime,
          duration,
          requestHeaders: state.requestHeaders,
          responseHeaders: mockRule.response.headers ?? {},
          requestBodySize: state.requestBodySize,
          responseBodySize: bodyStr.length,
          requestBody: state.requestBody,
          responseBody: bodyStr,
          correlationId: state.correlationId,
          error: null,
          source: 'xhr',
          initiator: state.initiator,
          mocked: true,
        }
        try {
          onRequest(request)
        } catch {
          /* never break the real request */
        }
      }

      const delay = Math.min(mockRule.response.delay ?? 0, 30_000)
      if (delay > 0) {
        setTimeout(() => void applyMock(), delay)
      } else {
        void applyMock()
      }
      // Don't call savedSend — request is mocked
      return
    }

    // Track HEADERS_RECEIVED for TTFB timing
    xhr.addEventListener('readystatechange', () => {
      const s = xhrState.get(xhr)
      if (!s) return
      if (xhr.readyState === 2 /* HEADERS_RECEIVED */ && s.headersReceivedTime === 0) {
        s.headersReceivedTime = Date.now()
      }
      if (xhr.readyState === 3 /* LOADING */ && s.firstDataTime === 0) {
        s.firstDataTime = Date.now()
      }
    })

    // XHR can't stream a body incrementally like fetch, so throttling is approximated as a
    // COMPLETION DELAY: loadend is held for the time it would take to download the response
    // at downloadKbps, computed per-response in captureLoadend (size unknown at send time).
    // completionDelayMs = latencyMs + (responseBytes / (downloadKbps * 1024 / 8 / 1000))
    // (latencyMs already applied at send time; included again here to match the documented
    // "profile latency + download time" total.) Zero overhead when no throttle profile is active.
    const throttleIsActive = (() => {
      if (!ThrottleEngine.isActive) return false
      const { downloadKbps = 0, latencyMs = 0 } = ThrottleEngine.current
      return downloadKbps > 0 || latencyMs > 0
    })()

    // Intercept loadend in the capturing phase (fires before the caller's bubble-phase
    // handlers): stop propagation, apply the delay, then re-dispatch a synthetic event
    // (guarded by HAKKA_REPLAYED to avoid re-entry). Skipped entirely when throttle is inactive.
    const HAKKA_REPLAYED = '__hakka_replayed'

    const captureLoadend = throttleIsActive
      ? (event: Event) => {
          // Re-dispatched synthetic events pass through immediately — don't re-intercept.
          if ((event as unknown as Record<string, unknown>)[HAKKA_REPLAYED]) return

          const s = xhrState.get(xhr)
          if (!s) return

          event.stopImmediatePropagation()

          // Measure response size (same logic as the capture handler below).
          let responseBytes = 0
          if (xhr.responseType === '' || xhr.responseType === 'text') {
            responseBytes = xhr.responseText?.length ?? 0
          } else if (xhr.responseType === 'json' && xhr.response != null) {
            try {
              responseBytes = JSON.stringify(xhr.response).length
            } catch {
              responseBytes = 0
            }
          } else if (xhr.responseType === 'arraybuffer' && xhr.response) {
            responseBytes = (xhr.response as ArrayBuffer).byteLength
          } else if (xhr.responseType === 'blob' && xhr.response) {
            responseBytes = (xhr.response as Blob).size
          }

          const { downloadKbps = 0, latencyMs = 0 } = ThrottleEngine.current
          let delayMs = latencyMs
          if (downloadKbps > 0 && responseBytes > 0) {
            const bytesPerMs = (downloadKbps * 1024) / 8 / 1000
            delayMs += responseBytes / bytesPerMs
          }

          if (delayMs <= 0) {
            const synthetic = new Event('loadend')
            ;(synthetic as unknown as Record<string, unknown>)[HAKKA_REPLAYED] = true
            xhr.dispatchEvent(synthetic)
            return
          }

          setTimeout(() => {
            const synthetic = new Event('loadend')
            ;(synthetic as unknown as Record<string, unknown>)[HAKKA_REPLAYED] = true
            xhr.dispatchEvent(synthetic)
          }, delayMs)
        }
      : null

    if (captureLoadend) {
      // true = capturing phase — fires before any bubble-phase listeners
      xhr.addEventListener('loadend', captureLoadend as EventListener, true)
    }

    xhr.addEventListener('loadend', () => {
      const s = xhrState.get(xhr)
      if (!s) return
      const endTime = Date.now()
      const duration = endTime - s.startTime

      const responseHeaders: Record<string, string> = {}
      const allHeaders = xhr.getAllResponseHeaders()
      if (allHeaders) {
        for (const line of allHeaders.split('\r\n')) {
          const [key, ...valueParts] = line.split(': ')
          if (key && valueParts.length > 0) {
            const val = valueParts.join(': ')
            responseHeaders[key] = isSensitiveHeader(key, redactHeaders) ? '[REDACTED]' : val
          }
        }
      }

      const redactionFields = getBodyRedactionFields()
      let responseBody: string | null = null
      let responseBodySize = 0
      if (xhr.responseType === '' || xhr.responseType === 'text') {
        const text = xhr.responseText
        responseBodySize = text.length
        const underCap = responseBodySize <= maxBodySize ? text : null
        responseBody = underCap != null ? (redactJsonBody(underCap, redactionFields) ?? underCap) : null
      } else if (xhr.responseType === 'json') {
        try {
          const jsonStr = JSON.stringify(xhr.response)
          responseBodySize = jsonStr.length
          const underCap = responseBodySize <= maxBodySize ? jsonStr : null
          responseBody = underCap != null ? (redactJsonBody(underCap, redactionFields) ?? underCap) : null
        } catch {
          responseBody = '[Unable to stringify JSON response]'
        }
      } else if (xhr.responseType === 'arraybuffer' && xhr.response) {
        const buf = xhr.response as ArrayBuffer
        responseBodySize = buf.byteLength
        responseBody = `(arraybuffer: ${responseBodySize} bytes)`
      } else if (xhr.responseType === 'blob' && xhr.response) {
        const blob = xhr.response as Blob
        responseBodySize = blob.size
        responseBody = `(blob: ${responseBodySize} bytes)`
      }

      const ttfbMs = s.headersReceivedTime > 0 ? s.headersReceivedTime - s.startTime : undefined
      // Download = time from first data (or headers) to loadend
      const downloadRefTime = s.firstDataTime > 0 ? s.firstDataTime : s.headersReceivedTime
      const downloadMs = downloadRefTime > 0 ? endTime - downloadRefTime : undefined

      const timing: NetworkTiming = {
        dnsMs: undefined,
        connectMs: undefined,
        tlsMs: undefined,
        ttfbMs,
        downloadMs,
        total: duration,
      }

      const request: NetworkRequest = {
        id: s.id,
        url: s.url,
        method: s.method,
        status: xhr.status || null,
        startTime: s.startTime,
        endTime,
        duration,
        requestHeaders: s.requestHeaders,
        responseHeaders,
        requestBodySize: s.requestBodySize,
        responseBodySize,
        requestBody: s.requestBody,
        responseBody,
        correlationId: s.correlationId,
        error: xhr.status === 0 ? 'Network error' : null,
        source: 'xhr',
        initiator: s.initiator,
        timing,
        ttfbMs,
        downloadMs,
      }
      try {
        onRequest(request)
      } catch {
        /* never break callers */
      }
    })

    // XHR can't pause mid-flight, so this holds before savedSend; resume re-opens with any
    // URL/method edits then sends, abort emits an error record and never sends.
    if (state && breakpointEngine.matches(state.url, state.method, 'request')) {
      const pauseData = {
        url: state.url,
        method: state.method,
        headers: state.rawRequestHeaders,
        body: state.requestBody,
      }
      const pendingData = data

      breakpointEngine
        .pause(state.id, 'request', pauseData)
        .then((action) => {
          if (action.type === 'abort') {
            const endTime = Date.now()
            const duration = endTime - state.startTime
            try {
              onRequest({
                id: state.id,
                url: state.url,
                method: state.method,
                status: null,
                startTime: state.startTime,
                endTime,
                duration,
                requestHeaders: state.requestHeaders,
                responseHeaders: {},
                requestBodySize: state.requestBodySize,
                responseBodySize: 0,
                requestBody: state.requestBody,
                responseBody: null,
                error: 'Aborted by Hakka',
                source: 'xhr',
                initiator: state.initiator,
                // An aborted request still belongs to its trace group — headers were already injected before the pause.
                correlationId: state.correlationId,
              })
            } catch {
              /* never break callers */
            }
            return
          }

          // Resume — apply edits to url/method if provided
          const e = action.edits as
            | Partial<{ url: string; method: string; headers: Record<string, string>; body: string | null }>
            | undefined
          if (e?.url != null && e.url !== state.url) {
            state.url = e.url
            // Re-open with the new URL so the real request goes to the edited target
            savedOpen.call(xhr, state.method, state.url)
          }
          if (e?.method != null) {
            state.method = e.method.toUpperCase() as HttpMethod
            savedOpen.call(xhr, state.method, state.url)
          }
          if (e?.headers != null) {
            // Replay captured request headers on the re-opened connection
            for (const [k, v] of Object.entries(e.headers)) {
              savedSetHeader.call(xhr, k, v)
              state.requestHeaders[k] = isSensitiveHeader(k, redactHeaders) ? '[REDACTED]' : v
            }
          }

          state.startTime = Date.now() // reset timing after the pause
          savedSend.call(xhr, e?.body !== undefined ? e.body : pendingData)
        })
        .catch(() => {
          // Fail-open: if the breakpoint engine rejects, the real request must still go out.
          try {
            savedSend.call(xhr, pendingData)
          } catch {
            /* never break callers */
          }
        })
      return
    }

    // Latency simulation (request-phase only for XHR).
    const latencyMs = ThrottleEngine.isActive ? (ThrottleEngine.current.latencyMs ?? 0) : 0
    if (latencyMs > 0) {
      setTimeout(() => {
        if (state) state.startTime = Date.now()
        // eslint-disable-next-line prefer-rest-params
        savedSend.apply(xhr, [data] as unknown as Parameters<typeof savedSend>)
      }, latencyMs)
      return
    }

    // eslint-disable-next-line prefer-rest-params
    savedSend.apply(this, arguments as unknown as Parameters<typeof savedSend>)
  }

  return () => disableXHRInterceptor()
}

function disableXHRInterceptor(): void {
  if (origOpen) XMLHttpRequest.prototype.open = origOpen
  if (origSend) XMLHttpRequest.prototype.send = origSend
  if (origSetHeader) XMLHttpRequest.prototype.setRequestHeader = origSetHeader
  origOpen = null
  origSend = null
  origSetHeader = null
}

/**
 * Config `createXHRCaptureSource` forwards unchanged to `enableXHRInterceptor` — the same two
 * knobs a host already supplies via `HakkaFacade`/`hakka-browser`'s own config
 * (`config.maxBodySize`, `config.redactHeaders`); this wrapper invents no new defaults.
 */
export interface XHRCaptureSourceOptions {
  readonly maxBodySize: number
  readonly redactHeaders: string[]
}

/**
 * `CaptureSource` (ADR 0006) wrapper around `enableXHRInterceptor()`. `runtime` is a fixed
 * `'client'` literal — `enableXHRInterceptor` patches `XMLHttpRequest.prototype`, a browser-only
 * global with no server/edge variant (ADR 0006 row 2, "Clean. Same shape as fetch.").
 *
 * Unlike a monkey-patched constructor (websocket.ts), XHR patches three PROTOTYPE methods
 * shared by every instance, live and already-open ones included — `stop()` restores them
 * immediately. But `open()`/`send()` register listeners (`readystatechange`, `loadend`) and, on
 * the offline/blocked/mocked short-circuit paths, a bare `setTimeout` — any of which can still
 * fire and reach `onRequest` after `stop()` for a request that was already in flight when it was
 * called. The local `stopped` flag below is what actually blocks delivery to `ctx.ingest` for
 * that case, mirroring websocket.ts's and spanProcessor.ts's `stopped` checks.
 */
export function createXHRCaptureSource(options: XHRCaptureSourceOptions): CaptureSource {
  let disposer: (() => void) | null = null
  const cycle = createCycleGuard()

  return {
    id: 'hakka.xhr',
    runtime: 'client',
    transport: 'xhr',
    correlation: 'originates',
    start(ctx: CaptureSourceContext) {
      if (disposer) return // already started — idempotent per the CaptureSource contract
      const isCurrent = cycle.begin()
      disposer = enableXHRInterceptor(
        (request) => {
          // A loadend/error/mock/breakpoint callback resolving after stop() must not reach ctx.ingest.
          if (!isCurrent()) return
          ctx.ingest(request)
        },
        options.maxBodySize,
        options.redactHeaders,
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
