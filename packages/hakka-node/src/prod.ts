/**
 * hakka-node/prod — ADR 0002 (production capture for a debug cohort), Option B.
 * Full usage, the two-gate model, and the pull-route contract:
 * see [Production capture for a debug cohort](/node/overview/#production-capture-for-a-debug-cohort-hakka-nodeprod).
 *
 * A separate, capture-only entry point — deliberately NOT a config flag on
 * the dev `register()`/`startCapture()` path. The live bridge TRANSPORT is not
 * merely disabled here, it is ABSENT from this file's import graph: nothing
 * below imports `./serverCapture` or `./bridgeClient`, so a bundler building
 * just this entry point has nothing control-channel-shaped to ship. A config
 * flag that leaves the dangerous code physically present is not a security
 * boundary; a separate build target is.
 *
 * Stated precisely, because the distinction matters: what is absent is the
 * *remote* path. `enableFetchInterceptor` (on by default) is imported from
 * `hakka-core`, and `capture/fetch.ts` imports the mock, breakpoint and
 * throttle engines at module scope — so those singletons are loaded and
 * `mockEngine.peek()` runs per captured fetch. They are inert with no rules,
 * and with no bridge there is no way to add one from off-process. But "the
 * rule engines cannot be reached over the network" is the true claim; "the
 * rule engines are not in the build" is not. Decoupling them would mean
 * injecting engines through the capture hot path, which ADR 0009 rules out.
 * Set `captureHttp` only (`captureFetch: false`) if you want a build that
 * genuinely never loads them.
 *
 * Keeps its own singleton (`active`, below), independent of
 * `serverCapture.ts`'s — running both `startCapture()` and
 * `startProdCapture()` in the same process is possible but
 * untested/unsupported; pick one per deployment.
 */
import { timingSafeEqual } from 'node:crypto'

import {
  DEFAULT_CONFIG,
  RingBuffer,
  configureBodyRedaction,
  enableFetchInterceptor,
  getBodyRedactionFields,
  type NetworkRequest,
  type RequestRuntime,
} from 'hakka-core'

import { DEFAULT_BRIDGE_HOSTS, enableHttpInterceptor } from './httpInterceptor'
import { cohortGate, enableTracePropagation } from './trace'
import { globToUrlRegExp } from './urlGlob'

/** Prod bodies are read at real traffic volume — much lower than dev's 256 KB default. */
const DEFAULT_MAX_BODY_SIZE = 32 * 1024
/** "Small" per the ADR — the last N requests for a cohort user, not a general-purpose log. */
const DEFAULT_MAX_RECORDS = 200
const DEFAULT_KILL_SWITCH_POLL_MS = 30_000

/**
 * Body fields redacted by default in production.
 *
 * Everywhere else in Hakka, body redaction is off until someone configures it,
 * which is right for a developer inspecting their own laptop's traffic. Here
 * the traffic belongs to real users on a production server, so the default is
 * inverted: redact the field names that carry credentials and identity, and
 * make capturing them verbatim the thing you have to ask for.
 *
 * Deliberately a list of names rather than a pattern language — this must be
 * obvious to audit at a glance, and `redactBodyFields` takes whatever list a
 * deployment actually needs.
 */
export const PROD_DEFAULT_BODY_REDACT_FIELDS: readonly string[] = [
  'password',
  'passwd',
  'pass',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'apikey',
  'api_key',
  'clientsecret',
  'client_secret',
  'authorization',
  'sessionid',
  'session_id',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'ssn',
  'pin',
  'otp',
]

