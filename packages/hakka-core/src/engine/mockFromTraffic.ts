import type { NetworkRequest } from '../model/types'
/**
 * mockFromTraffic.ts — "record, then mock": turns already-captured
 * `NetworkRequest`s into `MockRuleInput` rules in one pass. Dedup, pattern,
 * and skip-unusable design rationale: see /spec/mock#record-then-mock-generatemockrules.
 */
import { splitPathAndQuery } from '../utils/urlParser'
import type { MockRuleInput } from './MockEngine'

export interface GenerateMockRulesOptions {
  /** Prefix for minted rule ids: `${idPrefix}-1`, `${idPrefix}-2`, … Default: 'mock'. */
  idPrefix?: string
}

/** Header names (case-insensitive) carried over onto the mocked response. */
const CARRIED_RESPONSE_HEADERS = ['content-type']

/** True when a request has nothing worth replaying — no status AND no response body. */
function isUnusable(req: NetworkRequest): boolean {
  return req.status == null && (req.responseBody == null || req.responseBody === '')
}

/** Derive the URL path+query (origin stripped) used as the mock pattern. */
function derivePattern(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    // Not a parseable absolute URL (e.g. already a relative path) — fall back
    // to stripping any query-string split so behavior stays consistent.
    const { pathPart, queryPart } = splitPathAndQuery(url)
    return pathPart + queryPart
  }
}

/** Dedup key: method + derived path+query pattern. */
function dedupKey(req: NetworkRequest): string {
  return `${req.method.toUpperCase()} ${derivePattern(req.url)}`
}

function carriedResponseHeaders(req: NetworkRequest): Record<string, string> | undefined {
  if (!req.responseHeaders) return undefined
  const out: Record<string, string> = {}
  const lowerToActual = Object.keys(req.responseHeaders).reduce<Record<string, string>>((acc, k) => {
    acc[k.toLowerCase()] = k
    return acc
  }, {})
  for (const name of CARRIED_RESPONSE_HEADERS) {
    const actualKey = lowerToActual[name]
    if (actualKey !== undefined) out[name] = req.responseHeaders[actualKey]!
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Generate one `MockRuleInput` (with a minted `id`) per unique (method,
 * path+query) pair in `requests`. Requests with no usable response (pending,
 * or errored with no status) are skipped. When multiple captures share a key,
 * the newest one (by `startTime`, falling back to array order) wins.
 */
export function generateMockRules(
  requests: NetworkRequest[],
  opts: GenerateMockRulesOptions = {},
): (MockRuleInput & { id: string })[] {
  const idPrefix = opts.idPrefix ?? 'mock'

  // Keep the newest usable request per dedup key. "Newest" = latest
  // startTime; ties broken by later position in the input array.
  const winners = new Map<string, NetworkRequest>()
  for (const req of requests) {
    if (isUnusable(req)) continue
    const key = dedupKey(req)
    const existing = winners.get(key)
    if (!existing || (req.startTime ?? 0) >= (existing.startTime ?? 0)) {
      winners.set(key, req)
    }
  }

  let counter = 0
  const rules: (MockRuleInput & { id: string })[] = []
  for (const req of winners.values()) {
    counter++
    const id = `${idPrefix}-${counter}`
    const headers = carriedResponseHeaders(req)
    rules.push({
      id,
      pattern: derivePattern(req.url),
      method: req.method,
      mode: 'mock',
      response: {
        status: req.status ?? 200,
        headers,
        body: req.responseBody ?? '',
      },
      enabled: true,
    })
  }

  return rules
}
