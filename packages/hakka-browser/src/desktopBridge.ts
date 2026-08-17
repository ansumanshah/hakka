/**
 * desktopBridge — stream captured requests to the Hakka desktop app over a
 * WebSocket.
 *
 * The socket itself, the replay-on-connect, the exponential-backoff reconnect,
 * and the per-request `JSON.stringify` all live in the store thread (see
 * `worker/storeEngine.ts`), so serializing a large body never blocks the host
 * page. This module is a thin main-thread facade over that, preserving the
 * public `connect`/`disconnect`/status API the Settings tab uses.
 */
import type { ConnectionStatus } from 'hakka-core'

import { hasStore, store } from './worker'

export const DEFAULT_DESKTOP_URL = 'ws://localhost:8989'

/**
 * Connect to the Hakka desktop app.
 * Safe to call multiple times — reconnects if the URL changed, no-op otherwise.
 *
 * @param url WebSocket URL (default `ws://localhost:8989`)
 */
export function connect(url?: string): void {
  store().bridgeConnect(url ?? DEFAULT_DESKTOP_URL)
}

/** Disconnect from the desktop app and stop auto-reconnect. */
export function disconnect(): void {
  if (hasStore()) store().bridgeDisconnect()
}

/** Current connection status. */
export function getBridgeStatus(): ConnectionStatus {
  return hasStore() ? store().getBridgeStatus() : { state: 'disconnected' }
}

/** Subscribe to connection status changes. Returns an unsubscribe function. */
export function onBridgeStatus(listener: (status: ConnectionStatus) => void): () => void {
  return store().onBridgeStatus(listener)
}

/** True when the bridge is connected or connecting. */
export function isBridgeActive(): boolean {
  const state = getBridgeStatus().state
  return state === 'connected' || state === 'connecting'
}
