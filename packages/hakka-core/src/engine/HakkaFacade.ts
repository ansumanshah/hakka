import { enableFetchInterceptor } from '../capture/fetch'
import { enableWebSocketInterceptor } from '../capture/websocket'
import { enableXHRInterceptor } from '../capture/xhr'
import { logStore } from '../log/LogStore'
import { networkRequestToRecord, type RecordSink } from '../model/contract'
import type { NetworkRequest, HakkaConfig, RequestListener, StorageSnapshot } from '../model/types'
import { DEFAULT_CONFIG } from '../model/types'
import { RetentionPolicy } from '../storage/RetentionPolicy'
import { RingBuffer } from '../storage/RingBuffer'
import type { StorageAdapter } from '../storage/StorageAdapter'
import { hostMatchesList, matchesIgnoredPattern } from '../utils/hostFilter'
import { breakpointEngine } from './BreakpointEngine'
import { findDuplicateRequest, mergeDuplicateRequest } from './dedupeRules'
import { mockEngine } from './MockEngine'
import {
  isPromiseLike,
  logMissingNative,
  NATIVE_CONSOLE_EVENT,
  NATIVE_MODULE_NAMES,
  NATIVE_REQUEST_EVENT,
  NATIVE_STORAGE_EVENT,
  noopTraceHandle,
  parseConsoleBatch,
  parseRequestBatch,
  parseStorageSnapshot,
  wrapNativeTraceHandle,
  type NativeCaptureAdapter,
  type NativeEventEmitterLike,
  type NativeHakkaModule,
  type TraceHandle,
} from './nativeProtocol'
import { PersistScheduler } from './persistScheduler'
import { PluginRegistry } from './pluginRegistry'
import type { HakkaBodyRenderer, HakkaContextMenuItem, HakkaPanel, HakkaPlugin, HakkaPluginContext } from './plugins'

// Re-exported so `index.ts` and direct importers keep the type names that
// used to live in this file — the native wire-protocol types now live in
// `nativeProtocol.ts`.
export type { NativeCaptureAdapter, NativeEventEmitterLike, NativeHakkaModule }

type Teardown = () => void

declare const __DEV__: boolean

function maxAgeSecondsToMs(maxAgeSeconds: number | undefined): number | null {
  if (maxAgeSeconds === undefined || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    return null
  }
  return maxAgeSeconds * 1000
}

type HakkaConfigWithExtras = HakkaConfig & {
  sinks?: readonly RecordSink[]
}

class HakkaImpl {
  private config: HakkaConfigWithExtras & typeof DEFAULT_CONFIG = {
    ...DEFAULT_CONFIG,
    mode: 'auto',
    sinks: [],
  }
  private logs = new RingBuffer(this.config.maxRequests, this.config.maxBufferBytes)
  private retention = new RetentionPolicy(maxAgeSecondsToMs(this.config.maxAge))
  private listeners: Set<RequestListener> = new Set()
  private storageListeners: Set<(snapshot: StorageSnapshot) => void> = new Set()
  private teardowns: Teardown[] = []
  private native: NativeHakkaModule | null = null
  private nativeAdapter: NativeCaptureAdapter | null = null
  private nativeListenerCount = 0
  private nativeSubscriptionCleanup: Teardown | null = null
  private nativeCaptureGeneration = 0
  private running = false
  private activeSinks: readonly RecordSink[] = []
  private paused = false
  private pausedBuffer: NetworkRequest[] = []
  private readonly pluginRegistry = new PluginRegistry()
  private readonly persistScheduler = new PersistScheduler()

  /** Register the native adapter (called once at platform bootstrap). */
  registerNativeAdapter(adapter: NativeCaptureAdapter | null): void {
    this.nativeAdapter = adapter
  }

  /** Registers a plugin. If capture is already running, sets it up immediately. */
  use(plugin: HakkaPlugin): void {
    this.pluginRegistry.use(plugin, this.running, () => this.buildPluginContext())
  }

