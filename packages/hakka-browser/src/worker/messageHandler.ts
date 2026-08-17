/**
 * messageHandler — the store Worker's message loop, extracted from
 * `store.worker.ts` so it can be driven directly in tests (no live Worker / Vite
 * `?worker` transform needed) and so the real dispatch is covered, not a copy.
 *
 * `store.worker.ts` is now a three-line shell that wires this to the worker
 * globalScope; the in-process fallback drives `storeEngine` directly.
 */
import type { MainToWorker, WorkerToMain } from './protocol'
import { storeEngine } from './storeEngine'

export interface StoreMessageHandler {
  handle(msg: MainToWorker): void
  /** Whether the UI is currently subscribed to live request echoes. */
  readonly subscribed: boolean
}

/**
 * Build the message handler. `post` receives every outbound message; `engine`
 * defaults to the module singleton but is injectable for tests.
 */
export function createStoreMessageHandler(
  post: (msg: WorkerToMain) => void,
  engine: typeof storeEngine = storeEngine,
): StoreMessageHandler {
  // Request echoes are only posted while the inspector UI is subscribed — the
  // always-on capture path never pays for a round-trip back to the main thread.
  let subscribed = false

  return {
    get subscribed() {
      return subscribed
    },
    handle(msg: MainToWorker): void {
      switch (msg.type) {
        case 'init':
          engine.init(
            msg.config,
            (req) => {
              if (subscribed) post({ type: 'request', req })
            },
            (status) => post({ type: 'bridgeStatus', status }),
            // Control frames always cross back — the mock/breakpoint/throttle
            // engines they drive live with the interceptors.
            (payload) => post({ type: 'control', payload }),
            (span) => {
              if (subscribed) post({ type: 'span', span })
            },
          )
          break
        case 'ingest':
          engine.ingest(msg.req)
          break
        case 'update':
          engine.update(msg.partial)
          break
        case 'resourceTiming':
          engine.applyResourceTiming(msg.url, msg.entryEpochStart, msg.patch)
          break
        case 'clear':
          engine.clear()
          post({ type: 'cleared' })
          break
        case 'configure':
          engine.configure(msg.config)
          break
        case 'subscribe':
          subscribed = true
          break
        case 'unsubscribe':
          subscribed = false
          break
        case 'snapshot':
          post({ type: 'result', rid: msg.rid, value: engine.snapshot(msg.query) })
          break
        case 'exportHar':
          post({ type: 'result', rid: msg.rid, value: engine.exportHar() })
          break
        case 'exportOtel':
          post({ type: 'result', rid: msg.rid, value: engine.exportOtel(msg.options) })
          break
        case 'exportPostman':
          post({ type: 'result', rid: msg.rid, value: engine.exportPostman() })
          break
        case 'getBody':
          post({ type: 'result', rid: msg.rid, value: engine.getBody(msg.id) })
          break
        case 'getBodies':
          post({ type: 'result', rid: msg.rid, value: engine.getBodies(msg.ids) })
          break
        case 'matchIds':
          post({ type: 'result', rid: msg.rid, value: engine.matchIds(msg.query) })
          break
        case 'bridgeConnect':
          engine.bridgeConnect(msg.url)
          break
        case 'bridgeDisconnect':
          engine.bridgeDisconnect()
          break
        case 'spansForTrace':
          post({ type: 'result', rid: msg.rid, value: engine.getSpansForTrace(msg.traceId) })
          break
      }
    },
  }
}
