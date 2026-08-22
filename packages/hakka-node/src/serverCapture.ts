/**
 * startCapture — instrument any Node backend (plain `http`, Express, Fastify,
 * Hono, Next, …) and stream captures to the Hakka inspector.
 *
 * Patches `globalThis.fetch` (via `hakka-core`'s interceptor) and Node
 * `http`/`https`, tags every record with `runtime` (default `'server'`), and by
 * default streams them to the bridge hub so the browser overlay shows server and
 * client requests in one UI.
 *
 *   import { register } from 'hakka-node'
 *   register({ bridgeUrl: 'ws://localhost:8989' })
 *
 * Desktop mode — stream into an already-running Hakka for macOS instead of
 * embedding a hub in this process:
 *
 *   register({ embedBridge: false })
 *
 * See `HakkaNodeOptions.embedBridge`'s doc comment for what this changes (and
 * doesn't) about the browser overlay and reconnect behavior.
 */
import { DEFAULT_CONFIG, enableFetchInterceptor, type NetworkRequest, type RequestRuntime } from 'hakka-core'

import { createBridgeClient, type BridgeClient } from './bridgeClient'
import { DEFAULT_BRIDGE_HOSTS, enableHttpInterceptor } from './httpInterceptor'
import { enableTraceSpans } from './spanProcessor'
import { enableTracePropagation } from './trace'
import { enableTraceparentFetch } from './traceparentFetch'
import { enableUndiciTiming } from './undiciTiming'
import { globToUrlRegExp } from './urlGlob'

export interface HakkaNodeOptions {
  /** Tag applied to every captured record. Default `'server'`. */
  runtime?: RequestRuntime
  /** Max captured body size in bytes. Default: hakka-core's default (256 KB). */
  maxBodySize?: number
  /** Sensitive header names to redact. Default: hakka-core's default list. */
  redactHeaders?: string[]
  /** Capture `fetch`. Default true. */
  captureFetch?: boolean
  /** Capture Node `http`/`https`. Default true. */
  captureHttp?: boolean
  /** Stream captures to the bridge hub. Default true. */
  bridge?: boolean
  /**
   * Start the bridge hub IN-PROCESS so there's no separate `hakka-bridge`
   * process to run — this process hosts it. Default true. If the port is
   * already taken (another worker, or a standalone hub), this silently
   * connects to that one instead.
   *
   * **Desktop mode:** pass `embedBridge: false` to always connect as a
   * plain client instead of racing to host a hub — the deliberate way to
   * stream server captures into an already-running Hakka for macOS (or any
   * other standalone hub) rather than relying on the port-already-taken
   * fallback above. `bridgeUrl` defaults to the same `ws://localhost:8989`
   * the desktop app's hub listens on, so `{ embedBridge: false }` alone is
   * usually all you need. The bridge client auto-reconnects with backoff
   * and queues while offline (see `bridgeClient.ts`), so this never blocks
   * or crashes the dev server when the desktop app isn't running — captures
   * just queue (bounded) until it is. The browser overlay needs no change
   * either: with nothing embedding a hub in this process, `hakka-node/next/
   * client`'s default `ws://localhost:8989` connects it straight to the
   * same external hub as a second peer, so server + client traffic still
   * show up together — no relay mesh, no double-streaming.
   */
  embedBridge?: boolean
  /** Bridge hub URL. Default `ws://localhost:8989`. */
  bridgeUrl?: string
  /**
   * Apply `{ type: 'control' }` frames received from the bridge hub —
   * mock/breakpoint/throttle commands, e.g. a mock rule created in the
   * Hakka desktop app — to this process's capture engines. Default `true`.
   * This is what lets a desktop-authored mock intercept a server-side
   * `fetch()` the same way it already intercepts the browser's own calls.
   * Set `false` to keep this process capture-only (send but never be
   * remote-controlled) — has no effect when `bridge: false`.
   */
  handleControl?: boolean
  /** Additional sink for every captured record (e.g. feed an SSE endpoint). */
  sink?: (req: NetworkRequest) => void
  /**
   * Full-URL `*`-glob patterns whose captures are dropped at emit time —
   * they never reach the sink or the bridge. For filtering framework noise
   * (HMR, telemetry) out of the inspector; for CAPTURE-cost gating use
   * `shouldCapture`/`sampleRate` instead (those run before any capture work).
   */
  ignorePatterns?: string[]
  /**
   * Force capture to start even outside `NODE_ENV === 'development'`. Only
   * `register()` gates on this — `startCapture()` always runs when called.
   */
  force?: boolean
  /**
   * Fraction (0..1) of requests to capture, via `Math.random() < sampleRate`.
   * Composes with `shouldCapture` into ONE gate shared by both interceptors —
   * see that field's doc for composition order.
   */
  sampleRate?: number
  /**
   * Custom pre-capture gate (e.g. `cohortGate()` from `trace.ts`, ADR 0002's
   * production debug cohort). Runs FIRST; a `false` return skips capture
   * outright without even evaluating `sampleRate`. `undefined` when neither
   * option is set — a zero-cost default, no gate call on the hot path.
   */
  shouldCapture?: () => boolean
  /** How often (ms) the `HAKKA_DISABLE` kill switch polls the environment. Default 30s. */
  killSwitchPollMs?: number
  /**
   * Best-effort connect-phase (`connectMs`) enrichment for server-side
   * `fetch()` captures, sourced from undici's `node:diagnostics_channel`
   * events — see [Best-effort undici connect timing](/node/overview/#best-effort-undici-fetch-connect-timing).
   * Opt-in and zero-cost when off. Default false.
   */
  undiciTiming?: boolean
  /**
   * Bridge an already-registered OpenTelemetry `TracerProvider`'s spans into
   * the inspector as `FrameworkSpan` records — see
   * [Request Insights](/nextjs/overview/#request-insights-span-waterfall).
   * Depends only on the optional `@opentelemetry/api` peer and fails open
   * when it isn't installed. Default `false` here; `hakka-node/next` defaults
   * it to `true` in development.
   */
  traceSpans?: boolean
}

