import type { NetworkRequest } from '../model/types'
import { DEFAULT_SENSITIVE_HEADERS, isSensitiveHeader } from './headerRedaction'

/**
 * Share-time scrubbing — a SECOND, independent redaction pass from capture-time body
 * redaction (`bodyRedaction.ts`). Capture-time redaction is what the developer told the
 * SDK to hide from the record entirely (already gone by the time a request reaches this
 * module); share-time scrubbing is about what is allowed to leave THIS machine inside a
 * particular artifact (an MCP tool result, a `.hakka-repro` bundle, an agent-context
 * clipboard payload). A developer debugging locally wants to see the token in the
 * inspector; the bug report or agent thread must not contain it. The two passes
 * deliberately do NOT share a field-name list — see `DEFAULT_SHARE_SCRUB_JSON_FIELDS`
 * below, which is its own list, not `getBodyRedactionFields()`.
 *
 * Bias: false negatives (a missed secret) are the failure that matters here, not false
 * positives (an over-scrubbed body is only an annoyance). Every pass below is tuned
 * toward catching more, not toward precision — see per-function comments for the
 * specific tradeoff made.
 *
 * Honesty about limits: this is pattern matching, not a secret scanner. It catches
 * common shapes (JWTs, `Bearer` tokens, named JSON fields, named query params, Basic
 * auth in URLs, sensitive headers, email addresses) — it will NOT catch a bespoke
 * token format, a secret embedded in free-form prose, or a secret split across two
 * fields. Document this limitation everywhere share-time scrubbing is surfaced;
 * never imply completeness.
 */

const REDACTION_PLACEHOLDER = '[REDACTED]'
const MAX_DEPTH = 100

/** What kind of thing a scrub pass removed — used to build a visible, honest summary rather than scrubbing silently. */
export type ShareScrubCategory =
  | 'header'
  | 'jsonField'
  | 'bearerToken'
  | 'jwt'
  | 'apiKeyQueryParam'
  | 'basicAuthUrl'
  | 'email'

/** One category's tally for a single scrub pass. */
export interface ShareScrubRemoval {
  category: ShareScrubCategory
  count: number
}

/**
 * JSON body field names scrubbed at share time (case-insensitive, exact match).
 * Deliberately separate from `bodyRedaction.ts`'s `configuredFields` — that list is
 * developer-opted-in for capture; this one is Hakka's own opinion of "never leaves the
 * machine by default," broader on purpose since a missed field here is a real leak.
 */
export const DEFAULT_SHARE_SCRUB_JSON_FIELDS: readonly string[] = [
  'password',
  'passwd',
  'pass',
  'pwd',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'secret',
  'clientsecret',
  'client_secret',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'privatekey',
  'private_key',
  'ssn',
  'social_security_number',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'session',
  'sessiontoken',
  'session_token',
  'sessionid',
  'session_id',
]

/** Query string param names scrubbed at share time (case-insensitive, exact match). */
export const DEFAULT_SHARE_SCRUB_QUERY_PARAMS: readonly string[] = [
  'key',
  'apikey',
  'api_key',
  'token',
  'access_token',
  'accesstoken',
  'secret',
  'password',
  'auth',
  'authorization',
  'session',
  'sessionid',
  'session_id',
]

/** Header names scrubbed at share time. Starts from `DEFAULT_SENSITIVE_HEADERS` (capture-time's own default) since a header sensitive enough to redact at capture is at least as sensitive at share time. */
export const DEFAULT_SHARE_SCRUB_HEADERS: readonly string[] = DEFAULT_SENSITIVE_HEADERS

// JWTs: three dot-separated base64url segments, each of meaningful length. Matches
// standalone JWTs in bodies (not just inside an Authorization header, which the header
// pass already blanks entirely).
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{3,}\b/g

// "Bearer <token>" anywhere in free text (a body that echoes a header, an error message
// that includes the failing token, etc). Deliberately loose (8+ token chars) — false
// negatives cost more here than false positives.
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi

// A conservative email pattern. Emails are the one category with a real false-positive
// risk (usernames that look like emails, example.com fixtures), so this is the one
// pattern gated behind an opt-out rather than always-on — see `scrubEmails` option.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