  /** All UI panels contributed by registered plugins, sorted by `order`. */
  getPanels(): HakkaPanel[] {
    return this.pluginRegistry.getPanels()
  }

  /** All body renderers contributed by registered plugins. */
  getBodyRenderers(): HakkaBodyRenderer[] {
    return this.pluginRegistry.getBodyRenderers()
  }

  /** All context-menu items contributed by registered plugins. */
  getContextMenuItems(): HakkaContextMenuItem[] {
    return this.pluginRegistry.getContextMenuItems()
  }

  /** Sets (or, with `null`, clears) the storage adapter used to persist captured requests. */
  setStorageAdapter(adapter: StorageAdapter | null): void {
    this.persistScheduler.setAdapter(adapter)
  }

  private buildPluginContext(): HakkaPluginContext {
    return {
      ingest: (request) => this.ingest(request),
      update: (partial) => this.update(partial),
      onRequest: (listener) => this.onRequest(listener),
      getLogs: () => this.getLogs(),
      registerSink: (sink) => {
        this.activeSinks = [...this.activeSinks, sink]
        return () => {
          this.activeSinks = this.activeSinks.filter((s) => s !== sink)
        }
      },
    }
  }

  /** Pause capture. Requests that arrive while paused are buffered, not dropped. */
  pause(): void {
    this.paused = true
    this.nativeAdapter?.pause?.()
  }

