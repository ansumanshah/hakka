/**
 * hakka-browser — network inspector overlay for browsers.
 *
 * Runs the shared `hakka-core` engine in JS mode, enriches captures with the
 * browser Performance Timeline (real DNS/TLS/connect/TTFB), patches
 * `navigator.sendBeacon`, and renders the framework-agnostic `<hakka-inspector>`
 * Shadow-DOM overlay. Drops into any page — `import` it, or load the IIFE bundle
 * via a single `<script>` tag (`window.Hakka`).
 */
import {
  Hakka,
  DEFAULT_CONFIG,
  breakpointEngine,
  configureBodyRedaction,
  configureTrace,
  enableFetchInterceptor,
  enableXHRInterceptor,
  enableWebSocketInterceptor,
  setStackCapture,
  type HakkaConfig,
  type NetworkRequest,
} from 'hakka-core'

import { enableConsoleCapture } from './capture/console'
import { enableResourceTimingEnrichment } from './capture/resourceTiming'
import { enableSendBeaconCapture } from './capture/sendBeacon'
import { enableConsoleMirror, disableConsoleMirror } from './consoleMirror'
import { connect, disconnect } from './desktopBridge'
import { loadMocks } from './ui/mockPersist'
// Type-only — erased at compile time, so this does NOT pull the Solid UI
// (ui/mount.tsx -> ui/Inspector.tsx) into the eager bundle; fetched lazily
// inside mount() below, same as show().
import type { MountOptions, MountHandle } from './ui/mount'
import { setNumberGates } from './ui/numberGates'
import { loadUiState, saveUiState } from './ui/persist'
import { initStore, destroyStore, store, type BodyPair } from './worker'
import { HAKKA_WORKER_MESSAGE } from './workerCapture'

export interface HakkaWebOptions extends HakkaConfig {
  /**
   * Overlay entry mode. Default: `'launcher'` — a tiny vanilla button is shown
   * and the (heavy) Solid UI loads lazily only when it is tapped. `true` opens
   * the inspector immediately (still lazy-loads the UI). `false` shows nothing;
   * call `show()` yourself (e.g. from a debug menu or keyboard shortcut).
   */
  overlay?: boolean | 'launcher'
  /** Enrich captures with the Performance Timeline (DNS/TLS/connect). Default: true. */
  resourceTiming?: boolean
  /** Capture `navigator.sendBeacon` calls. Default: true. */
  captureBeacons?: boolean
  /** Capture console.log/warn/error/info/debug output. Default: true. */
  console?: boolean
  /**
   * Mirror each captured request to the browser DevTools console using
   * console.groupCollapsed / console.table / %c styling. Default: false.
   */
  logToConsole?: boolean
  /**
   * Propagate a trace id to your server (via the `x-hakka-trace` header) so the
   * overlay links a browser fetch to the server work it triggers (group by
   * "Trace"). Off by default — the header is only sent same-origin, plus any
   * `propagateOrigins`. Requires `hakka-node` on the server. `true` = same-origin.
   */
  trace?: boolean | { propagateOrigins?: string[] }
  /**
   * Thresholds that tint the duration/size columns in request rows: past
   * `warnMs`/`warnBytes` the number renders in the warning tone, past
   * `hotMs`/`hotBytes` in the error tone. Defaults: 300/1000 ms, 25/100 KB.
   */
  gates?: Partial<import('./ui/numberGates').NumberGates>
  /**
   * Capture network traffic from inside Web Workers. When true, requests posted
   * by workers that run the `hakka-browser/worker` shim (`captureInWorker()`) are
   * relayed into the store. Off by default. See concepts/capture-scope.
   */
  captureWorkers?: boolean
  /**
   * Redact values of these keys inside captured JSON request/response bodies
   * (case-insensitive), e.g. `['password', 'token']`. Headers are already
   * redacted via `redactHeaders`. Off by default.
   */
  redactBodyFields?: string[]
  /**
   * Keep captured request/response bodies off the main thread by default —
   * the request list and `getLogs()` carry only sizes; `getBody`/`getBodies`
   * fetch real bytes on demand from the Worker-side store. Default: `true`.
   * Set `false` to restore full bodies everywhere if your own code reads
   * `NetworkRequest.requestBody`/`responseBody` directly.
   */
  slimEcho?: boolean
}