/** Options threaded through every scrub function in this module. */
export interface ShareScrubOptions {
  /** JSON body field names to scrub, in addition to `DEFAULT_SHARE_SCRUB_JSON_FIELDS`. */
  extraJsonFields?: string[]
  /** Query param names to scrub, in addition to `DEFAULT_SHARE_SCRUB_QUERY_PARAMS`. */
  extraQueryParams?: string[]
  /** Header names to scrub, in addition to `DEFAULT_SHARE_SCRUB_HEADERS`. */
  extraHeaders?: string[]
  /** Scrub email addresses found in bodies. Default true — off is for a caller that has already decided emails are acceptable in this artifact (e.g. an internal-only bug tracker). */
  scrubEmails?: boolean
}

function mergeRemovals(into: ShareScrubRemoval[], category: ShareScrubCategory, count: number): void {
  if (count <= 0) return
  const existing = into.find((r) => r.category === category)
  if (existing) {
    existing.count += count
  } else {
    into.push({ category, count })
  }
}

/** Redact "user:pass@" Basic-auth credentials embedded directly in a URL. Blanks the whole userinfo segment (username included) rather than just the password — a username in a URL is itself often an account identifier worth treating as sensitive, and splitting the replacement adds a false-negative risk for no real benefit. */
function scrubBasicAuthInUrl(url: string): { url: string; removed: ShareScrubRemoval[] } {
  const removed: ShareScrubRemoval[] = []
  const match = /^(https?:\/\/)([^/@\s]+):([^/@\s]+)@/i.exec(url)
  if (!match) return { url, removed }
  const scrubbed = url.replace(match[0], `${match[1]}${REDACTION_PLACEHOLDER}@`)
  mergeRemovals(removed, 'basicAuthUrl', 1)
  return { url: scrubbed, removed }
}

/** Redact query string param values whose name matches the scrub list. */
function scrubQueryParams(url: string, paramNames: readonly string[]): { url: string; removed: ShareScrubRemoval[] } {
  const removed: ShareScrubRemoval[] = []
  const lowerNames = new Set(paramNames.map((n) => n.toLowerCase()))

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Not an absolute URL (relative path, malformed input) — nothing safe to parse; the
    // pattern-scan passes over the body still catch bearer/JWT/email shapes elsewhere.
    return { url, removed }
  }

  let count = 0
  for (const key of parsed.searchParams.keys()) {
    if (lowerNames.has(key.toLowerCase())) {
      parsed.searchParams.set(key, REDACTION_PLACEHOLDER)
      count++
    }
  }
  if (count === 0) return { url, removed }
  mergeRemovals(removed, 'apiKeyQueryParam', count)
  return { url: parsed.toString(), removed }
}

/** URL scrub: Basic-auth credentials, then sensitive query params. */
export function scrubUrlForShare(
  url: string,
  options: ShareScrubOptions = {},
): { url: string; removed: ShareScrubRemoval[] } {
  const removed: ShareScrubRemoval[] = []
  const afterAuth = scrubBasicAuthInUrl(url)
  removed.push(...afterAuth.removed)
  const paramNames = [...DEFAULT_SHARE_SCRUB_QUERY_PARAMS, ...(options.extraQueryParams ?? [])]
  const afterParams = scrubQueryParams(afterAuth.url, paramNames)
  for (const r of afterParams.removed) mergeRemovals(removed, r.category, r.count)
  return { url: afterParams.url, removed }
}

/** Header map scrub: values of sensitive header names are blanked; keys are preserved. */
export function scrubHeadersForShare(
  headers: Record<string, string> | undefined,
  options: ShareScrubOptions = {},
): { headers: Record<string, string> | undefined; removed: ShareScrubRemoval[] } {
  if (!headers) return { headers, removed: [] }
  const names = [...DEFAULT_SHARE_SCRUB_HEADERS, ...(options.extraHeaders ?? [])]
  const removed: ShareScrubRemoval[] = []
  let count = 0
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (isSensitiveHeader(k, names)) {
      out[k] = REDACTION_PLACEHOLDER
      count++
    } else {
      out[k] = v
    }
  }
  mergeRemovals(removed, 'header', count)
  return { headers: out, removed }
}

/**
 * Same scrub as `scrubHeadersForShare`, for the additive multi-value sibling
 * (`NetworkRequest.responseHeaderValues`) — every value in a sensitive name's
 * array is blanked, not just the first, so a caller that only scrubs
 * `headers` (the single folded value) can't leak the rest of a real
 * multi-value header (chiefly Set-Cookie) through this field into a shared
 * artifact.
 */
