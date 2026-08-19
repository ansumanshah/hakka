/**
 * Transport-facing wrapper around `createCdpMapper` — the only file in this
 * package that calls `transport.send`/`.on`/`.off`. Accepts any object
 * shaped like `CdpTransport` (see `types.ts`) — Playwright's `CDPSession`,
 * Puppeteer's `CDPSession`, or a raw `ws` client — with no `import` of
 * either library, dev or runtime.
 */
import type { CaptureSource, CaptureSourceContext, NetworkRequest, RequestRuntime } from 'hakka-core'
import { createCycleGuard } from 'hakka-core'

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
  // resolves, so every emission is routed through this guard rather than relying on
  // unsubscribing alone. Cycle-scoped, not a boolean: a restart must not un-silence
  // an emission left over from the previous cycle.
  const cycle = createCycleGuard()
  let isCurrent = () => false

  const mapper = createCdpMapper({
    onRequest: (req) => {
      if (!isCurrent()) return
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
      isCurrent = cycle.begin()
      for (const [method, listener] of listeners) transport.on(method, listener)
      await transport.send('Network.enable', {})
    },
    async stop() {
      if (!started) return
      started = false
      cycle.end()
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

/**
 * `CaptureSource` (ADR 0006) wrapper around `createCdpCapture()`. `id`/`transport` follow the
 * `hakka.<name>` / `<name>` convention already established by `createWebSocketCaptureSource`
 * (`hakka-core/src/capture/websocket.ts`) and `createOtelSpanCaptureSource`
 * (`hakka-node/src/spanProcessor.ts`) — ADR 0006's row 9 mapping table shows `hakka.cdp` in its
 * "transport" column, but that's the `id` convention (like rows 3/8's `hakka.websocket`/
 * `hakka.otel-span`); `transport` itself is the shorter free-form label, `'cdp'`.
 *
 * `runtime` is excluded from `CreateCdpCaptureSourceOptions` and pinned to `'client'` on both
 * the identity and the call into `createCdpCapture` — ADR 0006 row 9 names CDP capture as
 * `client` unconditionally ("attaches to a browser page"), unlike row 1's fetch interceptor
 * (reused server-side, tagged after the fact) or row 8's OTel bridge (genuinely runs on either
 * side, so its wrapper takes `runtime` as a parameter). `createCdpCapture` itself still accepts a
 * `runtime` option — dropped here so a caller can't silently mistag every emitted record against
 * what this source's own readonly identity declares.
 *
 * Needs no `stopped` flag of its own, unlike the WebSocket/OTel wrappers: `createCdpCapture()`
 * already tracks `started`/`stopped` per instance above and drops an in-flight
 * `Network.getResponseBody` round-trip that resolves after ITS OWN `stop()` ran — exactly the
 * teardown guarantee ADR 0006 asks for, already built (see this file's own `stopped` guard at
 * `mapper.onRequest`, and `capture.test.ts`'s "a getResponseBody that resolves after stop()
 * emits nothing"). A fresh `CdpCapture` instance is created on every `start()` — never reused
 * across a start→stop→start cycle — only because `onRequest` (and therefore `ctx`) is unknown
 * until `start(ctx)` is called; `CreateCdpCaptureOptions` needs it at construction time.
 */
export type CreateCdpCaptureSourceOptions = Omit<CreateCdpCaptureOptions, 'onRequest' | 'runtime'>

export function createCdpCaptureSource(options: CreateCdpCaptureSourceOptions): CaptureSource {
  let capture: CdpCapture | null = null

  return {
    id: 'hakka.cdp',
    runtime: 'client',
    transport: 'cdp',
    correlation: 'none',
    async start(ctx: CaptureSourceContext) {
      if (capture) return // already started — idempotent per the CaptureSource contract
      const next = createCdpCapture({ ...options, runtime: 'client', onRequest: ctx.ingest })
      try {
        await next.start()
      } catch (err) {
        // `next.start()` rejected after registering listeners (e.g. `Network.enable` failed) —
        // don't adopt it as `capture`, or every later `start()` call would see the guard already
        // set and silently no-op forever. Best-effort tear down the half-started listeners so a
        // retry doesn't double-register on top of the leak.
        await next.stop().catch(() => {})
        throw err
      }
      capture = next
    },
    async stop() {
      if (!capture) return // never started, or already stopped — idempotent per the contract
      const active = capture
      capture = null
      await active.stop()
    },
  }
}
