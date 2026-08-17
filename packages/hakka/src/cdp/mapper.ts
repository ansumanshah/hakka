/**
 * Pure CDP `Network.*` event → Hakka `NetworkRequest` mapper. No transport
 * calls here — `handleEvent` takes events one at a time and `fetchResponseBody`
 * is the only side effect, so this is testable with synthetic sequences;
 * `capture.ts` owns the actual transport.
 *
 * Emits via `onRequest` at three points per request — `requestWillBeSent`,
 * `responseReceived`, `loadingFinished`/`loadingFailed` — all sharing one
 * `id`; consumers must dedupe/merge by id, not treat each call as a new record.
 */
import { redactHeaders } from 'hakka-core'
import type { NetworkRequest, NetworkTiming, RequestRuntime, RequestType } from 'hakka-core'

import type {
  CdpDataReceivedParams,
  CdpGetResponseBodyResult,
  CdpHeaders,
  CdpLoadingFailedParams,
  CdpLoadingFinishedParams,
  CdpRequestWillBeSentExtraInfoParams,
  CdpRequestWillBeSentParams,
  CdpResourceTiming,
  CdpResourceType,
  CdpResponse,
  CdpResponseReceivedExtraInfoParams,
  CdpResponseReceivedParams,
} from './types'

/** Matches hakka-core's `DEFAULT_MAX_BODY_SIZE` (100 KB); kept as a local
 * constant since core only exports it for fetch/xhr's own use, and importing
 * it would risk silent drift if core's meaning changes. */
export const DEFAULT_MAX_BODY_SIZE = 100 * 1024

export interface CdpMapperOptions {
  onRequest: (req: NetworkRequest) => void
  /**
   * Called at `loadingFinished` to fetch the decoded body (mapper never calls
   * `Network.getResponseBody` itself — that's `capture.ts`'s job). Returning
   * null/rejecting fails open: record still emits, just without a body.
   */
  fetchResponseBody?: (requestId: string) => Promise<CdpGetResponseBodyResult | null>
  /** Default: true. Set false to skip the `getResponseBody` round-trip entirely (status/headers/timing still captured). */
  captureBody?: boolean
  /** Default: `DEFAULT_MAX_BODY_SIZE` (100 KB). Applied to non-base64 bodies only — base64 (binary) bodies are kept whole since CDP has already decoded them once and re-truncating loses the ability to decode further. */
  maxBodySize?: number
  /** Header names/globs to redact. Defaults to `hakka-core`'s `DEFAULT_SENSITIVE_HEADERS` (via `redactHeaders`'s own default). */
  redactHeaders?: string[]
  /** Tag applied to every emitted record. Default: `'client'` — CDP Network events describe page-driven traffic, same bucket as browser fetch/XHR captures. */
  runtime?: RequestRuntime
}

export interface CdpMapper {
  /** Feed one CDP `Network.*` event. Returns a promise that settles once any body fetch it triggered has settled — awaiting it is optional (fire-and-forget is fine for live capture) but useful in tests. */
  handleEvent(method: string, params: unknown): Promise<void> | void
}

/** Internal bookkeeping for one in-flight (or just-finalized) hop of a request. Not exported — `NetworkRequest` is the only public shape. */
interface PendingEntry {
  /** Public id: the CDP `requestId` for the first hop, `${requestId}#${hop}` for redirect hops. */
  id: string
  cdpRequestId: string
  hop: number
  url: string
  method: string
  requestHeaders: CdpHeaders
  requestBody: string | null
  requestBodySize: number
  /** Epoch ms, derived from this hop's own `wallTime`/`timestamp` pair — see `epochMsFor`. */
  startTimeMs: number
  /** The CDP monotonic `timestamp` captured alongside `startTimeMs`, used as the conversion anchor for every later event on this hop. */
  anchorTimestamp: number
  /** First hop's startTimeMs/anchorTimestamp, carried through every redirect hop — wallTime is only reliable at hop 1, so later hops anchor off this instead of their own. */
  firstHopStartTimeMs: number
  firstHopTimestamp: number
  resourceType: CdpResourceType | undefined
  status: number | null | undefined
  responseHeaders: CdpHeaders | undefined
  contentType: string | undefined
  networkProtocol: string | undefined
  timing: NetworkTiming | undefined
  /** CDP timestamp at `responseReceived`, used to derive `downloadMs` at finalize. */
  responseTimestamp: number | undefined
  encodedDataLength: number | undefined
  dataReceivedBytes: number
  redirectChain: string[]
  redirectUrls: string[]
  redirectCount: number
  error: string | null
}