const OVERLAY_TAG = 'hakka-inspector'

let teardowns: Array<() => void> = []
let overlayEl: HTMLElement | null = null
let launcherEl: HTMLButtonElement | null = null
let uiLoading: Promise<void> | null = null
let started = false

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/**
 * Relay records captured inside Web Workers to the main-thread store. Patches
 * `Worker` so each instance forwards `hakka-browser/worker` envelopes to `ingest`;
 * the worker's own messages pass through untouched. Returns a teardown.
 */
function installWorkerRelay(ingest: (req: NetworkRequest) => void): () => void {
  if (typeof Worker === 'undefined') return () => {}
  const OriginalWorker = Worker
  globalThis.Worker = class extends OriginalWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options)
      this.addEventListener('message', (ev: MessageEvent) => {
        const rec = (ev.data as Record<string, unknown> | null | undefined)?.[HAKKA_WORKER_MESSAGE]
        if (rec) ingest(rec as NetworkRequest)
      })
    }
  } as unknown as typeof Worker
  return () => {
    globalThis.Worker = OriginalWorker
  }
}

/**
 * Start capture. Capture is the only eager work — interceptors are transparent
 * passthroughs, so the host page's behavior is unaffected. The UI stays unloaded
 * until the launcher is tapped or `show()` is called. Safe on the server (no-op).
 */
export function start(options: HakkaWebOptions = {}): void {
  if (!isBrowser() || started) return
  started = true
  const {
    overlay = 'launcher',
    resourceTiming = true,
    captureBeacons = true,
    console: captureConsole = true,
    logToConsole,
    trace,
    captureWorkers,
    redactBodyFields,
    slimEcho = true,
    gates,
    ...config
  } = options

  setNumberGates(gates)

  // Opt-in client trace propagation (off by default so the header never leaks).
  if (trace) {
    configureTrace({ enabled: true, propagateOrigins: typeof trace === 'object' ? trace.propagateOrigins : undefined })
  }
  // Opt-in JSON body-field redaction (applied before bodies reach the store).
  // An explicit option wins; otherwise re-apply fields configured via the Settings tab.
  const persistedRedactFields = loadUiState().redactBodyFields
  if (redactBodyFields?.length) configureBodyRedaction(redactBodyFields)
  else if (persistedRedactFields?.length) configureBodyRedaction(persistedRedactFields)

  // Capture store + heavy processing run in a Web Worker (transparent in-process
  // fallback); only the interceptors and Mock/Throttle decisions stay on the
  // main thread, since they must run where fetch/XHR/WebSocket originate.
  const client = initStore({
    config: {
      maxRequests: config.maxRequests,
      // Explicit option wins; otherwise honor the retention age set in the Settings tab.
      maxAge: config.maxAge ?? (loadUiState().maxAge || undefined),
      ignoreHosts: config.ignoreHosts,
      ignorePatterns: config.ignorePatterns,
      slimEcho,
    },
  })

  const maxBodySize = config.maxBodySize ?? DEFAULT_CONFIG.maxBodySize
  const redactHeaders = config.redactHeaders ?? DEFAULT_CONFIG.redactHeaders
  const onReq = (req: NetworkRequest) => client.ingest(req)
  teardowns.push(
    enableFetchInterceptor(onReq, maxBodySize, redactHeaders),
    enableXHRInterceptor(onReq, maxBodySize, redactHeaders),
    enableWebSocketInterceptor(onReq),
  )
  // Relay traffic captured inside Web Workers (workers that run the
  // `hakka-browser/worker` shim) into the same store. Off by default.
  if (captureWorkers) teardowns.push(installWorkerRelay(onReq))
  // Restore persisted mock rules so they intercept from the first request,
  // before the Mock panel is ever opened.
  loadMocks()
  // Apply the persisted initiator-capture setting before any request is made.
  if (loadUiState().captureStack) setStackCapture(true)
  // Auto-open the overlay when a request hits a breakpoint, so the user can act
  // (a paused request holds its Promise until resumed/aborted).
  teardowns.push(
    breakpointEngine.subscribe(() => {
      if (breakpointEngine.hasPaused()) void show()
    }),
  )
  if (resourceTiming) teardowns.push(enableResourceTimingEnrichment(client))
  if (captureBeacons) teardowns.push(enableSendBeaconCapture(client))
  if (captureConsole) {
    const consoleTeardown = enableConsoleCapture()
    if (consoleTeardown) teardowns.push(consoleTeardown)
  }

  // Re-apply settings persisted by the Settings tab, so a previous session's
  // logToConsole/desktopConnect take effect immediately, not only once the
  // overlay is opened. An explicit `logToConsole` option wins over persisted.
  const persisted = loadUiState()
  if (logToConsole ?? persisted.logToConsole) {
    teardowns.push(enableConsoleMirror())
  }
  if (persisted.desktopConnect) {
    connect(persisted.desktopUrl)
  }

  if (overlay === true) void show()
  else if (overlay !== false) mountLauncher()
}

