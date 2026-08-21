/**
 * Data-exfiltration regression check — requirement #4 in the repo prompt,
 * and "the strongest single reason to adopt this": fail the build when a
 * credential-shaped field is sent to a host the baseline never contacted.
 *
 * This runs independently of `diffBaseline` (it needs `diff.ts`'s `new-host`
 * signal, but not the baseline's endpoint/status/shape history), and it is
 * the one check in this feature that reads request VALUES rather than only
 * shapes — deliberately, since a credential is defined by its value, not by
 * being present in some field.
 *
 * Detection is name-based FIRST (a field whose key matches a known-sensitive
 * name — reusing `hakka-core`'s `DEFAULT_SHARE_SCRUB_JSON_FIELDS`, the same
 * list the app already trusts to identify secrets for share-time scrubbing),
 * plus a JWT-shape pattern match as a second, structure-based signal.
 *
 * False-positive story: deliberately NOT entropy-based. A generic
 * high-entropy-string heuristic ("this looks random, therefore secret") has
 * a bad false-positive rate against ordinary opaque ids, hashes, and
 * session/request identifiers that are not secrets — it would make this
 * check exactly the kind of flaky gate a team disables within a week (see
 * the repo prompt's warning). Instead:
 *   - name-based match: low false-positive rate because the field names in
 *     `DEFAULT_SHARE_SCRUB_JSON_FIELDS` (password, token, apiKey, secret,
 *     ssn, creditCard, ...) are specific; the cost of a false positive here
 *     is a field named e.g. `sessionToken` that happens to hold a non-secret
 *     value, which is rare and usually still worth a human's look.
 *   - JWT-shape match: three dot-separated base64url segments is a very
 *     distinctive structure with essentially no legitimate false-positive
 *     class in a request body.
 *   - query-param match: same name list as request-body fields, applied to
 *     the URL's own query string, since a credential exfiltrated via `?
 *     token=...` is just as real as one in a JSON body.
 * A field name match on a KNOWN (baseline) host is not flagged at all — the
 * check only fires where both signals are present: a sensitive-shaped value,
 * AND a host this run has never talked to before.
 */
import type { NetworkRequest } from 'hakka-core'
import { DEFAULT_SHARE_SCRUB_JSON_FIELDS } from 'hakka-core'

import { hostOf } from './normalize'

export interface ExfiltrationFinding {
  severity: 'fail'
  host: string
  url: string
  /** What matched: a field name, or `'jwt-shaped value'` for the structural match. */
  reason: string
}

// Mirrors hakka-core's shareScrub JWT pattern intentionally (see module doc) — three
// dot-separated base64url segments of meaningful length.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{3,}\b/

function sensitiveFieldNames(extra: string[] = []): Set<string> {
  return new Set([...DEFAULT_SHARE_SCRUB_JSON_FIELDS, ...extra].map((f) => f.toLowerCase()))
}

/** Walk parsed JSON for a key whose name is in `fieldNames`, returning the first match's key. `null` if none found. Bounded depth against pathological input. */
function findSensitiveField(value: unknown, fieldNames: ReadonlySet<string>, depth = 0): string | null {
  if (depth > 100) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSensitiveField(item, fieldNames, depth + 1)
      if (found) return found
    }
    return null
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (fieldNames.has(k.toLowerCase())) return k
      const found = findSensitiveField(v, fieldNames, depth + 1)
      if (found) return found
    }
  }
  return null
}

function findSensitiveQueryParam(url: string, fieldNames: ReadonlySet<string>): string | null {
  try {
    const parsed = new URL(url)
    for (const key of parsed.searchParams.keys()) {
      if (fieldNames.has(key.toLowerCase())) return key
    }
  } catch {
    // Not an absolute URL — nothing to parse; the body/JWT checks still apply.
  }
  return null
}

export interface ExfiltrationCheckOptions {
  /** Hosts this run is allowed to contact with sensitive-shaped data — typically the baseline's known hosts. Any host NOT in this set is "new" for this check. */
  knownHosts: ReadonlySet<string>
  /** Extra sensitive field names, in addition to `DEFAULT_SHARE_SCRUB_JSON_FIELDS`. */
  extraSensitiveFields?: string[]
}

/**
 * Scan captured requests for credential-shaped data sent to a host outside
 * `knownHosts`. Pure — no I/O — the CLI layer decides how to report/exit.
 */
export function findExfiltrationFindings(
  requests: readonly NetworkRequest[],
  options: ExfiltrationCheckOptions,
): ExfiltrationFinding[] {
  const fieldNames = sensitiveFieldNames(options.extraSensitiveFields)
  const findings: ExfiltrationFinding[] = []

  for (const req of requests) {
    const host = hostOf(req.url)
    if (host === null || options.knownHosts.has(host)) continue

    const queryField = findSensitiveQueryParam(req.url, fieldNames)
    if (queryField) {
      findings.push({ severity: 'fail', host, url: req.url, reason: `query param "${queryField}"` })
      continue
    }

    if (req.requestBody) {
      try {
        const parsed: unknown = JSON.parse(req.requestBody)
        const field = findSensitiveField(parsed, fieldNames)
        if (field) {
          findings.push({ severity: 'fail', host, url: req.url, reason: `request body field "${field}"` })
          continue
        }
      } catch {
        // Not JSON — fall through to the plain-text JWT scan below, which
        // works on any body regardless of content type.
      }
      if (JWT_RE.test(req.requestBody)) {
        findings.push({ severity: 'fail', host, url: req.url, reason: 'JWT-shaped value in request body' })
        continue
      }
    }

    const authHeader = req.requestHeaders?.['authorization'] ?? req.requestHeaders?.['Authorization']
    if (authHeader) {
      findings.push({ severity: 'fail', host, url: req.url, reason: 'Authorization header present' })
    }
  }

  return findings
}

/** Plain-text report for CI log output — no ANSI colour. */
export function formatExfiltrationReport(findings: readonly ExfiltrationFinding[]): string {
  if (findings.length === 0) return 'No exfiltration findings — no credential-shaped data sent to an unrecognized host.'
  const lines = [`EXFILTRATION RISK (${findings.length}):`]
  for (const f of findings) {
    lines.push(`  [new-host-credential] ${f.reason} sent to ${f.host} (${f.url})`)
  }
  return lines.join('\n')
}
