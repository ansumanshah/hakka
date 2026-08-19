/**
 * hakka-cdp — Chrome DevTools Protocol Network-domain capture for Hakka.
 * Maps CDP `Network.*` events to canonical Hakka `NetworkRequest` records
 * over any transport implementing `CdpTransport` (Playwright's `CDPSession`,
 * Puppeteer's `CDPSession`, or a raw WebSocket client) — no hard dependency
 * on either browser-automation library.
 */
export { createCdpCapture } from './capture'
// `CaptureSource` wrapper around the capture above (ADR 0006).
export { createCdpCaptureSource } from './capture'
export type { CreateCdpCaptureSourceOptions } from './capture'
export type { CreateCdpCaptureOptions, CdpCapture } from './capture'

export { createCdpMapper, DEFAULT_MAX_BODY_SIZE } from './mapper'
export type { CdpMapper, CdpMapperOptions } from './mapper'

export { bridge, createCdpBridgeClient, DEFAULT_BRIDGE_URL } from './bridgeClient'
export type { CdpBridgeClient, CdpBridgeClientOptions } from './bridgeClient'

export { runCdpAttach } from './attach'
export type { CdpAttachOptions } from './attach'

export type {
  CdpTransport,
  CdpHeaders,
  CdpResourceType,
  CdpRequest,
  CdpResponse,
  CdpResourceTiming,
  CdpInitiator,
  CdpRequestWillBeSentParams,
  CdpRequestWillBeSentExtraInfoParams,
  CdpResponseReceivedParams,
  CdpResponseReceivedExtraInfoParams,
  CdpDataReceivedParams,
  CdpLoadingFinishedParams,
  CdpLoadingFailedParams,
  CdpGetResponseBodyResult,
} from './types'

export type { NetworkRequest, RequestRuntime } from 'hakka-core'

export const HAKKA_CDP_VERSION = '0.1.0'
