/**
 * hakka-node/next/server — the Node-runtime API surface.
 *
 * Everything here (directly or transitively) imports `node:http`/`node:https`,
 * so it must never be bundled for the Edge runtime. `hakka-node/next`'s
 * `register()` reaches this module only through a `NEXT_RUNTIME === 'nodejs'`
 * guard, which Next inlines and dead-code-eliminates from Edge bundles.
 *
 * The interceptors, trace propagation, and bridge client are framework-agnostic
 * and live one directory up in `hakka-node` proper; this module re-exports
 * them under the names `hakka-next` used to publish, so consumers of the old
 * package see no API change after the merge.
 */
export {
  register,
  startServerCapture,
  stopServerCapture,
  type ServerCaptureOptions,
  type ServerCapture,
} from './serverCapture'
export { enableHttpInterceptor, disableHttpInterceptor } from '../httpInterceptor'
export { enableTracePropagation, disableTracePropagation, currentServerTraceId } from '../trace'
export { createBridgeClient, DEFAULT_BRIDGE_URL, type BridgeClient, type BridgeClientOptions } from '../bridgeClient'
export { hakkaSpanProcessor, type HakkaSpanProcessor } from '../spanProcessor'
export type { FrameworkSpan, RequestKind } from 'hakka-core'