/**
 * Tiny eager entry point — a plain DOM button with zero framework cost, so the
 * heavy Solid UI never loads until the developer actually wants it. Lives in a
 * corner with its own `pointer-events`, so it never blocks the host page.
 */
function mountLauncher(): void {
  if (launcherEl || typeof document === 'undefined') return
  const btn = document.createElement('button')
  btn.type = 'button'
  // Same bowl-and-signal mark as ui/HakkaMark.tsx — inlined because this launcher
  // must stay framework-free (the Solid chunk only loads when the overlay opens).
  btn.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M3.5 12.5h17a8.5 8.5 0 0 1-6 7.3v0.7h-5v-0.7a8.5 8.5 0 0 1-6-7.3z" fill="rgba(238,131,32,0.14)" stroke="#a8a296" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<g stroke="#3aa981" stroke-width="1.6" stroke-linecap="round" fill="none">' +
    '<path d="M9.9 7.4a3 3 0 0 1 4.2 0"/><path d="M8.2 5a5.4 5.4 0 0 1 7.6 0"/><path d="M6.4 2.7a7.9 7.9 0 0 1 11.2 0"/></g></svg>'
  btn.setAttribute('aria-label', 'Open Hakka inspector')
  btn.style.cssText =
    'position:fixed;bottom:20px;right:20px;z-index:2147483646;width:44px;height:44px;' +
    'border-radius:50%;border:1px solid #35302a;background:#23201c;line-height:1;' +
    'display:flex;align-items:center;justify-content:center;' +
    'cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);padding:0;'
  btn.addEventListener('click', () => void show())
  document.body.appendChild(btn)
  launcherEl = btn
}

/**
 * Open the inspector, lazy-loading the Solid UI on first call (a separate async
 * chunk, fetched on demand). Returns once the overlay is mounted and visible.
 */
export async function show(): Promise<void> {
  if (!isBrowser()) return
  // Open by default when summoned (the inspector restores this on mount).
  saveUiState({ open: true })
  if (!uiLoading) {
    // Dynamic import => code-split: the UI is not in the main/host bundle.
    uiLoading = import('./register').then(() => undefined)
  }
  await uiLoading
  if (!overlayEl) {
    overlayEl = document.createElement(OVERLAY_TAG)
    document.body.appendChild(overlayEl)
  }
  overlayEl.style.display = ''
  // The Solid UI now owns the floating toggle; drop the bootstrap launcher.
  launcherEl?.remove()
  launcherEl = null
}

/** Hide the overlay without stopping capture. */
export function hide(): void {
  if (overlayEl) overlayEl.style.display = 'none'
}

/** Stop capture, tear down patches, and remove the overlay + launcher. */
export function destroy(): void {
  for (const t of teardowns) t()
  teardowns = []
  disableConsoleMirror()
  disconnect()
  destroyStore()
  overlayEl?.remove()
  overlayEl = null
  launcherEl?.remove()
  launcherEl = null
  uiLoading = null
  started = false
}

