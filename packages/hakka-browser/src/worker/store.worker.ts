/// <reference lib="webworker" />
/**
 * store.worker.ts — the dedicated Worker entry. A thin message loop around the
 * shared `storeEngine`. Built as an inline Worker (`?worker&inline`) so the
 * single-file CDN bundle has no second asset to host.
 */
import { createStoreMessageHandler } from './messageHandler'
import type { MainToWorker } from './protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

const handler = createStoreMessageHandler((msg) => ctx.postMessage(msg))

ctx.onmessage = (ev: MessageEvent<MainToWorker>): void => {
  handler.handle(ev.data)
}
