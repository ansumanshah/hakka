export interface ProxyHeader {
  name: string
  value: string
}

/** The deliberately small JSONL contract emitted by the bundled mitmproxy addon. */
export interface ProxyFlowEvent {
  type: 'flow'
  id: string
  startedAt: number
  endedAt: number
  method: string
  url: string
  requestHeaders: ProxyHeader[]
  responseHeaders?: ProxyHeader[]
  requestBody?: string | null
  responseBody?: string | null
  requestBodySize?: number
  responseBodySize?: number
  /** The addon withheld an oversized body rather than sending an unsafe partial prefix over JSONL. */
  requestBodyTruncated?: boolean
  responseBodyTruncated?: boolean
  status?: number | null
  error?: string | null
  contentType?: string
  httpVersion?: string
  messages?: ProxyWebSocketMessage[]
  wsProtocol?: string
  /** True while a long-lived response is still producing bounded previews. */
  partial?: boolean
}

interface ProxyWebSocketMessage {
  timestamp: number
  direction: 'sent' | 'received'
  data: string | number
  size: number
  binary?: boolean
  /** The sidecar withheld an oversized text frame rather than forwarding a prefix. */
  truncated?: boolean
}

export interface ProxyMapLocalRule {
  /** Regular expression matched against the complete request URL. */
  match: string
  /** Explicit regular file served when `match` applies. */
  file: string
}

export interface ProxyMapRemoteRule {
  /** Regular expression matched against the complete request URL. */
  match: string
  /** Replacement URL/template accepted by mitmproxy's map-remote option. */
  replace: string
}

/** A header operation applied only in the matching mitmproxy lifecycle phase. */
export interface ProxyHeaderRule {
  /** Regular expression matched against the complete request URL. */
  match: string
  phase: 'request' | 'response'
  operation: 'set' | 'remove'
  name: string
  /** Required for `set`; ignored for `remove`. */
  value?: string
}

/** Stops a matching request before it is sent upstream. */
export interface ProxyBlockRule {
  /** Regular expression matched against the complete request URL. */
  match: string
  /** HTTP error status returned by the local proxy. Defaults to 403. */
  status?: number
  /** Small, explicit response body returned to the client. */
  body?: string
}

/** Adds a bounded asynchronous delay in the selected lifecycle phase. */
export interface ProxyDelayRule {
  /** Regular expression matched against the complete request URL. */
  match: string
  phase: 'request' | 'response'
  /** Milliseconds, from 0 through 30,000. */
  delayMs: number
}

export interface ProxyMappingConfig {
  mapLocal?: ProxyMapLocalRule[]
  mapRemote?: ProxyMapRemoteRule[]
  headerRules?: ProxyHeaderRule[]
  blockRules?: ProxyBlockRule[]
  delayRules?: ProxyDelayRule[]
}
