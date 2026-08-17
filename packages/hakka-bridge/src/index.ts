/**
 * hakka-bridge — the desktop-side receiver for hakka-browser's WebSocket bridge.
 *
 * Run the CLI (`hakka-bridge`) to listen on ws://localhost:8989, or embed the
 * server in a desktop app via `startBridgeServer()`. The `BridgeHub` can be used
 * standalone to buffer and fan out request records over any transport.
 */
export {
  BRIDGE_MDNS_SERVICE_NAME,
  hasNonLoopbackInterface,
  startBridgeAdvertise,
  type BridgeAdvertisement,
  type BridgeAdvertiseOptions,
  type BridgeMdnsPublisher,
  type BridgeMdnsService,
} from './discovery'
export { BridgeHub, type BridgeHubOptions, type IngestResult, type RecordListener } from './BridgeHub'
export {
  parseBridgeMessage,
  type BridgeControlMessage,
  type BridgeMessage,
  type BridgeRequestMessage,
  type BridgeSpanMessage,
} from './protocol'
export { startBridgeServer, DEFAULT_BRIDGE_PORT, type BridgeServer, type BridgeServerOptions } from './server'

export const HAKKA_BRIDGE_VERSION = '0.1.0'