export interface HakkaNodeCapture {
  stop(): void
  readonly runtime: RequestRuntime
}

const DEFAULT_BRIDGE_URL = 'ws://localhost:8989'
const DEFAULT_KILL_SWITCH_POLL_MS = 30_000

let active: HakkaNodeCapture | null = null
let embeddedBridge: { close: () => void | Promise<void> } | null = null

/**
 * Compose `shouldCapture` + `sampleRate` into ONE gate function shared by the
 * fetch and http interceptors, so "captured or not" is decided identically
 * for both — a request sampled out of one is sampled out of the other. The
 * custom gate runs first and short-circuits (skipping the `Math.random()`
 * call entirely) so a caller relying purely on `shouldCapture` never pays for
 * sampling it didn't ask for. Returns `undefined` when neither option is set,
 * so the interceptors' own `shouldCapture?.()` checks cost nothing by default.
 */
function composeCaptureGate(options: HakkaNodeOptions): (() => boolean) | undefined {
  const { shouldCapture, sampleRate } = options
  if (!shouldCapture && sampleRate === undefined) return undefined
  return () => {
    if (shouldCapture && !shouldCapture()) return false
    if (sampleRate !== undefined && !(Math.random() < sampleRate)) return false
    return true
  }
}

/** Best-effort `host:port` for `url`, used to auto-extend the bridge self-capture skip-list. */
function hostFromUrl(url: string): string | null {
  try {
    const httpish = url.replace(/^wss?:/, 'https:').replace(/^ws:/, 'http:')
    const u = new URL(httpish)
    return u.port ? `${u.hostname}:${u.port}` : u.hostname
  } catch {
    return null
  }
}

/** Start the bridge hub in this process. No-op if the port is already taken. */
async function startEmbeddedBridge(url: string): Promise<void> {
  let port = 8989
  try {
    const parsed = Number(new URL(url).port)
    if (Number.isInteger(parsed) && parsed > 0) port = parsed
  } catch {
    /* keep default port */
  }
  try {
    const { startBridgeServer } = await import('hakka-bridge')
    embeddedBridge = await startBridgeServer({ port })
  } catch {
    // Port in use → a hub (or another worker) already hosts it; the bridge
    // client connects to that one. Nothing to do.
  }
}