export function scrubHeaderValuesForShare(
  headerValues: Record<string, string[]> | undefined,
  options: ShareScrubOptions = {},
): { headerValues: Record<string, string[]> | undefined; removed: ShareScrubRemoval[] } {
  if (!headerValues) return { headerValues, removed: [] }
  const names = [...DEFAULT_SHARE_SCRUB_HEADERS, ...(options.extraHeaders ?? [])]
  const removed: ShareScrubRemoval[] = []
  let count = 0
  const out: Record<string, string[]> = {}
  for (const [k, values] of Object.entries(headerValues)) {
    if (isSensitiveHeader(k, names)) {
      out[k] = values.map(() => REDACTION_PLACEHOLDER)
      count++
    } else {
      out[k] = values
    }
  }
  mergeRemovals(removed, 'header', count)
  return { headerValues: out, removed }
}

/** Pattern-scan a plain-text string for bearer tokens, JWTs, and (optionally) emails. Applied to non-JSON bodies, and as a secondary catch-all pass over string leaves inside JSON bodies so a secret under an unlisted field name is still caught. */
function scrubPatternsInText(text: string, options: ShareScrubOptions): { text: string; removed: ShareScrubRemoval[] } {
  const removed: ShareScrubRemoval[] = []
  let out = text

  const bearerMatches = out.match(BEARER_RE)
  if (bearerMatches && bearerMatches.length > 0) {
    out = out.replace(BEARER_RE, `Bearer ${REDACTION_PLACEHOLDER}`)
    mergeRemovals(removed, 'bearerToken', bearerMatches.length)
  }

  const jwtMatches = out.match(JWT_RE)
  if (jwtMatches && jwtMatches.length > 0) {
    out = out.replace(JWT_RE, REDACTION_PLACEHOLDER)
    mergeRemovals(removed, 'jwt', jwtMatches.length)
  }

  if (options.scrubEmails ?? true) {
    const emailMatches = out.match(EMAIL_RE)
    if (emailMatches && emailMatches.length > 0) {
      out = out.replace(EMAIL_RE, REDACTION_PLACEHOLDER)
      mergeRemovals(removed, 'email', emailMatches.length)
    }
  }

  return { text: out, removed }
}

/** Walk parsed JSON, blanking values of scrub-listed field names and pattern-scanning every remaining string leaf. `depth` bounds recursion against pathological/hostile input, matching `bodyRedaction.ts`'s guard. */
function scrubJsonValue(
  value: unknown,
  fieldNames: Set<string>,
  options: ShareScrubOptions,
  removed: ShareScrubRemoval[],
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return value

  if (Array.isArray(value)) {
    return value.map((item) => scrubJsonValue(item, fieldNames, options, removed, depth + 1))
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (fieldNames.has(k.toLowerCase())) {
        result[k] = REDACTION_PLACEHOLDER
        mergeRemovals(removed, 'jsonField', 1)
      } else {
        result[k] = scrubJsonValue(v, fieldNames, options, removed, depth + 1)
      }
    }
    return result
  }

  if (typeof value === 'string') {
    const { text, removed: patternRemoved } = scrubPatternsInText(value, options)
    for (const r of patternRemoved) mergeRemovals(removed, r.category, r.count)
    return text
  }

  return value
}

/**
 * Scrub a request/response body for sharing. Tries JSON first (field-name scrub +
 * pattern scan on every string leaf, recursively — nested objects included); falls back
 * to a flat pattern scan for non-JSON or unparseable bodies. Never throws; a body this
 * function can't safely process is returned unchanged rather than dropped, since a
 * missing body is a worse debugging experience than one that MIGHT still carry a
 * pattern this scan does not know to look for (see module docblock's honesty note).
 */
export function scrubBodyForShare(
  body: string | null | undefined,
  options: ShareScrubOptions = {},
): { body: string | null | undefined; removed: ShareScrubRemoval[] } {
  if (body == null || body === '') return { body, removed: [] }

  const fieldNames = new Set(
    [...DEFAULT_SHARE_SCRUB_JSON_FIELDS, ...(options.extraJsonFields ?? [])].map((f) => f.toLowerCase()),
  )

  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed))) {
      const removed: ShareScrubRemoval[] = []
      const scrubbed = scrubJsonValue(parsed, fieldNames, options, removed, 0)
      if (removed.length === 0) return { body, removed: [] }
      return { body: JSON.stringify(scrubbed), removed }
    }
  } catch {
    // Not JSON — fall through to the plain-text pattern scan below.
  }

  const { text, removed } = scrubPatternsInText(body, options)
  return { body: text, removed }
}

