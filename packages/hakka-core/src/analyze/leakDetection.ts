import type { NetworkRequest } from '../model/types'
import { parseRequestCookies } from '../utils/cookies'
import { extractHost } from '../utils/domainUtils'
import { hostMatchesList } from '../utils/hostFilter'
import { DEFAULT_SHARE_SCRUB_JSON_FIELDS, DEFAULT_SHARE_SCRUB_QUERY_PARAMS } from '../utils/shareScrub'

/**
 * Leak detection — the offensive half of redaction. `bodyRedaction.ts` and
 * `shareScrub.ts` hide secrets on the way OUT of this machine; this module tells the
 * developer their app already sent one somewhere it should not have. A network
 * inspector sees every byte an app sends and, uniquely among proxies, knows which
 * hosts are the developer's own — that is the product here, not a generic secret
 * scanner.
 *
 * Pure, synchronous functions over already-captured `NetworkRequest[]`. No IO, no
 * network calls, no mutation of the input — every surface (desktop UI, MCP tool, CI
 * check, web overlay) calls the same code over its own capture pool.
 *
 * False positives are the failure mode that kills this feature faster than false
 * negatives: a security check that cries wolf gets muted within a week and then
 * misses the real thing. Every detector below is written to stay silent rather than
 * guess, and each finding carries the exact evidence (host, header/param/field name, a
 * masked preview) that produced it so a developer can judge it in one glance instead
 * of trusting a score.
 *
 * What this deliberately does NOT do (see each detector's docblock for the specific
 * reasoning):
 *  - Flag a bare digit sequence as a phone number. Order IDs, timestamps, and zip
 *    codes are digit sequences too; the false-positive rate would be enormous.
 *  - Flag the first-ever request to a brand-new endpoint as a "new field" leak — there
 *    is no baseline yet, so there is nothing to compare against.
 *  - Try to recover the plaintext of a masked value, or print a value large enough to
 *    itself become the leak the finding is warning about.
 *  - Score or rank leaks beyond a two-level confidence (`high` / `medium`). Nobody
 *    triages five severities on a network inspector's findings panel.
 */

export type LeakConfidence = 'high' | 'medium'

export type LeakKind = 'credential-to-third-party' | 'new-pii-field' | 'pii-in-url' | 'credential-in-cacheable-place'

/** What was found and where — the reason a developer can judge a finding without trusting a score. */
export interface LeakEvidence {
  /** Human-readable location, e.g. `request header "authorization"`, `query param "token"`, `response body field "apiKey"`. */
  location: string
  /** Masked preview of the offending value. Never the raw secret — see {@link maskPreview}. */
  preview: string
}

export interface LeakFinding {
  kind: LeakKind
  confidence: LeakConfidence
  /** One-line, human-readable explanation, evidence already folded in. */
  message: string
  requestId: string
  url: string
  method: string
  evidence: LeakEvidence[]
}

/** Per-endpoint baseline: every field path observed so far, plus how many requests contributed to it (the trust threshold `newFieldBaselineMin` checks against). Keyed by `"METHOD path"`. Opaque to callers; obtained from {@link detectLeaks}'s result and threaded back into a later call so a baseline can persist across sessions instead of resetting every call. */
export interface EndpointFieldBaseline {
  count: number
  fields: string[]
}
export type FieldBaseline = Record<string, EndpointFieldBaseline>