  /** Resume capture and flush anything buffered while paused, in order. */
  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.nativeAdapter?.resume?.()
    const buffered = this.pausedBuffer
    this.pausedBuffer = []
    for (const request of buffered) this.ingestRequest(request)
  }

  get isPaused(): boolean {
    return this.paused
  }

  configure(config: HakkaConfigWithExtras): void {
    this.config = { ...this.config, ...config }

    if (config.maxRequests !== undefined) {
      const previous = this.logs.getAll()
      // Also picks up a just-updated byte ceiling, so changing both in one call rebuilds once.
      this.logs = new RingBuffer(this.config.maxRequests, this.config.maxBufferBytes)
      for (const request of previous.reverse()) {
        this.logs.add(request)
      }
      this.retention.apply(this.logs)
    } else if (config.maxBufferBytes !== undefined) {
      // RingBuffer wasn't rebuilt above, so push the new ceiling into the live instance.
      this.logs.setMaxBufferBytes(this.config.maxBufferBytes)
    }

    if (config.maxAge !== undefined) {
      this.retention = new RetentionPolicy(maxAgeSecondsToMs(this.config.maxAge))
      this.retention.apply(this.logs)
    }

    if (this.native) {
      try {
        if (this.config.redactHeaders) {
          this.native.setSensitiveHeaders(this.config.redactHeaders)
        }
        if (this.config.ignoreHosts) {
          this.native.setIgnoredHosts(this.config.ignoreHosts)
        }
        if (this.config.ignorePatterns) {
          this.native.setIgnoredPatterns(this.config.ignorePatterns)
        }
      } catch {
        // ignore: native module is optional
      }
    }

    if (config.sinks !== undefined) {
      this.sinks(config.sinks)
    }

    if (config.enabled === false && this.running) {
      this.stop()
    }
  }

  start(config?: HakkaConfigWithExtras): void {
    if (config) this.configure(config)
    if (this.config.enabled === false) return
    if (this.running) return

    const mode = this.config.mode ?? 'auto'
    // 'store' mode: run the engine as a pure aggregator fed via ingest()/update().
    // No interceptors installed, but running=true keeps the ingest pipeline live.
    if (mode === 'store') {
      this.running = true
      void this.hydrateFromAdapter()
      this.pluginRegistry.setupAll(() => this.buildPluginContext())
      return
    }
    if (!this.native) this.native = this.nativeAdapter?.getModule() ?? null
    const nativeAvailable = this.native !== null
    const useNative = mode === 'native' || (mode === 'auto' && nativeAvailable)
    const useJs = mode === 'js' || (mode === 'auto' && !nativeAvailable)

    if (mode === 'native' && !this.native) {
      throw new Error(
        `[Hakka] start(mode: "native") requires one of these modules: ${NATIVE_MODULE_NAMES.join(', ')}. ` +
          'TurboModule was not found.',
      )
    }

    this.running = true

    void this.hydrateFromAdapter()

    if (useNative && this.native) {
      mockEngine.syncNativeRules()
      const generation = ++this.nativeCaptureGeneration
      void this.startNativeCapture(this.native, generation)
    }

    if (useJs) {
      this.startJsCapture()
    }

    if (!useNative && !useJs) {
      this.running = false
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[Hakka] No capture mode selected. start() requires config.mode="native" or "js".')
      }
    }

    if (!useNative && useJs) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[Hakka] Native module not found, running JS fallback capture only.')
      }
    }

    if (this.running) {
      this.pluginRegistry.setupAll(() => this.buildPluginContext())
    }
  }

  enableNativeCapture(restart = true): void {
    this.configure({ mode: 'native' })
    if (restart && this.running) {
      this.stop()
      this.start()
    }
  }

  enableJsCapture(restart = true): void {
    this.configure({ mode: 'js' })
    if (restart && this.running) {
      this.stop()
      this.start()
    }
  }

  stop(): void {
    this.nativeCaptureGeneration += 1
    // Persist the final coalesced batch before tearing capture down.
    this.persistScheduler.flushPersist(this.logs)

    for (const teardown of this.teardowns) teardown()
    this.teardowns = []

    this.pluginRegistry.teardownAll()
    // Resolve any request parked in a breakpoint pause — without this, a fetch/xhr paused by a
    // request/response breakpoint would hang forever once its interceptor is torn down above.
    breakpointEngine.resumeAll()
    // Resume the native engine before tearing down, or the next start() silently records nothing.
    if (this.paused) this.nativeAdapter?.resume?.()
    this.paused = false
    this.pausedBuffer = []

    if (this.nativeSubscriptionCleanup) {
      this.nativeSubscriptionCleanup()
      this.nativeSubscriptionCleanup = null
    }

    if (this.nativeListenerCount > 0 && this.native && this.native.removeListeners) {
      this.native.removeListeners(this.nativeListenerCount)
    }
    this.nativeListenerCount = 0
    this.native = null
    this.running = false
  }

  startTrace(name: string): TraceHandle {
    if (!this.native) {
      this.native = this.nativeAdapter?.getModule() ?? null
    }
    if (!this.native?.startTrace) {
      return noopTraceHandle('native module not installed')
    }
    try {
      const traceId = this.native.startTrace(name)
      if (isPromiseLike(traceId)) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[Hakka] startTrace returned async id; JS wrapper will use no-op handle for now.')
        }
        return noopTraceHandle('native startTrace returned async id')
      }

      if (traceId) {
        return wrapNativeTraceHandle(this.native, traceId)
      }
    } catch {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[Hakka] startTrace failed on native module, using JS fallback')
      }
    }

    return noopTraceHandle('native startTrace did not return a trace id')
  }

  /** Returns `true` when the native module handled the request, `false` on any no-op fallback. */
  show(options?: { as?: 'bubble' | 'sheet' | 'fullscreen' }): boolean {
    const mode = options?.as ?? 'bubble'
    if (!this.native) {
      this.native = this.nativeAdapter?.getModule() ?? null
    }
    if (!this.native?.showUI) {
      logMissingNative('show')
      return false
    }
    try {
      // The TurboModule can exist without the optional native UI package linked,
      // in which case showUI would silently no-op — probe first to report the truth.
      if (this.native.isUIAvailable?.() === false) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn(
            '[Hakka] show() had no effect — the optional native UI package ' +
              '(HakkaUI on iOS, hakka-ui on Android) is not linked into this app target.',
          )
        }
        return false
      }
      this.native.showUI(mode)
      return true
    } catch {
      // no-op: keep UI wrapper resilient
      return false
    }
  }

  hide(): void {
    if (!this.native) {
      this.native = this.nativeAdapter?.getModule() ?? null
    }
    if (!this.native) {
      logMissingNative('hide')
      return
    }
    if (this.native.hideUI) {
      this.native.hideUI()
      return
    }
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Hakka] hide() is not implemented in this native module version')
    }
  }

  clear(): void {
    this.clearLogs()
  }

  clearLogs(): void {
    this.logs.clear()
    // Drop anything buffered while paused, so cleared logs don't reappear on resume.
    this.pausedBuffer = []
    this.native?.clearLogs()
    // Drop any pending coalesced write — the buffer is now empty and clearAdapter wipes storage.
    this.persistScheduler.cancelPendingPersist()
    this.persistScheduler.clearAdapter()
  }

  getSnapshot(): Promise<NetworkRequest[]> {
    if (!this.native) {
      this.native = this.nativeAdapter?.getModule() ?? null
    }
    if (!this.native?.getSnapshot) {
      logMissingNative('getSnapshot')
      return Promise.resolve(this.logs.getAll())
    }

    try {
      const snapshot = this.native.getSnapshot()
      return Promise.resolve(snapshot)
        .then((result) => {
          const parsed = parseRequestBatch(result)
          return parsed.length > 0 ? parsed : this.logs.getAll()
        })
        .catch((error) => {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[Hakka] getSnapshot failed, using fallback cache.', error)
          }
          return this.logs.getAll()
        })
    } catch {
      return Promise.resolve(this.logs.getAll())
    }
  }

  getHealthReport(): Promise<unknown> {
    if (!this.native) {
      this.native = this.nativeAdapter?.getModule() ?? null
    }
    if (!this.native?.getHealthReport) {
      logMissingNative('getHealthReport')
      return Promise.resolve(undefined)
    }

    try {
      return Promise.resolve(this.native.getHealthReport()).catch((error) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[Hakka] getHealthReport failed.', error)
        }
        return undefined
      }) as Promise<unknown>
    } catch {
      return Promise.resolve(undefined)
    }
  }

  setUserId(userId: string | null): void {
    if (!this.native) {
      this.native = this.nativeAdapter?.getModule() ?? null
    }
    if (!this.native?.setUserId) {
      logMissingNative('setUserId')
      return
    }
    try {
      this.native.setUserId(userId)
    } catch {
      // no-op fallback: keep SDK alive when native module is incomplete
    }
  }

  setTag(key: string, value: string): void {
    if (!this.native) {
      this.native = this.nativeAdapter?.getModule() ?? null
    }
    if (!this.native?.setTag) {
      logMissingNative('setTag')
      return
    }
    try {
      this.native.setTag(key, value)
    } catch {
      // no-op
    }
  }

  addBreadcrumb(name: string, attributes?: { [key: string]: string }): void {
    if (!this.native) {
      this.native = this.nativeAdapter?.getModule() ?? null
    }
    if (!this.native?.addBreadcrumb) {
      logMissingNative('addBreadcrumb')
      return
    }
    try {
      this.native.addBreadcrumb(name, attributes)
    } catch {
      // no-op
    }
  }

  sinks(sinks: readonly RecordSink[] = []): void {
    this.activeSinks = sinks
  }

  onRequest(listener: RequestListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribe(listener: (request: NetworkRequest) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Subscribes to native device-storage snapshots (`NATIVE_STORAGE_EVENT`) — used by
   * `hakka-react-native`'s `HakkaBridge` to forward each one to `sendStorage`. Unlike
   * `onRequest`, there is no live push from native for this record kind: a snapshot only
   * arrives after calling `requestNativeStorageSnapshots()`.
   */
  onNativeStorage(listener: (snapshot: StorageSnapshot) => void): () => void {
    this.storageListeners.add(listener)
    return () => this.storageListeners.delete(listener)
  }

  /**
   * Asks the native module for a fresh on-demand storage snapshot (Android:
   * SharedPreferences, relayed via `NATIVE_STORAGE_EVENT` to any `onNativeStorage`
   * listener). No-op when no native module is active or it doesn't support the method
   * (older native binaries). Mirrors the JS bridge's own connect-time AsyncStorage/MMKV
   * publish — call this at the same point.
   */
  requestNativeStorageSnapshots(): void {
    this.native?.publishStorageSnapshots?.()
  }

  private dispatchNativeStorage(snapshot: StorageSnapshot): void {
    for (const listener of this.storageListeners) {
      listener(snapshot)
    }
  }

  getLogs(): NetworkRequest[] {
    return this.logs.getAll()
  }

  getLog(id: string): NetworkRequest | undefined {
    return this.logs.get(id)
  }

  /** Return all captured logs for a given URL, newest-first. */
  getLogsByUrl(url: string): NetworkRequest[] {
    return this.logs.getByUrl(url)
  }

  /**
   * Pushes a request from an external capture source into the store, through
   * the same dedup/retention/dispatch path as the built-in interceptors —
   * a request sharing an existing id (or a recent matching url) is merged, not duplicated.
   */
  ingest(request: NetworkRequest): void {
    this.ingestRequest(request)
  }

  /** Shallow-merges a partial update into an existing log by id and re-dispatches; false if no log with that id exists. */
  update(partial: Partial<NetworkRequest> & { id: string }): boolean {
    const existing = this.logs.get(partial.id)
    if (!existing) return false
    const merged: NetworkRequest = {
      ...existing,
      ...partial,
      timing: partial.timing ? { ...existing.timing, ...partial.timing } : existing.timing,
    }
    if (this.logs.update(merged)) {
      this.applyRetention()
      // Don't dispatch a record that retention just evicted (mirrors ingestRequest).
      if (this.logs.get(merged.id)) {
        this.dispatchToListeners(merged)
      }
      return true
    }
    return false
  }

  getLogCount(): number {
    return this.logs.size
  }

  get isActive(): boolean {
    return this.running
  }

  getConfig(): HakkaConfig {
    return { ...this.config }
  }

  private startJsCapture(): void {
    const listener: RequestListener = (request: NetworkRequest) => {
      this.ingestRequest(request)
    }
    this.teardowns.push(
      enableFetchInterceptor(listener, this.config.maxBodySize, this.config.redactHeaders),
      enableXHRInterceptor(listener, this.config.maxBodySize, this.config.redactHeaders),
      enableWebSocketInterceptor(listener),
    )
  }

  private isCurrentNativeCapture(module: NativeHakkaModule, generation: number): boolean {
    return (
      this.running &&
      this.config.enabled !== false &&
      this.native === module &&
      this.nativeCaptureGeneration === generation
    )
  }

  private async startNativeCapture(module: NativeHakkaModule, generation: number): Promise<void> {
    if (this.native !== module) {
      this.native = module
    }

    if (this.nativeAdapter) {
      const eventEmitter = this.nativeAdapter.createEventEmitter(module)
      const subscription = eventEmitter.addListener(NATIVE_REQUEST_EVENT, (payload: unknown) => {
        if (!this.isCurrentNativeCapture(module, generation)) return
        for (const request of parseRequestBatch(payload)) {
          this.ingestRequest(request)
        }
      })
      // Native structured-log entries feed the same shared `logStore` JS-side `log()` calls
      // do, so both sources render in the Logs tab and reach the desktop bridge for free via
      // `HakkaBridge`'s existing `logStore.subscribe(...)` — no separate console plumbing
      // needed in the RN package itself.
      const consoleSubscription = eventEmitter.addListener(NATIVE_CONSOLE_EVENT, (payload: unknown) => {
        if (!this.isCurrentNativeCapture(module, generation)) return
        for (const entry of parseConsoleBatch(payload)) {
          logStore.add(entry)
        }
      })
      const storageSubscription = eventEmitter.addListener(NATIVE_STORAGE_EVENT, (payload: unknown) => {
        if (!this.isCurrentNativeCapture(module, generation)) return
        const snapshot = parseStorageSnapshot(payload)
        if (snapshot) this.dispatchNativeStorage(snapshot)
      })
      this.nativeSubscriptionCleanup = () => {
        subscription.remove()
        consoleSubscription.remove()
        storageSubscription.remove()
      }
    }

    module.addListener(NATIVE_REQUEST_EVENT)
    module.addListener(NATIVE_CONSOLE_EVENT)
    module.addListener(NATIVE_STORAGE_EVENT)
    this.nativeListenerCount += 3

    try {
      await module.initialize()
    } catch {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[Hakka] initialize() failed. Native capture may be incomplete.')
      }
    }

    if (!this.isCurrentNativeCapture(module, generation)) return

    try {
      const logs = await module.getLogs()
      if (!this.isCurrentNativeCapture(module, generation)) return
      for (const request of parseRequestBatch(logs)) {
        this.ingestRequest(request)
      }
    } catch {
      // no-op: some native versions resolve late or only stream live updates
    }
  }

  private ingestRequest(request: NetworkRequest): void {
    if (!this.running || this.config.enabled === false) {
      return
    }

    if (!request || this.shouldIgnore(request.url)) {
      return
    }

    if (this.paused) {
      this.pausedBuffer.push(request)
      const cap = this.config.maxRequests ?? DEFAULT_CONFIG.maxRequests
      if (this.pausedBuffer.length > cap) this.pausedBuffer.shift()
      return
    }

    const duplicate = findDuplicateRequest(this.logs, request)
    if (duplicate) {
      const merged = mergeDuplicateRequest(duplicate, request)
      if (this.logs.update(merged)) {
        this.applyRetention()
        if (this.logs.get(merged.id)) {
          this.dispatchToListeners(merged)
        }
        this.persistScheduler.schedulePersist(this.logs)
        return
      }
    }

    this.logs.add(request)
    this.applyRetention()
    if (this.logs.get(request.id)) {
      this.dispatchToListeners(request)
    }
    this.persistScheduler.schedulePersist(this.logs)
  }

  /** Apply age-based retention every ingest — cheap now that RingBuffer prunes via a tail-walk. */
  private applyRetention(): void {
    this.retention.apply(this.logs)
  }

  private async hydrateFromAdapter(): Promise<void> {
    await this.persistScheduler.hydrateFromAdapter(
      this.logs,
      this.config.maxRequests,
      () => this.running,
      () => this.retention.apply(this.logs),
    )
  }

  private dispatchToListeners(request: NetworkRequest): void {
    for (const listener of this.listeners) {
      listener(request)
    }
    this.dispatchToSinks(request)
  }

  private dispatchToSinks(request: NetworkRequest): void {
    if (this.activeSinks.length === 0) return

    const record = networkRequestToRecord(request)
    for (const sink of this.activeSinks) {
      try {
        const result = sink(record)
        if (result && typeof (result as Promise<void>).catch === 'function') {
          ;(result as Promise<void>).catch((error) => {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.warn('[Hakka] record sink failed.', error)
            }
          })
        }
      } catch (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[Hakka] record sink failed.', error)
        }
      }
    }
  }

  private shouldIgnore(url: string): boolean {
    // Fast path: skip the URL parse (allocates an object, runs per request) when no filters are set.
    if (this.config.ignoreHosts.length === 0 && this.config.ignorePatterns.length === 0) return false
    // Runs on the raw string, not the parsed URL below: a relative-URL record
    // (older captures, foreign ingest) throws in `new URL()`, which must not
    // let it slip past both filters via the catch below.
    if (matchesIgnoredPattern(url, this.config.ignorePatterns)) return true
    if (this.config.ignoreHosts.length === 0) return false
    try {
      // Base fallback covers relative URLs in browser contexts; elsewhere a
      // relative URL simply has no host to match.
      const base = typeof location !== 'undefined' ? location.href : undefined
      const hostname = new URL(url, base).hostname
      return hostMatchesList(hostname, this.config.ignoreHosts)
    } catch {
      return false
    }
  }
}

export const Hakka = new HakkaImpl()
