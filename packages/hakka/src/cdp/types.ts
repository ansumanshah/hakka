/**
 * Minimal CDP `Network` domain types — just the subset this package maps to
 * Hakka's `NetworkRequest`. Hand-rolled instead of pulling in `devtools-protocol`
 * (~2MB types-only) to avoid growing the dependency graph.
 *
 * Field names/semantics follow the CDP spec:
 * https://chromedevtools.github.io/devtools-protocol/tot/Network/
 */

/** A CDP `Network.Headers` object — already a flat name→value map (no HAR-style splitting needed, unlike raw HTTP header parsing). */
export type CdpHeaders = Record<string, string>

export type CdpResourceType =
  | 'Document'
  | 'Stylesheet'
  | 'Image'
  | 'Media'
  | 'Font'
  | 'Script'
  | 'TextTrack'
  | 'XHR'
  | 'Fetch'
  | 'Prefetch'
  | 'EventSource'
  | 'WebSocket'
  | 'Manifest'
  | 'SignedExchange'
  | 'Ping'
  | 'CSPViolationReport'
  | 'Preflight'
  | 'Other'

export interface CdpRequest {
  url: string
  urlFragment?: string
  method: string
  headers: CdpHeaders
  postData?: string
  hasPostData?: boolean
  initialPriority?: string
  referrerPolicy?: string
  isLinkPreload?: boolean
}

export interface CdpResourceTiming {
  requestTime: number
  proxyStart: number
  proxyEnd: number
  dnsStart: number
  dnsEnd: number
  connectStart: number
  connectEnd: number
  sslStart: number
  sslEnd: number
  sendStart: number
  sendEnd: number
  pushStart: number
  pushEnd: number
  receiveHeadersStart?: number
  receiveHeadersEnd: number
}

export interface CdpResponse {
  url: string
  status: number
  statusText: string
  headers: CdpHeaders
  mimeType: string
  encodedDataLength?: number
  timing?: CdpResourceTiming
  protocol?: string
  remoteIPAddress?: string
  remotePort?: number
  fromDiskCache?: boolean
  fromServiceWorker?: boolean
}

export interface CdpInitiator {
  type: string
  url?: string
  lineNumber?: number
}

export interface CdpRequestWillBeSentParams {
  requestId: string
  loaderId: string
  documentURL?: string
  request: CdpRequest
  /** Monotonic clock, seconds. Comparable within one CDP session; NOT wall-clock. */
  timestamp: number
  /** Wall clock (Unix epoch), seconds. Only reliable at the FIRST hop of a redirect chain. */
  wallTime: number
  initiator?: CdpInitiator
  redirectHasExtraInfo?: boolean
  /** Present when this event reports the redirect response for the PREVIOUS hop of the same `requestId`. */
  redirectResponse?: CdpResponse
  type?: CdpResourceType
  frameId?: string
}

export interface CdpRequestWillBeSentExtraInfoParams {
  requestId: string
  headers: CdpHeaders
}

export interface CdpResponseReceivedParams {
  requestId: string
  loaderId: string
  timestamp: number
  type: CdpResourceType
  response: CdpResponse
  hasExtraInfo?: boolean
  frameId?: string
}

export interface CdpResponseReceivedExtraInfoParams {
  requestId: string
  headers: CdpHeaders
  statusCode?: number
}

export interface CdpDataReceivedParams {
  requestId: string
  timestamp: number
  dataLength: number
  encodedDataLength: number
}

export interface CdpLoadingFinishedParams {
  requestId: string
  timestamp: number
  encodedDataLength: number
}

export interface CdpLoadingFailedParams {
  requestId: string
  timestamp: number
  type: CdpResourceType
  errorText: string
  canceled?: boolean
  blockedReason?: string
}

export interface CdpGetResponseBodyResult {
  body: string
  base64Encoded: boolean
}

/**
 * Transport contract — the smallest shape Playwright's, Puppeteer's, and a
 * raw WebSocket `CDPSession` can all satisfy without an adapter shim.
 * `createCdpCapture` only ever calls these two methods.
 */
export interface CdpTransport {
  /** Send a CDP command and resolve with its result (or reject on a CDP-level error). */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Subscribe to a CDP event (e.g. `'Network.requestWillBeSent'`). */
  on(event: string, listener: (params: unknown) => void): void
  /** Unsubscribe. Optional — transports that don't support it just leak the listener on `stop()`. */
  off?(event: string, listener: (params: unknown) => void): void
}