function mapResourceType(type: CdpResourceType | undefined): RequestType {
  switch (type) {
    case 'XHR':
      return 'xhr'
    case 'Fetch':
      return 'fetch'
    case 'WebSocket':
      return 'websocket'
    default:
      return 'native'
  }
}

/** Merge two header maps — `extra` wins on key collisions (it reflects the actual wire headers CDP's `*ExtraInfo` events report, which can be more complete/accurate than the normalized `request.headers`/`response.headers`). */
function mergeHeaders(base: CdpHeaders | undefined, extra: CdpHeaders | undefined): CdpHeaders {
  if (!extra) return base ?? {}
  return { ...base, ...extra }
}

/**
 * Map CDP's `Network.ResourceTiming` (`*Start`/`*End` fields are ms offsets
 * from `requestTime`; -1 means the phase didn't occur) to Hakka's flat
 * `NetworkTiming`. `downloadMs`/`total` are filled in later at finalize —
 * CDP's timing object only reports header-received, never download duration.
 */
function mapTiming(timing: CdpResourceTiming | undefined): NetworkTiming | undefined {
  if (!timing) return undefined
  const phase = (start: number, end: number): number | undefined => (start >= 0 && end >= 0 ? end - start : undefined)
  const dnsMs = phase(timing.dnsStart, timing.dnsEnd)
  const connectMs = phase(timing.connectStart, timing.connectEnd)
  const tlsMs = phase(timing.sslStart, timing.sslEnd)
  const sendEnd = timing.sendEnd >= 0 ? timing.sendEnd : 0
  const ttfbMs = timing.receiveHeadersEnd >= 0 ? timing.receiveHeadersEnd - sendEnd : undefined
  return { dnsMs, connectMs, tlsMs, ttfbMs }
}