export interface LeakDetectionOptions {
  /**
   * Host patterns (exact hostname or glob, same grammar as `hostMatchesList` — see
   * `hostFilter.ts`) that are the developer's own infrastructure. A credential sent to
   * any host NOT matching this list is flagged.
   *
   * Default (when omitted): auto-inferred as the single host that received a strict
   * majority (> baseline requests to it, and more than every other host individually)
   * of the captured requests, provided the capture has at least
   * {@link LeakDetectionOptions.minRequestsForInference} requests. In a debugging
   * session the developer's own backend is overwhelmingly the busiest host; everything
   * else — analytics SDKs, ad networks, error reporters — is where a credential
   * genuinely should not travel. Neither "everything is first party" (never fires) nor
   * "nothing is first party" (fires on the developer's own paginated API calls) is
   * useful as a default; a data-driven majority host is. When the capture is too small
   * or too flat (no majority host) to infer confidently, credential-to-third-party
   * detection is skipped entirely rather than guessing — see
   * {@link LeakDetectionResult.firstPartyHostsUsed}, which is empty in that case.
   */
  firstPartyHosts?: string[]
  /** Minimum total requests before auto-inferring a first-party host. Default 3. */
  minRequestsForInference?: number
  /** A field baseline from a prior call (or a prior session), extended by what `requests` itself teaches. */
  fieldBaseline?: FieldBaseline
  /** Minimum prior observations of an endpoint before "new field" detection activates for it. Default 3 — see `detectNewPiiFields` docblock for why. */
  newFieldBaselineMin?: number
  /** Cap on findings returned. Default 50. */
  maxFindings?: number
}