/** Start capture. Idempotent — a second call returns the live handle. */
export function startCapture(options: HakkaNodeOptions = {}): HakkaNodeCapture {
  if (active) return active

  const runtime = options.runtime ?? 'server'
  const maxBodySize = options.maxBodySize ?? DEFAULT_CONFIG.maxBodySize
  const redactHeaders = options.redactHeaders ?? DEFAULT_CONFIG.redactHeaders
  const useBridge = options.bridge !== false
  const bridgeUrl = options.bridgeUrl ?? DEFAULT_BRIDGE_URL
  const resolvedHost = hostFromUrl(bridgeUrl)
  const bridgeHosts = resolvedHost ? [...new Set([...DEFAULT_BRIDGE_HOSTS, resolvedHost])] : DEFAULT_BRIDGE_HOSTS

  // Embed the hub in-process by default so there's no separate `hakka-bridge`
  // process. Fire-and-forget; the bridge client queues until ready.
  if (useBridge && options.embedBridge !== false && runtime !== 'edge') {
    void startEmbeddedBridge(bridgeUrl)
  }

  const bridge: BridgeClient | null = useBridge
    ? createBridgeClient({ url: bridgeUrl, handleControl: options.handleControl })
    : null

  // Opt-in and zero-cost when off: no diagnostics_channel subscriptions are
  // created unless `undiciTiming: true` AND fetch capture is actually on (no
  // point tapping undici for a record source that's disabled).
  const undiciTiming = options.undiciTiming && options.captureFetch !== false ? enableUndiciTiming() : null

  // Opt-in and zero-cost when off: no dynamic import, no processor
  // construction, unless `traceSpans: true`.
  const traceSpans = options.traceSpans ? enableTraceSpans((span) => bridge?.sendSpan(span), runtime) : null

  // Compiled once; empty/absent list keeps the hot path free of any check.
  const ignoreRegexps = options.ignorePatterns?.length ? options.ignorePatterns.map(globToUrlRegExp) : null

  const onRequest = (req: NetworkRequest): void => {
    if (ignoreRegexps && ignoreRegexps.some((re) => re.test(req.url))) return
    undiciTiming?.enrich(req)
    const tagged: NetworkRequest = req.runtime ? req : { ...req, runtime }
    options.sink?.(tagged)
    bridge?.send(tagged)
  }

  // One gate, shared by both interceptors — see composeCaptureGate's doc.
  // `undefined` (neither option set) is passed straight through, so this is a
  // zero-cost default: no options object, no gate call, on the hot path.
  const captureGate = composeCaptureGate(options)
  const interceptorOptions = captureGate ? { shouldCapture: captureGate } : undefined

  // Installed in dependency order (each entry may wrap the previous one), so
  // teardown MUST run LIFO to correctly unwind outer wrappers before the ones
  // they wrap — e.g. the traceparent fetch wrapper sits outside hakka-core's
  // own fetch patch, so it must be torn down first.
  const teardowns: Array<() => void> = []
  if (options.captureFetch !== false) {
    teardowns.push(enableFetchInterceptor(onRequest, maxBodySize, redactHeaders, interceptorOptions))
    teardowns.push(enableTraceparentFetch())
  }
  if (options.captureHttp !== false) {
    teardowns.push(enableHttpInterceptor(onRequest, maxBodySize, redactHeaders, bridgeHosts, interceptorOptions))
  }
  // Link caller→handler→upstream hops: read the incoming trace header into an
  // async context so captures above inherit the caller's correlationId.
  if (runtime !== 'edge') {
    teardowns.push(enableTracePropagation())
  }

  // Kill switch: flipping `HAKKA_DISABLE` in the process env stops capture on
  // the next poll tick, without a redeploy. `unref()`'d so it can never by
  // itself keep the process alive.
  const killSwitchPollMs = options.killSwitchPollMs ?? DEFAULT_KILL_SWITCH_POLL_MS
  const killSwitchTimer: ReturnType<typeof setInterval> | null =
    typeof setInterval === 'function'
      ? setInterval(() => {
          if (process.env.HAKKA_DISABLE) active?.stop()
        }, killSwitchPollMs)
      : null
  killSwitchTimer?.unref?.()

  active = {
    runtime,
    stop() {
      if (killSwitchTimer) clearInterval(killSwitchTimer)
      for (let i = teardowns.length - 1; i >= 0; i--) teardowns[i]()
      undiciTiming?.teardown()
      traceSpans?.teardown()
      bridge?.close()
      void embeddedBridge?.close()
      embeddedBridge = null
      active = null
    },
  }
  return active
}

/** Stop the active capture, if any. */
export function stopCapture(): void {
  active?.stop()
}

/**
 * Dev-only convenience entry point — no-ops unless `NODE_ENV === 'development'`
 * or `options.force` is set, so it is always safe to leave a bare `register()`
 * call in production code. Returns the capture handle, or `undefined` if it
 * no-op'd.
 */
export function register(options: HakkaNodeOptions = {}): HakkaNodeCapture | undefined {
  if (process.env.NODE_ENV !== 'development' && !options.force) return undefined
  return startCapture({ runtime: 'server', ...options })
}