/**
 * Mount the inspector inline into a host element (e.g. your own devtools/admin
 * layout) instead of the floating overlay. Reuses the same component tree as
 * the floating panel — only layout and mount target differ, each in its own
 * Shadow DOM under `target`. Lazy-loaded like `show()`; floating mode is
 * unaffected and the two can run side by side.
 */
export async function mount(target: HTMLElement, options: MountOptions = {}): Promise<MountHandle> {
  const { mount: mountInspector } = await import('./ui/mount')
  return mountInspector(target, options)
}
export type { MountOptions, MountHandle } from './ui/mount'

/**
 * Push a request into the store from your own code (the store runs in the Worker).
 * Useful for seeding, tests, or feeding a custom capture source. Safe before the
 * overlay is shown; lazily creates the store if needed.
 */
export function ingest(req: NetworkRequest): void {
  store().ingest(req)
}

/**
 * Snapshot the current captured requests (resolved from the store thread).
 * Slim by default (see `slimEcho`) — each request's `requestBody`/
 * `responseBody` are omitted (sizes are still there); call `getBody`/
 * `getBodies` for the real bytes, or start with `slimEcho: false` to get
 * full bodies here too.
 */
export function getLogs(): Promise<NetworkRequest[]> {
  return store().getSnapshot()
}

/** Fetch one captured request's full body pair on demand. `null` if `id` isn't in the store. */
export function getBody(id: string): Promise<BodyPair | null> {
  return store().getBody(id)
}

/** Batch form of `getBody` — one round-trip for a whole export/comparison set. */
export function getBodies(ids: string[]): Promise<Map<string, BodyPair>> {
  return store().getBodies(ids)
}

export { Hakka }
export type { HakkaConfig, NetworkRequest, BodyPair }
// Programmatic control surface — script mocks/throttle/initiator from your code
// (or the console). e.g. Hakka.mockEngine.addRule({ pattern: '/api', block: true }).
export { mockEngine, ThrottleEngine, breakpointEngine, setStackCapture, isStackCaptureEnabled } from 'hakka-core'
export type { MockRule, MockRuleInput, ThrottleProfile, Breakpoint, BreakpointInput } from 'hakka-core'
// Structured logging — write app logs that appear in the inspector's Logs tab.
export { log, logDebug, logInfo, logWarn, logError, logStore, LogStore } from 'hakka-core'
export type { LogEntry, LogLevel, LogListener, LogOptions } from 'hakka-core'
// OTLP — push captured traces + metrics + logs to any OpenTelemetry collector.
export { pushOtlp, toOtlpTraces, toOtlpMetrics, toOtlpLogs } from 'hakka-core'
export type { OtlpPushOptions, OtlpPushResult } from 'hakka-core'
export { copyToClipboard } from './adapters/clipboard'
export { shareText } from './adapters/share'
export { getWebDeviceInfo, getSystemInfo, type WebDeviceInfo, type SystemInfoRow } from './adapters/deviceInfo'
export {
  readStorage,
  removeStorageItem,
  clearStorageArea,
  type KV,
  type StorageSnapshot,
  type StorageArea,
} from './adapters/storage'
export {
  enableConsoleCapture,
  getConsoleEntries,
  onConsoleEntry,
  clearConsole,
  type ConsoleEntry,
} from './capture/console'
export { loadUiState, saveUiState, type UiState } from './ui/persist'
// Theming — curated presets + panel opacity/height, applied across the Shadow
// DOM boundary as --hakka-* CSS custom properties. See ui/presets.ts for the
// full themable set and the host-page CSS-var override contract.
export {
  setPreset,
  setPanelOpacity,
  setPanelHeightPx,
  normalizePreset,
  PRESET_NAMES,
  PRESET_LABELS,
} from './ui/presets'
export type { PresetName } from './ui/presets'
export { enableConsoleMirror, disableConsoleMirror, isConsoleMirrorEnabled, mirrorToConsole } from './consoleMirror'
export {
  connect,
  disconnect,
  getBridgeStatus,
  onBridgeStatus,
  isBridgeActive,
  DEFAULT_DESKTOP_URL,
} from './desktopBridge'
export const HAKKA_WEB_VERSION = '0.1.0'
