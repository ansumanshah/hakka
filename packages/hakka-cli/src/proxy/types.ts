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

export interface ProxyMappingConfig {
  mapLocal?: ProxyMapLocalRule[]
  mapRemote?: ProxyMapRemoteRule[]
}