export interface ProdCaptureOptions {
  /**
   * REQUIRED. Glob URL patterns (`*` wildcard, matched against the FULL
   * request URL — protocol, host, path, and query) that capture is restricted
   * to. `startProdCapture` THROWS if this is missing or empty: there is no
   * capture-everything prod mode, by design (see the module doc).
   */
  captureUrls: string[]
  /** Max captured body size in bytes. Default 32 KB. */
  maxBodySize?: number
  /** Ring buffer capacity (record count). Default 200. */
  maxRecords?: number
  /** Optional byte ceiling for the ring buffer's retained bodies, on top of `maxRecords`. Default unbounded. */
  maxBufferBytes?: number
  /** Sensitive header names to redact. Default `hakka-core`'s default list. */
  redactHeaders?: string[]
  /**
   * JSON body field names whose values are redacted, recursively and
   * case-insensitively. Defaults to `PROD_DEFAULT_BODY_REDACT_FIELDS` — unlike
   * everywhere else in Hakka, where body redaction is off until configured.
   *
   * This entry point captures real users' traffic on a production server, so
   * it defaults to redacting rather than to fidelity, the same way `captureUrls`
   * is required rather than defaulting to capture-everything. Pass `[]` to
   * capture bodies verbatim, deliberately.
   *
   * Note this configures a process-global list (`configureBodyRedaction`),
   * restored when the returned handle is stopped.
   */
  redactBodyFields?: string[]
  /** Capture `fetch`. Default true. */
  captureFetch?: boolean
  /** Capture Node `http`/`https`. Default true. */
  captureHttp?: boolean
  /** Tag applied to every captured record. Default `'server'`. */
  runtime?: RequestRuntime
  /** Additional sink for every record that passes the cohort + URL-allowlist gate. */
  sink?: (req: NetworkRequest) => void
  /** How often (ms) the `HAKKA_DISABLE` kill switch polls the environment. Default 30s. */
  killSwitchPollMs?: number
  /**
   * Override the cohort gate. Defaults to `cohortGate()` — capture only
   * requests running inside a `debug: true` trace context. Override only for
   * tests or a custom cohort mechanism; production callers should rely on
   * `runInTraceContext` via middleware instead (see the module doc).
   */
  shouldCapture?: () => boolean
}

export interface ProdCaptureHandle {
  stop(): void
  readonly runtime: RequestRuntime
  /** All currently buffered records, oldest → newest. */
  getRecords(): NetworkRequest[]
}

let active: ProdCaptureHandle | null = null

/**
 * Start production capture. THROWS if `options.captureUrls` is missing or
 * empty. Idempotent — a second call while a capture is already active returns
 * the FIRST call's handle (mirrors `startCapture`'s own idempotence); the new
 * options are ignored in that case.
 */
export function startProdCapture(options: ProdCaptureOptions): ProdCaptureHandle {
  if (active) return active
  if (!options.captureUrls || options.captureUrls.length === 0) {
    throw new Error(
      'startProdCapture requires a non-empty `captureUrls` allowlist (ADR 0002: allowlist beats denylist in ' +
        'prod) — pass the URL glob patterns you want captured, e.g. ' +
        'captureUrls: ["https://api.example.com/users/*"]. There is no capture-everything prod mode by design.',
    )
  }

  const runtime = options.runtime ?? 'server'
  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE
  const redactHeaders = options.redactHeaders ?? DEFAULT_CONFIG.redactHeaders
  const patterns = options.captureUrls.map(globToUrlRegExp)
  const ring = new RingBuffer(options.maxRecords ?? DEFAULT_MAX_RECORDS, options.maxBufferBytes)
  const cohort = options.shouldCapture ?? cohortGate()
  const userSink = options.sink

  // Cohort membership is enforced via `cohort` as both interceptors'
  // `shouldCapture` gate below; this adds the independent URL-allowlist half
  // of the AND — a cohort request whose URL isn't on `captureUrls` still isn't captured.
  const onRequest = (req: NetworkRequest): void => {
    const tagged: NetworkRequest = req.runtime ? req : { ...req, runtime }
    if (!patterns.some((re) => re.test(tagged.url))) return
    // `fetch` emits each request TWICE under the same `id` — headers first,
    // then a body-captured update (see capture/fetch.ts) — `update()` folds
    // the second call into the SAME ring slot instead of consuming a second
    // one, so `maxRecords` bounds logical requests, not emission events.
    if (!ring.update(tagged)) ring.add(tagged)
    userSink?.(tagged)
  }

  // Body-field redaction is a process-global in hakka-core, so set it here and
  // put back whatever was there on stop. Without this, prod captured JSON
  // bodies verbatim: the redaction functions no-op on an empty field list, and
  // nothing in this package ever configured one.
  const previousBodyRedactFields = getBodyRedactionFields()
  configureBodyRedaction([...(options.redactBodyFields ?? PROD_DEFAULT_BODY_REDACT_FIELDS)])

  const interceptorOptions = { shouldCapture: cohort }
  const teardowns: Array<() => void> = [() => configureBodyRedaction(previousBodyRedactFields)]
  if (options.captureFetch !== false) {
    teardowns.push(enableFetchInterceptor(onRequest, maxBodySize, redactHeaders, interceptorOptions))
  }
  if (options.captureHttp !== false) {
    teardowns.push(
      enableHttpInterceptor(onRequest, maxBodySize, redactHeaders, DEFAULT_BRIDGE_HOSTS, interceptorOptions),
    )
  }
  if (runtime !== 'edge') {
    teardowns.push(enableTracePropagation())
  }

  // Same live escape hatch `serverCapture.ts` has. `unref()`'d so it can
  // never by itself keep the process alive.
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
    getRecords: () => Array.from(ring),
    stop() {
      if (killSwitchTimer) clearInterval(killSwitchTimer)
      for (let i = teardowns.length - 1; i >= 0; i--) teardowns[i]()
      active = null
    },
  }
  return active
}