function firstHeaderValue(headers: CdpHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

export function createCdpMapper(options: CdpMapperOptions): CdpMapper {
  const { onRequest } = options
  const captureBody = options.captureBody ?? true
  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE
  const runtime = options.runtime ?? 'client'
  const sensitiveHeaders = options.redactHeaders

  /** CDP requestId → the currently-open hop for that id (the id is reused across a redirect chain, unlike our public per-hop `id`). */
  const active = new Map<string, PendingEntry>()
  /** `requestWillBeSentExtraInfo` that arrived before its matching `requestWillBeSent`. */
  const pendingRequestExtra = new Map<string, CdpHeaders>()
  /** `responseReceivedExtraInfo` that arrived before its matching `responseReceived`. */
  const pendingResponseExtra = new Map<string, CdpHeaders>()
  /**
   * CDP requestId → status of the hop most recently finalized via a redirect
   * rollover. The id is reused across hops, so a late `responseReceivedExtraInfo`
   * for the old hop is disambiguated by matching its `statusCode` here and
   * dropped, instead of contaminating the new hop. Cleared once the new hop
   * gets its own confirmed response.
   */
  const settledRedirectStatus = new Map<string, number>()

  const redact = (headers: CdpHeaders | undefined): Record<string, string> => redactHeaders(headers, sensitiveHeaders)

  /** Epoch ms for a later CDP `timestamp` on the same hop, anchored to that hop's own `requestWillBeSent` wallTime/timestamp pair — a per-hop anchor, more accurate than a single shared page-level one. */
  const epochMsFor = (entry: PendingEntry, timestamp: number): number =>
    entry.startTimeMs + (timestamp - entry.anchorTimestamp) * 1000

  function snapshot(entry: PendingEntry, extra: Partial<NetworkRequest> = {}): NetworkRequest {
    const record: NetworkRequest = {
      id: entry.id,
      url: entry.url,
      method: entry.method,
      status: entry.status ?? null,
      startTime: entry.startTimeMs,
      requestHeaders: redact(entry.requestHeaders),
      requestBody: entry.requestBody,
      requestBodySize: entry.requestBodySize,
      responseBody: null,
      error: entry.error,
      source: mapResourceType(entry.resourceType),
      runtime,
      timestamp: entry.startTimeMs,
      library: 'chrome-devtools-protocol',
      ...extra,
    }
    if (entry.responseHeaders) record.responseHeaders = redact(entry.responseHeaders)
    if (entry.contentType) record.contentType = entry.contentType
    if (entry.networkProtocol) record.networkProtocol = entry.networkProtocol
    if (entry.timing) record.timing = entry.timing
    if (entry.timing?.dnsMs !== undefined) record.dnsMs = entry.timing.dnsMs
    if (entry.timing?.connectMs !== undefined) record.connectMs = entry.timing.connectMs
    if (entry.timing?.tlsMs !== undefined) record.tlsMs = entry.timing.tlsMs
    if (entry.timing?.ttfbMs !== undefined) record.ttfbMs = entry.timing.ttfbMs
    if (entry.timing?.downloadMs !== undefined) record.downloadMs = entry.timing.downloadMs
    if (entry.encodedDataLength !== undefined) record.size = entry.encodedDataLength
    if (entry.redirectCount > 0) {
      record.redirectCount = entry.redirectCount
      record.redirectChain = entry.redirectChain
      record.redirectUrls = entry.redirectUrls
    }
    return record
  }

  function emit(entry: PendingEntry, extra: Partial<NetworkRequest> = {}): void {
    try {
      onRequest(snapshot(entry, extra))
    } catch {
      /* a listener must never break capture */
    }
  }

  function handleRequestWillBeSent(params: CdpRequestWillBeSentParams): void {
    const cdpRequestId = params.requestId
    const prior = active.get(cdpRequestId)

    if (params.redirectResponse && prior) {
      // requestId is reused for the next hop — finalize prior as the redirect
      // response (30x, no body to fetch) before replacing it below.
      applyResponse(prior, params.redirectResponse, params.timestamp)
      active.delete(cdpRequestId)
      finalize(prior, epochMsFor(prior, params.timestamp), null)
      // Recorded so a late `responseReceivedExtraInfo` for this hop can be
      // recognized and dropped — see `handleResponseReceivedExtraInfo`.
      settledRedirectStatus.set(cdpRequestId, params.redirectResponse.status)
    }

    const hop = prior ? prior.hop + 1 : 1
    const id = hop === 1 ? cdpRequestId : `${cdpRequestId}#${hop}`
    const redirectChain = prior ? [...prior.redirectChain, prior.id] : []
    const redirectUrls = prior ? [...prior.redirectUrls, prior.url] : []

    // wallTime is only reliable at hop 1 — later hops anchor off hop 1's wallTime, not their own.
    const firstHopStartTimeMs = prior ? prior.firstHopStartTimeMs : params.wallTime * 1000
    const firstHopTimestamp = prior ? prior.firstHopTimestamp : params.timestamp
    const startTimeMs = firstHopStartTimeMs + (params.timestamp - firstHopTimestamp) * 1000

    const entry: PendingEntry = {
      id,
      cdpRequestId,
      hop,
      url: params.request.url + (params.request.urlFragment ?? ''),
      method: params.request.method,
      requestHeaders: params.request.headers,
      requestBody: params.request.postData ?? null,
      requestBodySize: params.request.postData ? Buffer.byteLength(params.request.postData) : 0,
      startTimeMs,
      anchorTimestamp: params.timestamp,
      firstHopStartTimeMs,
      firstHopTimestamp,
      resourceType: params.type,
      status: undefined,
      responseHeaders: undefined,
      contentType: undefined,
      networkProtocol: undefined,
      timing: undefined,
      responseTimestamp: undefined,
      encodedDataLength: undefined,
      dataReceivedBytes: 0,
      redirectChain,
      redirectUrls,
      redirectCount: redirectChain.length,
      error: null,
    }

    const queuedReqExtra = pendingRequestExtra.get(cdpRequestId)
    if (queuedReqExtra) {
      entry.requestHeaders = mergeHeaders(entry.requestHeaders, queuedReqExtra)
      pendingRequestExtra.delete(cdpRequestId)
    }

    active.set(cdpRequestId, entry)
    emit(entry)
  }

  function handleRequestWillBeSentExtraInfo(params: CdpRequestWillBeSentExtraInfoParams): void {
    const entry = active.get(params.requestId)
    if (!entry) {
      pendingRequestExtra.set(params.requestId, params.headers)
      return
    }
    entry.requestHeaders = mergeHeaders(entry.requestHeaders, params.headers)
    emit(entry)
  }

  function applyResponse(entry: PendingEntry, response: CdpResponse, timestamp: number): void {
    entry.status = response.status
    entry.responseHeaders = response.headers
    entry.contentType = firstHeaderValue(response.headers, 'content-type') ?? response.mimeType
    entry.networkProtocol = response.protocol
    entry.timing = mapTiming(response.timing)
    entry.responseTimestamp = timestamp
    if (response.encodedDataLength !== undefined) entry.encodedDataLength = response.encodedDataLength

    const queuedRespExtra = pendingResponseExtra.get(entry.cdpRequestId)
    if (queuedRespExtra) {
      entry.responseHeaders = mergeHeaders(entry.responseHeaders, queuedRespExtra)
      pendingResponseExtra.delete(entry.cdpRequestId)
    }
    // A genuine response just landed — any earlier redirect marker for this id no longer applies.
    settledRedirectStatus.delete(entry.cdpRequestId)
  }

  function handleResponseReceived(params: CdpResponseReceivedParams): void {
    const entry = active.get(params.requestId)
    if (!entry) return
    entry.resourceType = params.type
    applyResponse(entry, params.response, params.timestamp)
    emit(entry)
  }

  function handleResponseReceivedExtraInfo(params: CdpResponseReceivedExtraInfoParams): void {
    const entry = active.get(params.requestId)
    if (!entry || !entry.responseHeaders) {
      // Ambiguous: genuinely early for the current hop, or a stale straggler
      // for the previous (already-rolled-over) hop. `statusCode` disambiguates
      // the latter — drop it if it matches the redirect this id just finalized as.
      const staleRedirectStatus = settledRedirectStatus.get(params.requestId)
      if (staleRedirectStatus !== undefined && params.statusCode === staleRedirectStatus) {
        return
      }
      // Otherwise stash for `applyResponse` to pick up when `responseReceived` arrives.
      pendingResponseExtra.set(params.requestId, params.headers)
      return
    }
    entry.responseHeaders = mergeHeaders(entry.responseHeaders, params.headers)
    emit(entry)
  }

  function handleDataReceived(params: CdpDataReceivedParams): void {
    const entry = active.get(params.requestId)
    if (!entry) return
    entry.dataReceivedBytes += params.dataLength
    entry.encodedDataLength = (entry.encodedDataLength ?? 0) + params.encodedDataLength
  }

  function finalize(
    entry: PendingEntry,
    endTimeMs: number,
    body: { text: string | null; base64: boolean; truncated: boolean; size?: number } | null,
  ): void {
    // Hop is done — no future event can consume a pending extra-info stash for
    // this id. Clear it now, or it could contaminate a later request reusing the same requestId.
    pendingRequestExtra.delete(entry.cdpRequestId)
    pendingResponseExtra.delete(entry.cdpRequestId)

    if (entry.timing && entry.responseTimestamp !== undefined) {
      const responseEpochMs = epochMsFor(entry, entry.responseTimestamp)
      const downloadMs = endTimeMs - responseEpochMs
      if (downloadMs >= 0) entry.timing = { ...entry.timing, downloadMs }
    }
    const duration = endTimeMs - entry.startTimeMs
    if (entry.timing) entry.timing = { ...entry.timing, total: duration }

    const extra: Partial<NetworkRequest> = { endTime: endTimeMs, duration }
    if (body) {
      extra.responseBody = body.text
      extra.responseBodySize =
        body.size ?? (body.text !== null ? body.text.length : entry.dataReceivedBytes || undefined)
      if (body.base64) extra.encoding = 'base64'
      if (body.truncated) extra.responseBodyTruncated = true
    } else if (entry.dataReceivedBytes > 0) {
      extra.responseBodySize = entry.dataReceivedBytes
    }
    emit(entry, extra)
  }

  async function handleLoadingFinished(params: CdpLoadingFinishedParams): Promise<void> {
    const entry = active.get(params.requestId)
    if (!entry) return
    active.delete(params.requestId)
    if (params.encodedDataLength !== undefined) entry.encodedDataLength = params.encodedDataLength
    const endTimeMs = epochMsFor(entry, params.timestamp)

    let body: { text: string | null; base64: boolean; truncated: boolean; size?: number } | null = null
    if (captureBody && options.fetchResponseBody && entry.status != null) {
      try {
        const result = await options.fetchResponseBody(params.requestId)
        if (result) {
          if (result.base64Encoded) {
            // Never truncate mid-base64 (produces undecodable garbage) — estimate
            // decoded size (base64 inflates ~4/3) and cap on that; over the limit,
            // drop the payload but keep the estimated size and mark it truncated.
            const estimatedDecodedBytes = Math.floor((result.body.length * 3) / 4)
            if (estimatedDecodedBytes > maxBodySize) {
              body = { text: null, base64: true, truncated: true, size: estimatedDecodedBytes }
            } else {
              body = { text: result.body, base64: true, truncated: false }
            }
          } else if (result.body.length > maxBodySize) {
            body = { text: result.body.slice(0, maxBodySize), base64: false, truncated: true }
          } else {
            body = { text: result.body, base64: false, truncated: false }
          }
        }
      } catch {
        // getResponseBody legitimately fails for opaque/cached/discarded responses — fail open.
      }
    }
    finalize(entry, endTimeMs, body)
  }

  function handleLoadingFailed(params: CdpLoadingFailedParams): void {
    const entry = active.get(params.requestId)
    if (!entry) return
    active.delete(params.requestId)
    entry.error = params.canceled ? `${params.errorText} (canceled)` : params.errorText
    entry.resourceType = entry.resourceType ?? params.type
    const endTimeMs = epochMsFor(entry, params.timestamp)
    finalize(entry, endTimeMs, null)
  }

  return {
    handleEvent(method: string, params: unknown): Promise<void> | void {
      switch (method) {
        case 'Network.requestWillBeSent':
          handleRequestWillBeSent(params as CdpRequestWillBeSentParams)
          return
        case 'Network.requestWillBeSentExtraInfo':
          handleRequestWillBeSentExtraInfo(params as CdpRequestWillBeSentExtraInfoParams)
          return
        case 'Network.responseReceived':
          handleResponseReceived(params as CdpResponseReceivedParams)
          return
        case 'Network.responseReceivedExtraInfo':
          handleResponseReceivedExtraInfo(params as CdpResponseReceivedExtraInfoParams)
          return
        case 'Network.dataReceived':
          handleDataReceived(params as CdpDataReceivedParams)
          return
        case 'Network.loadingFinished':
          return handleLoadingFinished(params as CdpLoadingFinishedParams)
        case 'Network.loadingFailed':
          handleLoadingFailed(params as CdpLoadingFailedParams)
          return
        default:
          return
      }
    },
  }
}