/**
 * Scrub one `NetworkRequest` for a share-time artifact: URL (Basic auth + sensitive
 * query params), request/response headers, and request/response bodies. Returns a new
 * request object (the input is never mutated) plus the merged removal tally — empty
 * when nothing was found, so a caller can render "no secrets detected" honestly rather
 * than always claiming a scrub happened.
 */
export function scrubNetworkRequestForShare(
  request: NetworkRequest,
  options: ShareScrubOptions = {},
): { request: NetworkRequest; removed: ShareScrubRemoval[] } {
  const removed: ShareScrubRemoval[] = []

  const { url, removed: urlRemoved } = scrubUrlForShare(request.url, options)
  for (const r of urlRemoved) mergeRemovals(removed, r.category, r.count)

  const { headers: requestHeaders, removed: reqHeaderRemoved } = scrubHeadersForShare(request.requestHeaders, options)
  for (const r of reqHeaderRemoved) mergeRemovals(removed, r.category, r.count)

  const { headers: responseHeaders, removed: resHeaderRemoved } = scrubHeadersForShare(request.responseHeaders, options)
  for (const r of resHeaderRemoved) mergeRemovals(removed, r.category, r.count)

  const { headerValues: responseHeaderValues, removed: resHeaderValuesRemoved } = scrubHeaderValuesForShare(
    request.responseHeaderValues,
    options,
  )
  for (const r of resHeaderValuesRemoved) mergeRemovals(removed, r.category, r.count)

  const { body: requestBody, removed: reqBodyRemoved } = scrubBodyForShare(request.requestBody, options)
  for (const r of reqBodyRemoved) mergeRemovals(removed, r.category, r.count)

  const { body: responseBody, removed: resBodyRemoved } = scrubBodyForShare(request.responseBody, options)
  for (const r of resBodyRemoved) mergeRemovals(removed, r.category, r.count)

  const scrubbed: NetworkRequest = {
    ...request,
    url,
    ...(request.requestHeaders !== undefined ? { requestHeaders } : {}),
    ...(request.responseHeaders !== undefined ? { responseHeaders } : {}),
    ...(request.responseHeaderValues !== undefined ? { responseHeaderValues } : {}),
    ...(request.requestBody !== undefined ? { requestBody } : {}),
    ...(request.responseBody !== undefined ? { responseBody } : {}),
  }

  return { request: scrubbed, removed }
}

/** Scrub a batch of requests, merging every request's removal tally into one summary. */
export function scrubRequestsForShare(
  requests: NetworkRequest[],
  options: ShareScrubOptions = {},
): { requests: NetworkRequest[]; removed: ShareScrubRemoval[] } {
  const removed: ShareScrubRemoval[] = []
  const scrubbed = requests.map((r) => {
    const result = scrubNetworkRequestForShare(r, options)
    for (const item of result.removed) mergeRemovals(removed, item.category, item.count)
    return result.request
  })
  return { requests: scrubbed, removed }
}

/** Whether to report scrubbing on an artifact and, if so, what was removed. Attach this shape to any bundle/export type that goes through this module so silence never stands in for "nothing was found." */
export interface ShareScrubSummary {
  /** Whether the scrub pass ran at all (vs. the caller opting out entirely). */
  applied: boolean
  /** Empty when the pass ran but found nothing to remove. */
  removed: ShareScrubRemoval[]
}

/** Human-readable one-liner for `ShareScrubSummary`, e.g. "scrubbed 2 headers, 1 JSON field, 1 bearer token before sharing". Used anywhere a share surface renders text (agent-context preamble, CLI/MCP messaging) rather than only structured JSON. */
export function describeShareScrub(summary: ShareScrubSummary): string {
  if (!summary.applied) return 'Share-time scrubbing was not applied to this artifact.'
  if (summary.removed.length === 0) return 'Share-time scrubbing ran; nothing matched the scrub patterns.'
  const parts = summary.removed.map((r) => `${r.count} ${categoryLabel(r.category, r.count)}`)
  return `Scrubbed before sharing: ${parts.join(', ')}. This is pattern-based, not a full secret scan — see docs/security/share-scrubbing.`
}

function categoryLabel(category: ShareScrubCategory, count: number): string {
  const plural = count === 1 ? '' : 's'
  switch (category) {
    case 'header':
      return `header${plural}`
    case 'jsonField':
      return `JSON field${plural}`
    case 'bearerToken':
      return `bearer token${plural}`
    case 'jwt':
      return `JWT${plural}`
    case 'apiKeyQueryParam':
      return `query param${plural}`
    case 'basicAuthUrl':
      return `Basic-auth URL credential${plural}`
    case 'email':
      return `email address${plural}`
  }
}
