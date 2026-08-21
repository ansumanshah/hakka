/**
 * CI-baseline normalization — turns raw captured `NetworkRequest[]` into a
 * small set of `NormalizedEndpoint` signatures that are stable run-to-run.
 *
 * This is the hard part and most of the value (see repo `.claude` prompt for
 * this feature). A baseline that fails randomly gets deleted by the team in a
 * week, so every rule below exists to strip something that legitimately
 * varies between two runs of the SAME test suite against the SAME code:
 *
 *   - timestamps, request ids, correlation ids, durations   — never compared
 *   - the ephemeral port a local test server bound to        — host only, no port
 *   - path segments that are ids (numeric, UUID, ObjectId)   — templated to `:id`
 *   - header VALUES (auth tokens, cookies, trace ids)        — only header
 *     NAMES are compared, and a handful of always-volatile names are dropped
 *     entirely (Date, X-Request-Id, ...)
 *   - request/response body VALUES                           — only the JSON
 *     *shape* (key names + value types, recursively) is compared, so a
 *     nonce, timestamp, or generated id inside a body never causes drift as
 *     long as its type doesn't change
 *
 * What is deliberately NOT normalized away (i.e. genuinely part of the
 * contract, comparing these is the point of this feature):
 *   - method, exact status codes observed, the endpoint's host and templated
 *     path, the set of request body keys and their JSON types, the set of
 *     non-volatile request header names, and every host contacted.
 */
import type { NetworkRequest } from 'hakka-core'

/** One endpoint's normalized signature, as it appears in the committed baseline. */
export interface NormalizedEndpoint {
  /** Stable sort/lookup key: `METHOD host path`. */
  key: string
  method: string
  host: string
  /** Path with id-shaped segments templated to `:id`. Query string is dropped — see module doc. */
  path: string
  /** Sorted, de-duplicated status codes (as strings) or `"ERROR"` for a network-error capture, observed across every call to this endpoint in the run. */
  statuses: string[]
  /** Sorted, de-duplicated request header NAMES (values are never compared — see module doc), minus the always-volatile set. */
  requestHeaderNames: string[]
  /** Canonical structural shape of the request body (see `shapeOfJson`), or `null` when no calls carried a body. Union of every shape observed for this endpoint in the run. */
  requestBodyShapes: string[]
}

/** Header names that vary on every single request even when nothing meaningful changed — dropped before comparison rather than merely deprioritized, so they can never appear as a "new header" finding. */
export const DEFAULT_VOLATILE_HEADER_NAMES: readonly string[] = [
  'date',
  'x-request-id',
  'x-correlation-id',
  'x-trace-id',
  'x-hakka-trace',
  'traceparent',
  'tracestate',
  'content-length',
  'host',
  'connection',
  'keep-alive',
  'user-agent',
  'accept-encoding',
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Mongo ObjectId — 24 hex chars.
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i
// Pure numeric id segment.
const NUMERIC_ID_RE = /^\d+$/
// A long opaque token (>=16 chars, mixed alnum with at least one digit) — covers
// short-id / nanoid / snowflake style ids that aren't pure-numeric or UUID shaped.
// Deliberately requires a digit so ordinary lowercase path words ("settings",
// "checkout") never match — see known-limitation note below.
const OPAQUE_TOKEN_RE = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/

/**
 * Replace id-shaped path segments with `:id` so `/users/42` and `/users/87`
 * (or `/users/8f14e45f-...`) normalize to the same endpoint. Known
 * limitation: a genuinely static segment that happens to look like an id
 * (rare — e.g. a 24-hex-char slug) will over-template; a genuinely dynamic
 * slug that doesn't match any pattern (e.g. `/posts/my-first-post`) will
 * under-template and each distinct slug becomes its own baseline entry. Both
 * are rare enough in practice not to be worth a config surface yet — revisit
 * if a real baseline hits this.
 */
export function templatePath(pathname: string): string {
  const segments = pathname.split('/')
  return segments
    .map((seg) => {
      if (seg === '') return seg
      if (UUID_RE.test(seg) || OBJECT_ID_RE.test(seg) || NUMERIC_ID_RE.test(seg) || OPAQUE_TOKEN_RE.test(seg)) {
        return ':id'
      }
      return seg
    })
    .join('/')
}

/** `host` (no port — ephemeral local test-server ports vary run to run) from a URL. Returns `null` for an unparsable URL. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** `pathname` only (no query string, no fragment) from a URL, id-templated. Returns `'/'` for an unparsable URL rather than throwing. */
export function pathOf(url: string): string {
  try {
    return templatePath(new URL(url).pathname)
  } catch {
    return '/'
  }
}

/**
 * Structural JSON "shape" of a value: key names and value TYPES, recursively
 * — never the values themselves. This is what lets a timestamp, nonce, or
 * generated id inside a body pass silently between runs while a genuinely
 * new/removed/retyped field still shows up as drift.
 */
export function shapeOfJson(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array<empty>'
    // Only the first element's shape is sampled — arrays of heterogeneous
    // objects (rare in a JSON API body) would otherwise blow up the shape
    // string; a mixed array is an edge case worth accepting for a stable,
    // readable baseline.
    return `array<${shapeOfJson(value[0])}>`
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return `{${keys.map((k) => `${k}:${shapeOfJson(obj[k])}`).join(',')}}`
  }
  return typeof value
}