/** Stop the active production capture, if any. */
export function stopProdCapture(): void {
  active?.stop()
}

export interface CreatePullHandlerOptions {
  /** The handle from `startProdCapture()` (or any object exposing `getRecords`, e.g. for tests). */
  capture: Pick<ProdCaptureHandle, 'getRecords'>
  /**
   * Bearer token the caller must present via `Authorization: Bearer <token>`.
   * Compared with `node:crypto`'s `timingSafeEqual` so a byte-by-byte content
   * mismatch can't be inferred from response latency. This route sits behind
   * the APP's own auth/routing (ADR 0002: "no new open port") — the token is
   * an additional secret specifically for this route, not a replacement for it.
   */
  token: string
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || null
}

/**
 * Constant-time TOKEN CONTENT comparison. A length mismatch returns `false`
 * immediately without calling `timingSafeEqual` (which requires equal-length
 * buffers or it throws) — the token's length isn't the secret worth protecting
 * bit-by-bit, its content is, and that comparison only ever runs on
 * equal-length input.
 */
function safeEqual(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * Framework-agnostic pull route: `(request: Request) => Promise<Response>`.
 * 401s without a valid bearer token. Supports `?since=<ms-timestamp>` (only
 * records strictly newer than it) and `?user=<correlationId-prefix>` filters.
 * `JSON.stringify` happens HERE, at pull time — never at capture time.
 */
export function createPullHandler(options: CreatePullHandlerOptions): (request: Request) => Promise<Response> {
  const { capture, token } = options

  return async function pullHandler(request: Request): Promise<Response> {
    const presented = bearerToken(request)
    if (!presented || !safeEqual(presented, token)) {
      return jsonResponse(401, { error: 'unauthorized' })
    }

    // `Request.url` is spec-required to be absolute, but some minimal test
    // doubles / framework shims hand back a bare path — the fallback base
    // keeps query-param parsing working either way without throwing.
    const url = new URL(request.url, 'http://localhost')
    const since = url.searchParams.get('since')
    const user = url.searchParams.get('user')

    let records = capture.getRecords()
    if (since !== null) {
      const sinceMs = Number(since)
      if (Number.isFinite(sinceMs)) records = records.filter((r) => r.startTime > sinceMs)
    }
    if (user) records = records.filter((r) => r.correlationId?.startsWith(user))

    return jsonResponse(200, { records })
  }
}
