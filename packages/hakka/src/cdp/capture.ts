/**
 * Transport-facing wrapper around `createCdpMapper` — the only file in this
 * package that calls `transport.send`/`.on`/`.off`. Accepts any object
 * shaped like `CdpTransport` (see `types.ts`) — Playwright's `CDPSession`,
 * Puppeteer's `CDPSession`, or a raw `ws` client — with no `import` of
 * either library, dev or runtime.
 */
import type { NetworkRequest, RequestRuntime } from 'hakka-core'

import { createCdpMapper, DEFAULT_MAX_BODY_SIZE } from './mapper'
import type { CdpGetResponseBodyResult, CdpTransport } from './types'

export interface CreateCdpCaptureOptions {
  transport: CdpTransport
  onRequest: (req: NetworkRequest) => void
  /** Default: true. Fetches the decoded response body via `Network.getResponseBody` at `loadingFinished`. */
  captureBody?: boolean
  /** Default: 100 KB. See `mapper.ts`'s `DEFAULT_MAX_BODY_SIZE`. */
  maxBodySize?: number
  /** Header names/globs to redact (case-insensitive, glob-capable). Defaults to `hakka-core`'s `DEFAULT_SENSITIVE_HEADERS`. */
  redactHeaders?: string[]
  /** Tag applied to every emitted record. Default: `'client'`. */
  runtime?: RequestRuntime
}

export interface CdpCapture {
  /** Enables `Network` domain events on the transport and starts listening. Idempotent. */
  start(): Promise<void>
  /** Detaches listeners and disables `Network` domain events. Idempotent, never throws (a transport that's already closed is a normal way for `stop()` to be called). */
  stop(): Promise<void>
}

/** Every `Network.*` event this package understands — kept as a single list so `start`/`stop` register/unregister the exact same set. */
const NETWORK_EVENTS = [
  'Network.requestWillBeSent',
  'Network.requestWillBeSentExtraInfo',
  'Network.responseReceived',
  'Network.responseReceivedExtraInfo',
  'Network.dataReceived',
  'Network.loadingFinished',
  'Network.loadingFailed',
] as const

export function createCdpCapture(options: CreateCdpCaptureOptions): CdpCapture {
  const { transport } = options
  let started = false
  // `fetchResponseBody`'s async round-trip can still be in flight when `stop()`
  // resolves, so every emission is routed through this guard rather than relying on unsubscribing alone.
  let stopped = false

  const mapper = createCdpMapper({
    onRequest: (req) => {
      if (stopped) return
      options.onRequest(req)
    },
    captureBody: options.captureBody ?? true,
    maxBodySize: options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
    redactHeaders: options.redactHeaders,
    runtime: options.runtime ?? 'client',
    fetchResponseBody: async (requestId: string) => {
      try {
        return await transport.send<CdpGetResponseBodyResult>('Network.getResponseBody', { requestId })
      } catch {
        return null
      }
    },
  })

  const listeners = new Map<string, (params: unknown) => void>()
  for (const method of NETWORK_EVENTS) {
    listeners.set(method, (params: unknown) => {
      void mapper.handleEvent(method, params)
    })
  }

  return {
    async start() {
      if (started) return
      started = true
      stopped = false
      for (const [method, listener] of listeners) transport.on(method, listener)
      await transport.send('Network.enable', {})
    },
    async stop() {
      if (!started) return
      started = false
      stopped = true
      if (transport.off) {
        for (const [method, listener] of listeners) transport.off(method, listener)
      }
      try {
        await transport.send('Network.disable', {})
      } catch {
        // Transport may already be closed/detached — stop() must not throw.
      }
    },
  }
}
