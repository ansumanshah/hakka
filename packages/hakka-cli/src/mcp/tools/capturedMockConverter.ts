import type { MockRuleInput, NetworkRequest } from 'hakka-core'

/**
 * The capture → mock promotion: freezes a captured response into a mock
 * rule the device engines serve verbatim. Mirrors the Swift desktop app's
 * `apps/hakka/Sources/Core/Rules/CapturedMockConverter.swift` decisions
 * exactly (pattern shape, dropped headers, deterministic id) so the two
 * surfaces cannot disagree about what "promote this capture" means.
 */

const EXCLUDED_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection'])

const FNV_OFFSET = 0xcbf2_9ce4_8422_2325n
const FNV_PRIME = 0x100_0000_01b3n
const MASK64 = 0xffff_ffff_ffff_ffffn

/**
 * Matches the endpoint, not one query string: scheme + host + port + path,
 * with the query string dropped. Falls back to the raw url (query string
 * included) when it doesn't parse as an absolute URL — same fallback the
 * Swift converter uses.
 */
function patternFor(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  const scheme = parsed.protocol.replace(/:$/, '')
  if (!scheme || !parsed.hostname) return url

  let pattern = `${scheme}://${parsed.hostname}`
  if (parsed.port) pattern += `:${parsed.port}`
  return pattern + parsed.pathname
}

/**
 * Deterministic id derived from the match key (method + pattern), so
 * re-promoting the same endpoint replaces the existing rule instead of
 * piling up duplicates. Same FNV-derived wraparound hash as the Swift
 * converter's `ruleID(for:)`, so the two surfaces compute the same id for
 * the same capture. Wire-safe characters only (`mck-<base36>`).
 */
function ruleIdFor(method: string, pattern: string): string {
  const key = `${method} ${pattern}`
  let hash = FNV_OFFSET
  for (const byte of Buffer.from(key, 'utf8')) {
    hash = ((hash - BigInt(byte)) & MASK64) * FNV_PRIME
    hash &= MASK64
  }
  return `mck-${hash.toString(36)}`
}

/**
 * The captured response headers that can be replayed verbatim, split the
 * same way `MockResponse` is: one representative (comma-joined) value per
 * name in `headers`, plus the real ordered list in `headerValues` for any
 * name that arrived with more than one value. Bodies are stored decoded, so
 * `Content-Encoding` would mislabel plaintext as compressed and
 * `Content-Length`/`Transfer-Encoding` describe bytes the serving stack
 * recomputes — those (plus `Connection`) are dropped from both; everything
 * else (Content-Type, Set-Cookie, …) survives.
 *
 * Multi-value survival depends on the capture source populating
 * `NetworkRequest.responseHeaderValues` (see `model/types.ts`).
 * `hakka-node`'s `http`/`https` interceptor (`httpInterceptor.ts`) does this
 * for any name Node handed back as a real `string[]` — chiefly `Set-Cookie`,
 * where RFC 6265 §3 forbids folding multiple values into one comma-joined
 * field. A capture with no `responseHeaderValues` (e.g. `fetch`, whose
 * `Headers` API already collapses `Set-Cookie` per spec before user code
 * ever sees it) still promotes fine — it just carries the single folded
 * value in `headers`, same as before this widening existed. This now
 * matches `apps/hakka/Sources/Core/Rules/CapturedMockConverter.swift`'s
 * outcome for a Node-captured Set-Cookie response, even though the iOS
 * capture model (`[String: [String]]` from the start) and this one
 * (single-value `responseHeaders` plus an additive `responseHeaderValues`)
 * arrive at it by different routes.
 */
function responseHeadersFor(request: NetworkRequest): {
  headers: Record<string, string>
  headerValues?: Record<string, string[]>
} {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.responseHeaders ?? {})) {
    if (EXCLUDED_RESPONSE_HEADERS.has(name.toLowerCase())) continue
    headers[name] = value
  }

  let headerValues: Record<string, string[]> | undefined
  for (const [name, values] of Object.entries(request.responseHeaderValues ?? {})) {
    if (EXCLUDED_RESPONSE_HEADERS.has(name.toLowerCase())) continue
    if (values.length < 2) continue
    headerValues ??= {}
    headerValues[name] = [...values]
  }

  return { headers, headerValues }
}

export type PromotionRefusalReason = 'errored_capture' | 'incomplete_capture'

/**
 * Refuses to promote a capture that never got a real response: an errored
 * capture (network error, timeout, abort) or one still pending (no status
 * yet). Promoting either would fabricate a nonsense `200 ""` mock instead
 * of reporting the truth — the defect this tool deliberately does not
 * reproduce.
 */
export function refusalReasonFor(request: NetworkRequest): PromotionRefusalReason | null {
  if (request.error) return 'errored_capture'
  if (request.status == null) return 'incomplete_capture'
  return null
}

/** Builds the mock rule + wire id for a captured request. Caller must check `refusalReasonFor` first. */
export function mockRuleEntryFor(request: NetworkRequest): MockRuleInput & { id: string } {
  const pattern = patternFor(request.url)
  const id = ruleIdFor(request.method, pattern)
  const { headers, headerValues } = responseHeadersFor(request)
  return {
    id,
    pattern,
    method: request.method,
    mode: 'mock',
    response: {
      status: request.status as number,
      headers,
      ...(headerValues !== undefined ? { headerValues } : {}),
      body: request.responseBody ?? '',
      delay: 0,
    },
    enabled: true,
  }
}
