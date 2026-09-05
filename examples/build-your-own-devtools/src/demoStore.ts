/**
 * A minimal, hand-rolled `StoreClient`-shaped store — the injected-store
 * escape hatch ADR 0003 (b) documents for `<hakka-request-list>`'s and
 * `<hakka-stats>`'s `store` property, and `<hakka-filter-bar>`'s optional
 * one. `StoreClient` itself isn't part of `hakka-browser`'s public type
 * exports (only the shape is documented), so this is duck-typed against
 * what those three view-models actually call at runtime — the same shape
 * `packages/hakka-browser/e2e/fixtures/components-standalone.html`'s own
 * `makeStore()` proves sufficient, extended here with a real `matchIds` and
 * wired to REAL interceptors instead of synthetic `ingest()` calls.
 *
 * Why build a store at all instead of importing `hakka-browser` (root) and
 * calling `start()`: `hakka-browser` and `hakka-browser/elements/*` are
 * built as three SEPARATE `vite build --mode X` passes
 * (packages/hakka-browser/vite.config.ts), so each is an independent bundle
 * with its own copy of every module's top-level state — including
 * `worker/index.ts`'s store singleton. `start()` from the root entry
 * populates the ROOT bundle's singleton; the elements bundle's own
 * `sharedStore()` (`ui/elements/shared.ts`) reads a DIFFERENT singleton and
 * never sees it. Two bundles from one npm package still don't share module
 * state, the same way two separate npm packages wouldn't. Building the
 * store directly from `hakka-core`'s own interceptors and injecting it via
 * the documented `store` property sidesteps that split entirely — one
 * object, constructed once here, shared by reference with every element on
 * this page. It also means this whole panel needs no `hakka-browser`
 * overlay code at all: just the capture engine (`hakka-core`) and the six UI
 * elements (`hakka-browser/elements`).
 *
 * `<hakka-request-detail>` has no `store` property to inject at all (ADR
 * 0003 (b) — it only resolves `request-id` against the elements bundle's own
 * shared singleton, or takes a `request` object directly). `panel.ts` /
 * `ReactPanel.tsx` route around that with `getById()` below, handing the
 * full object to `.request` directly — see either file's `hakka:select`
 * handling for why that's the documented, not a workaround.
 */
import { DEFAULT_CONFIG, enableFetchInterceptor, enableXHRInterceptor } from 'hakka-core'
import type { AdvancedQuery, NetworkRequest } from 'hakka-core'

interface DemoBodyPair {
  requestBody: string | null
  responseBody: string | null
}

export interface DemoStore {
  ingest(req: NetworkRequest): void
  subscribe(cb: (req: NetworkRequest) => void): () => void
  getSnapshot(): Promise<NetworkRequest[]>
  matchIds(q: AdvancedQuery): Promise<string[]>
  clear(): void
  configure(): void
  applyResourceTiming(): void
  exportHar(): Promise<string>
  exportOtel(): Promise<string>
  exportPostman(): Promise<string>
  getBody(id: string): Promise<DemoBodyPair | null>
  getBodies(ids: string[]): Promise<Map<string, DemoBodyPair>>
  bridgeConnect(): void
  bridgeDisconnect(): void
  onBridgeStatus(): () => void
  getBridgeStatus(): { state: 'disconnected' }
  usingWorker: boolean
  destroy(): void
  /** Not part of the StoreClient duck-type any element calls — a plain
   * synchronous lookup this page uses for `<hakka-request-detail>`'s
   * `.request` property and the raw-payload JSON tree (see the file doc
   * comment above). */
  getById(id: string): NetworkRequest | undefined
}

function bodyText(req: NetworkRequest): string {
  return `${req.requestBody ?? ''} ${req.responseBody ?? ''}`.toLowerCase()
}

export function createDemoStore(): DemoStore {
  const logs = new Map<string, NetworkRequest>()
  const listeners = new Set<(req: NetworkRequest) => void>()

  function ingest(req: NetworkRequest): void {
    logs.set(req.id, req)
    for (const cb of listeners) cb(req)
  }

  const store: DemoStore = {
    ingest,
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot() {
      return Promise.resolve([...logs.values()])
    },
    // Real, but substring-mode only — the real hakka-browser store also
    // supports wildcard/regex `body:`/`all:` tokens; this covers the common
    // case (plain text typed into the search box) and is upfront about not
    // covering the rest, rather than silently matching wrong.
    matchIds(q: AdvancedQuery) {
      const bodyTokens = (q.tokens ?? []).filter((t) => t.scope === 'body' || t.scope === 'all')
      if (bodyTokens.length === 0) return Promise.resolve([...logs.keys()])
      const ids: string[] = []
      for (const req of logs.values()) {
        const text = bodyText(req)
        const isMatch = bodyTokens.every((t) => {
          const hit = t.mode === 'substring' ? text.includes(t.value.toLowerCase()) : true
          return t.negate ? !hit : hit
        })
        if (isMatch) ids.push(req.id)
      }
      return Promise.resolve(ids)
    },
    clear() {
      logs.clear()
    },
    configure() {},
    applyResourceTiming() {},
    exportHar: () => Promise.resolve('{}'),
    exportOtel: () => Promise.resolve('{}'),
    exportPostman: () => Promise.resolve('{}'),
    getBody(id: string) {
      const req = logs.get(id)
      return Promise.resolve(
        req ? { requestBody: req.requestBody ?? null, responseBody: req.responseBody ?? null } : null,
      )
    },
    getBodies(ids: string[]) {
      const map = new Map<string, DemoBodyPair>()
      for (const id of ids) {
        const req = logs.get(id)
        if (req) map.set(id, { requestBody: req.requestBody ?? null, responseBody: req.responseBody ?? null })
      }
      return Promise.resolve(map)
    },
    bridgeConnect() {},
    bridgeDisconnect() {},
    onBridgeStatus: () => () => {},
    getBridgeStatus: () => ({ state: 'disconnected' as const }),
    usingWorker: false,
    destroy() {
      listeners.clear()
      logs.clear()
    },
    getById(id: string) {
      return logs.get(id)
    },
  }

  // Full request/response bodies, inline, always — there's no Worker
  // boundary in this architecture (that's a `hakka-browser`-only concept:
  // `start()`'s `slimEcho` trims bodies and re-fetches them from the Worker
  // on demand). Fine at this scale; a production store built this way over
  // high request volume would want the same slimming discipline.
  enableFetchInterceptor(ingest, DEFAULT_CONFIG.maxBodySize, DEFAULT_CONFIG.redactHeaders)
  enableXHRInterceptor(ingest, DEFAULT_CONFIG.maxBodySize, DEFAULT_CONFIG.redactHeaders)

  return store
}