/** `shapeOfJson` of a raw request/response body string, or `null` if the body is empty/absent/not JSON. Non-JSON bodies are dropped from shape comparison entirely (out of scope — see module doc's "request-body shape" meaning JSON shape specifically). */
export function shapeOfBody(body: string | null | undefined): string | null {
  if (body == null || body === '') return null
  try {
    const parsed: unknown = JSON.parse(body)
    return shapeOfJson(parsed)
  } catch {
    return null
  }
}

/** Sorted, de-duplicated request header names, minus the volatile set (case-insensitive on both). */
function normalizedHeaderNames(headers: Record<string, string> | undefined, volatile: ReadonlySet<string>): string[] {
  if (!headers) return []
  const names = new Set<string>()
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase()
    if (!volatile.has(lower)) names.add(lower)
  }
  return [...names].sort()
}

function statusOf(req: NetworkRequest): string {
  if (req.error) return 'ERROR'
  if (req.status == null) return 'ERROR'
  return String(req.status)
}

export interface NormalizeOptions {
  /** Extra header names to strip before comparison, in addition to `DEFAULT_VOLATILE_HEADER_NAMES`. */
  extraVolatileHeaders?: string[]
}

/**
 * Reduce raw captured requests to one `NormalizedEndpoint` per (method, host,
 * templated path) — the unit the baseline diff operates on. Multiple calls to
 * the same endpoint within one run are merged: statuses, header names, and
 * body shapes are unioned rather than taking only the first/last call, so a
 * test suite that hits an endpoint twice with slightly different optional
 * fields doesn't produce a flaky single-call snapshot.
 */
export function normalizeRequestsForBaseline(
  requests: readonly NetworkRequest[],
  options: NormalizeOptions = {},
): NormalizedEndpoint[] {
  const volatile = new Set(
    [...DEFAULT_VOLATILE_HEADER_NAMES, ...(options.extraVolatileHeaders ?? [])].map((h) => h.toLowerCase()),
  )

  const byKey = new Map<
    string,
    {
      method: string
      host: string
      path: string
      statuses: Set<string>
      requestHeaderNames: Set<string>
      requestBodyShapes: Set<string>
    }
  >()

  for (const req of requests) {
    const host = hostOf(req.url)
    if (host === null) continue // unparsable URL — nothing stable to key on, skip rather than poison the baseline with a garbage key.
    const path = pathOf(req.url)
    const method = req.method.toUpperCase()
    const key = `${method} ${host}${path}`

    let entry = byKey.get(key)
    if (!entry) {
      entry = {
        method,
        host,
        path,
        statuses: new Set(),
        requestHeaderNames: new Set(),
        requestBodyShapes: new Set(),
      }
      byKey.set(key, entry)
    }

    entry.statuses.add(statusOf(req))
    for (const name of normalizedHeaderNames(req.requestHeaders, volatile)) entry.requestHeaderNames.add(name)
    const shape = shapeOfBody(req.requestBody)
    if (shape !== null) entry.requestBodyShapes.add(shape)
  }

  return [...byKey.entries()]
    .map(([key, e]) => ({
      key,
      method: e.method,
      host: e.host,
      path: e.path,
      statuses: [...e.statuses].sort(),
      requestHeaderNames: [...e.requestHeaderNames].sort(),
      requestBodyShapes: [...e.requestBodyShapes].sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}
