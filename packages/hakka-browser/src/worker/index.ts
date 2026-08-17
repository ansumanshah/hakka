/**
 * The web package's single store-client instance. Every capture source
 * (interceptors, Resource Timing, sendBeacon), the inspector UI, the console
 * mirror, and the desktop bridge talk to the store through this one handle.
 */
import { createStoreClient, type StoreClient, type StoreClientOptions } from './storeClient'

export type { StoreClient } from './storeClient'
export type { BodyPair } from './protocol'

let _client: StoreClient | null = null

/** Create the store client on first `start()`, applying config. Idempotent. */
export function initStore(opts?: StoreClientOptions): StoreClient {
  _client ??= createStoreClient(opts)
  return _client
}

/** The current store client, lazily creating an unconfigured one if needed. */
export function store(): StoreClient {
  return (_client ??= createStoreClient())
}

/** True once a store client exists. */
export function hasStore(): boolean {
  return _client !== null
}

/** Tear down the store (terminates the Worker / shuts down the in-process engine). */
export function destroyStore(): void {
  _client?.destroy()
  _client = null
}