export interface LeakDetectionResult {
  findings: LeakFinding[]
  /** The first-party host set actually used. Explicit `options.firstPartyHosts` if given; the inferred majority host if inference succeeded; empty if neither. */
  firstPartyHostsUsed: string[]
  /** The field baseline after folding in everything observed in this call — pass back into the next call's `fieldBaseline` to carry it forward. */
  fieldBaseline: FieldBaseline
  /** One-line rollup, honest about zero findings rather than silent. */
  summary: string
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const MAX_FIELD_DEPTH = 8

/** Same JWT shape shareScrub.ts pattern-scans for: three dot-separated base64url segments. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{3,}\b/

/** "Bearer <token>" — same loose shape as shareScrub.ts (false negatives cost more than false positives here). */
const BEARER_RE = /^Bearer\s+([A-Za-z0-9._~+/=-]{8,})$/i

/** Conservative header names that carry an API key by convention (not a generic "token" name — that is covered by the JWT/Bearer checks and by DEFAULT_SHARE_SCRUB_QUERY_PARAMS for query params). */
const API_KEY_HEADER_RE = /^(x-api-key|api-key|x-.*-api-key)$/i

/** Well-known session-cookie names. Deliberately a fixed, well-known list rather than "any cookie" — an arbitrary app cookie (a theme preference, an A/B bucket) is not a credential, and guessing would be the exact false-positive failure this module exists to avoid. */
const SESSION_COOKIE_NAME_RE =
  /^(sessionid|sess|connect\.sid|jsessionid|phpsessid|asp\.net_sessionid|sid|session|session_token|sessiontoken)$/i

/** Query param names treated as credential-bearing, reusing share-scrub's own opinion of what a credential-shaped param looks like rather than inventing a second list. */
const CREDENTIAL_QUERY_PARAM_NAMES = new Set(DEFAULT_SHARE_SCRUB_QUERY_PARAMS.map((n) => n.toLowerCase()))

/** JSON body field names treated as credential-bearing when scanning a response body for detector 4b. */
const CREDENTIAL_JSON_FIELD_NAMES = new Set(DEFAULT_SHARE_SCRUB_JSON_FIELDS.map((n) => n.toLowerCase()))

/** PII-shaped field names — the "quietly started carrying an email/phone/device id" signal for detector 2. Name-based, not value-based: a value-based email/phone scan already exists for URLs (detector 3); reusing it against every body field on every request would be far too broad a surface for a name-based baseline comparison to stay precise. */
const PII_FIELD_NAME_RE =
  /^(email|email_address|emailaddress|phone|phone_number|phonenumber|mobile|mobile_number|deviceid|device_id|udid|imei|advertising_id|advertisingid|idfa|gaid|ssn|social_security_number)$/i

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/
/** Strict E.164-ish phone shape: leading `+`, country code, 7-15 digits total. Never matched against a bare digit run — see module docblock. */
const STRICT_PHONE_RE = /^\+[1-9]\d{6,14}$/

const REDACTED_MARKERS = new Set(['[REDACTED]', '██', '████████'])

function isAlreadyRedacted(value: string): boolean {
  return REDACTED_MARKERS.has(value)
}

/** Mask a secret for display in a finding: never the raw value, just enough to let a developer recognize which credential it is. */
function maskPreview(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length)
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

function headerEntries(headers: Record<string, string> | undefined): Array<[string, string]> {
  return headers ? Object.entries(headers) : []
}

function tryParseJson(body: string | null | undefined): unknown {
  if (!body) return undefined
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Detector 1 — credential to a non-first-party host
// ---------------------------------------------------------------------------

interface CredentialMatch {
  location: string
  preview: string
}

/** Scan one request's headers, cookies, and query string for credential-shaped values. Deliberately does NOT scan bodies here — a credential a developer's own app sends in ITS OWN request body to ITS OWN backend is normal; this detector is about transport-level credential exposure (headers/cookies/URLs), which is what actually reaches a third party's server logs regardless of body content. */
function findCredentialsInTransport(req: NetworkRequest): CredentialMatch[] {
  const matches: CredentialMatch[] = []

  for (const [name, value] of headerEntries(req.requestHeaders)) {
    if (!value || isAlreadyRedacted(value)) continue
    if (/^authorization$/i.test(name)) {
      const bearer = BEARER_RE.exec(value)
      if (bearer) {
        matches.push({ location: `request header "${name}"`, preview: maskPreview(bearer[1]!) })
        continue
      }
      if (JWT_RE.test(value)) {
        matches.push({ location: `request header "${name}"`, preview: maskPreview(value) })
        continue
      }
      // Any other Authorization value (e.g. Basic) is still a credential in transit.
      matches.push({ location: `request header "${name}"`, preview: maskPreview(value) })
      continue
    }
    if (API_KEY_HEADER_RE.test(name)) {
      matches.push({ location: `request header "${name}"`, preview: maskPreview(value) })
      continue
    }
    if (JWT_RE.test(value)) {
      matches.push({ location: `request header "${name}"`, preview: maskPreview(value) })
    }
  }

  const cookieHeader = req.requestHeaders && (req.requestHeaders['cookie'] ?? req.requestHeaders['Cookie'])
  for (const cookie of parseRequestCookies(cookieHeader)) {
    if (!cookie.value || isAlreadyRedacted(cookie.value)) continue
    if (SESSION_COOKIE_NAME_RE.test(cookie.name)) {
      matches.push({ location: `cookie "${cookie.name}"`, preview: maskPreview(cookie.value) })
    }
  }

  let parsed: URL | undefined
  try {
    parsed = new URL(req.url)
  } catch {
    parsed = undefined
  }
  if (parsed) {
    for (const [key, value] of parsed.searchParams) {
      if (!value || isAlreadyRedacted(value)) continue
      if (CREDENTIAL_QUERY_PARAM_NAMES.has(key.toLowerCase()) || JWT_RE.test(value)) {
        matches.push({ location: `query param "${key}"`, preview: maskPreview(value) })
      }
    }
  }

  return matches
}

/**
 * The single host that received a strict majority of `requests` — more than every
 * other individual host — or `undefined` if there is no such host (a flat
 * distribution, or too few requests to trust the signal).
 */
function inferPrimaryHost(requests: readonly NetworkRequest[], minRequests: number): string | undefined {
  if (requests.length < minRequests) return undefined
  const counts = new Map<string, number>()
  for (const req of requests) {
    const host = extractHost(req.url)
    counts.set(host, (counts.get(host) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  const runnerUp = sorted[1]
  if (!top) return undefined
  if (runnerUp && runnerUp[1] === top[1]) return undefined // tie — no clear majority, stay silent
  return top[0]
}

function detectCredentialToThirdParty(
  requests: readonly NetworkRequest[],
  firstPartyHosts: readonly string[],
): LeakFinding[] {
  if (firstPartyHosts.length === 0) return []
  const findings: LeakFinding[] = []
  for (const req of requests) {
    const host = extractHost(req.url)
    if (hostMatchesList(host, firstPartyHosts as string[])) continue
    const matches = findCredentialsInTransport(req)
    if (matches.length === 0) continue
    findings.push({
      kind: 'credential-to-third-party',
      confidence: 'high',
      message: `${req.method} ${pathOf(req.url)} sent a credential to ${host}, which is outside the first-party allowlist (${firstPartyHosts.join(', ')})`,
      requestId: req.id,
      url: req.url,
      method: req.method,
      evidence: matches,
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Detector 2 — a PII-shaped field appearing for the first time on an endpoint
// ---------------------------------------------------------------------------

function endpointKey(req: NetworkRequest): string {
  return `${req.method.toUpperCase()} ${pathOf(req.url)}`
}

/** Collect dotted field paths whose leaf key matches `PII_FIELD_NAME_RE`, walking parsed JSON up to a bounded depth. */
function collectPiiFieldPaths(value: unknown, prefix: string, depth: number, out: Set<string>): void {
  if (depth > MAX_FIELD_DEPTH || value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) collectPiiFieldPaths(item, prefix, depth + 1, out)
    return
  }
  if (typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (PII_FIELD_NAME_RE.test(key)) out.add(path.toLowerCase())
      collectPiiFieldPaths(v, path, depth + 1, out)
    }
  }
}

/**
 * Flag a request whose body carries a PII-shaped field an endpoint's earlier requests
 * never carried — the shape of a third-party SDK update that quietly starts sending an
 * email, phone number, or device id.
 *
 * Confidence is `medium`, not `high`: this is an inference over a limited, in-session
 * sample, not a structural fact like a credential in a header. Two guards keep the
 * false-positive rate down:
 *  - An endpoint needs `newFieldBaselineMin` (default 3) prior observations before its
 *    baseline is trusted at all — the very first call to a brand-new endpoint
 *    legitimately introduces every field it has, and flagging that would be pure noise.
 *  - Only PII-NAMED fields matter here (email/phone/device-id shapes), not "any new
 *    key" — most new keys are unremarkable API evolution (a new `couponCode` field is
 *    not a leak).
 */
function detectNewPiiFields(
  requests: readonly NetworkRequest[],
  priorBaseline: FieldBaseline,
  newFieldBaselineMin: number,
): { findings: LeakFinding[]; updatedBaseline: FieldBaseline } {
  const findings: LeakFinding[] = []
  // endpoint -> (seen field paths, observation count), seeded from the prior baseline.
  const seenFields = new Map<string, Set<string>>()
  const observationCount = new Map<string, number>()
  for (const [key, entry] of Object.entries(priorBaseline)) {
    seenFields.set(key, new Set(entry.fields))
    observationCount.set(key, entry.count)
  }

  const ordered = [...requests].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))

  for (const req of ordered) {
    const parsed = tryParseJson(req.requestBody)
    if (parsed === undefined || parsed === null || typeof parsed !== 'object') continue

    const key = endpointKey(req)
    const priorCount = observationCount.get(key) ?? 0
    const priorFields = seenFields.get(key)
    const priorFieldsTrusted = priorCount >= newFieldBaselineMin && priorFields != null

    const currentFields = new Set<string>()
    collectPiiFieldPaths(parsed, '', 0, currentFields)

    if (priorFieldsTrusted) {
      const newOnes = [...currentFields].filter((f) => !priorFields!.has(f))
      if (newOnes.length > 0) {
        findings.push({
          kind: 'new-pii-field',
          confidence: 'medium',
          message: `${req.method} ${pathOf(req.url)} now carries ${newOnes.map((f) => `"${f}"`).join(', ')} — not present in the prior ${priorCount} requests to this endpoint. This is the shape of a third-party SDK update quietly starting to send PII.`,
          requestId: req.id,
          url: req.url,
          method: req.method,
          evidence: newOnes.map((f) => ({ location: `request body field "${f}"`, preview: '(PII-shaped field name)' })),
        })
      }
    }

    // Fold this request into the running baseline regardless of whether it fired.
    const merged = priorFields ? new Set(priorFields) : new Set<string>()
    for (const f of currentFields) merged.add(f)
    seenFields.set(key, merged)
    observationCount.set(key, priorCount + 1)
  }

  const updatedBaseline: FieldBaseline = {}
  for (const [key, fields] of seenFields) {
    updatedBaseline[key] = { count: observationCount.get(key) ?? 0, fields: [...fields] }
  }
  return { findings, updatedBaseline }
}

// ---------------------------------------------------------------------------
// Detector 3 — PII in a URL or query string
// ---------------------------------------------------------------------------

/**
 * Flag an email address anywhere in a URL, or a strict E.164-shaped phone number in a
 * query param whose name signals it is a phone number. A URL is worse than a body for
 * the same PII: it lands in server access logs, reverse-proxy logs, and browser
 * history verbatim, none of which get the redaction a body might.
 *
 * Phone numbers are deliberately narrow: only `+`-prefixed E.164 shapes in a
 * phone-named param. A bare digit run (`?order=48213`, `?ts=1700000000`) is not
 * trusted as a phone number under any circumstance — the false-positive rate on "any
 * long digit string" would be enormous on a typical API surface (order IDs,
 * timestamps, pagination cursors, zip codes).
 */
function detectPiiInUrl(requests: readonly NetworkRequest[]): LeakFinding[] {
  const findings: LeakFinding[] = []
  for (const req of requests) {
    let parsed: URL
    try {
      parsed = new URL(req.url)
    } catch {
      continue
    }

    const evidence: LeakEvidence[] = []

    const pathEmail = EMAIL_RE.exec(parsed.pathname)
    if (pathEmail) evidence.push({ location: 'URL path', preview: maskPreview(pathEmail[0]) })

    for (const [key, value] of parsed.searchParams) {
      if (!value || isAlreadyRedacted(value)) continue
      const email = EMAIL_RE.exec(value)
      if (email) {
        evidence.push({ location: `query param "${key}"`, preview: maskPreview(email[0]) })
        continue
      }
      if (/phone|mobile|tel$/i.test(key) && STRICT_PHONE_RE.test(value)) {
        evidence.push({ location: `query param "${key}"`, preview: maskPreview(value) })
      }
    }

    if (evidence.length === 0) continue
    findings.push({
      kind: 'pii-in-url',
      confidence: 'high',
      message: `${req.method} ${pathOf(req.url)} carries PII in the URL — this lands in server logs, proxy logs, and browser history even where a body would have been redacted`,
      requestId: req.id,
      url: req.url,
      method: req.method,
      evidence,
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Detector 4 — a secret in a place that gets cached
// ---------------------------------------------------------------------------

/** Whether a response's Cache-Control (plus Expires as a fallback signal) indicates the response is explicitly intended to be cached. Requires a positive signal (`public`, or `max-age` > 0) and the absence of `no-store` — silence on caching headers is NOT treated as "cacheable," since guessing browser default-heuristic caching would be exactly the kind of unfounded inference this module avoids. */
function isExplicitlyCacheable(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false
  const cacheControl = (headers['cache-control'] ?? headers['Cache-Control'] ?? '').toLowerCase()
  if (cacheControl.includes('no-store')) return false
  if (cacheControl.includes('public')) return true
  const maxAge = /max-age=(\d+)/.exec(cacheControl)
  if (maxAge && Number(maxAge[1]) > 0) return true
  return false
}

/** Scan a parsed JSON response body for credential-named fields, shallowly (one level plus nested objects), for detector 4b. */
function findCredentialFieldsInJson(value: unknown, prefix: string, depth: number, out: CredentialMatch[]): void {
  if (depth > MAX_FIELD_DEPTH || value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) findCredentialFieldsInJson(item, prefix, depth + 1, out)
    return
  }
  if (typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (CREDENTIAL_JSON_FIELD_NAMES.has(key.toLowerCase()) && typeof v === 'string' && v && !isAlreadyRedacted(v)) {
        out.push({ location: `response body field "${path}"`, preview: maskPreview(v) })
      } else {
        findCredentialFieldsInJson(v, path, depth + 1, out)
      }
    }
  }
}

/**
 * Two independent sub-checks, both about a credential landing somewhere durable and
 * shared rather than the ephemeral request/response cycle:
 *  (a) a credential-shaped value in a GET request's query string — query strings are
 *      recorded verbatim in server access logs, reverse-proxy logs, and browser
 *      history regardless of any cache-control the response later sends;
 *  (b) a response explicitly marked cacheable whose JSON body carries a
 *      credential-named field — a cache is a second place that secret now lives,
 *      outliving the request that produced it.
 */
function detectCredentialInCacheablePlace(requests: readonly NetworkRequest[]): LeakFinding[] {
  const findings: LeakFinding[] = []
  for (const req of requests) {
    const evidence: LeakEvidence[] = []

    if (req.method.toUpperCase() === 'GET') {
      let parsed: URL | undefined
      try {
        parsed = new URL(req.url)
      } catch {
        parsed = undefined
      }
      if (parsed) {
        for (const [key, value] of parsed.searchParams) {
          if (!value || isAlreadyRedacted(value)) continue
          if (CREDENTIAL_QUERY_PARAM_NAMES.has(key.toLowerCase()) || JWT_RE.test(value)) {
            evidence.push({
              location: `GET query param "${key}"`,
              preview: maskPreview(value),
            })
          }
        }
      }
    }

    if (isExplicitlyCacheable(req.responseHeaders)) {
      const parsedBody = tryParseJson(req.responseBody)
      if (parsedBody !== undefined) {
        findCredentialFieldsInJson(parsedBody, '', 0, evidence)
      }
    }

    if (evidence.length === 0) continue
    findings.push({
      kind: 'credential-in-cacheable-place',
      confidence: 'high',
      message: `${req.method} ${pathOf(req.url)} carries a credential somewhere that gets cached (a GET query string, or a response explicitly marked cacheable) — this persists past the single request`,
      requestId: req.id,
      url: req.url,
      method: req.method,
      evidence,
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<LeakConfidence, number> = { high: 0, medium: 1 }

function buildSummary(findings: readonly LeakFinding[], firstPartyHostsUsed: readonly string[]): string {
  if (findings.length === 0) {
    return firstPartyHostsUsed.length === 0
      ? 'No leaks detected. Credential-to-third-party detection needs a first-party allowlist (or enough traffic to infer one) to run.'
      : 'No leaks detected.'
  }
  const byKind = new Map<LeakKind, number>()
  for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1)
  const parts = [...byKind.entries()].map(([kind, count]) => `${count} ${kind}`)
  return `${findings.length} potential leak${findings.length === 1 ? '' : 's'}: ${parts.join(', ')}.`
}

/**
 * Run every leak detector over a captured request pool. Pure and synchronous — no IO,
 * no mutation of `requests`. See the module docblock for the product framing and each
 * detector's docblock for its specific confidence story and false-positive guards.
 */
export function detectLeaks(
  requests: readonly NetworkRequest[],
  options: LeakDetectionOptions = {},
): LeakDetectionResult {
  const minRequestsForInference = options.minRequestsForInference ?? 3
  const newFieldBaselineMin = options.newFieldBaselineMin ?? 3
  const maxFindings = options.maxFindings ?? 50

  const firstPartyHostsUsed =
    options.firstPartyHosts && options.firstPartyHosts.length > 0
      ? options.firstPartyHosts
      : (() => {
          const inferred = inferPrimaryHost(requests, minRequestsForInference)
          return inferred ? [inferred] : []
        })()

  const findings: LeakFinding[] = []
  findings.push(...detectCredentialToThirdParty(requests, firstPartyHostsUsed))

  const { findings: newFieldFindings, updatedBaseline } = detectNewPiiFields(
    requests,
    options.fieldBaseline ?? {},
    newFieldBaselineMin,
  )
  findings.push(...newFieldFindings)

  findings.push(...detectPiiInUrl(requests))
  findings.push(...detectCredentialInCacheablePlace(requests))

  findings.sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence])
  const ranked = findings.slice(0, maxFindings)

  return {
    findings: ranked,
    firstPartyHostsUsed,
    fieldBaseline: updatedBaseline,
    summary: buildSummary(ranked, firstPartyHostsUsed),
  }
}
