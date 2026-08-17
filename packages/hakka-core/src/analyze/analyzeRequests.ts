import type { NetworkRequest } from '../model/types'

/**
 * Request diagnosis — a structured "why is this broken / slow / risky" analysis
 * over a set of captured requests. Built as a pure function so it can back the
 * `diagnose` MCP tool (an AI agent's one-call answer to "why did checkout fail"),
 * a web audit panel, and the agent-readable session export.
 */

export type DiagnosisSeverity = 'error' | 'warning' | 'info'

export type DiagnosisKind = 'failure' | 'auth' | 'slow' | 'secret-in-body' | 'oversized' | 'uncacheable' | 'repeated'

export interface DiagnosisFinding {
  severity: DiagnosisSeverity
  kind: DiagnosisKind
  message: string
  requestId?: string
  url?: string
}

export interface SlowRequest {
  id: string
  url: string
  durationMs: number
}

export interface RequestDiagnosis {
  total: number
  failed: number
  slowest: SlowRequest[]
  findings: DiagnosisFinding[]
  /** One-line, agent- and human-readable rollup. */
  summary: string
}

export interface AnalyzeOptions {
  /** A request slower than this (ms) is flagged. Default 1000. */
  slowMs?: number
  /** A response body larger than this (bytes) is flagged. Default 1 MB. */
  oversizedBytes?: number
  /** The same method+url repeated more than this many times is flagged (N+1). Default 4. */
  repeatedThreshold?: number
  /** Cap on findings returned (ranked most-severe first). Default 50. */
  maxFindings?: number
  /** How many slowest requests to list. Default 5. */
  maxSlowest?: number
}

const SECRET_KEY =
  /"(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret|authorization)"\s*:\s*"([^"]+)"/gi
const SEVERITY_RANK: Record<DiagnosisSeverity, number> = { error: 0, warning: 1, info: 2 }

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Short human hint for a failing request. */
function failureCause(req: NetworkRequest): string {
  if (req.error) return req.error
  switch (req.status) {
    case 401:
      return 'authentication required (missing or invalid credentials)'
    case 403:
      return 'forbidden (insufficient permissions)'
    case 404:
      return 'not found'
    case 408:
    case 504:
      return 'timeout'
    case 409:
      return 'conflict'
    case 422:
      return 'validation failed'
    case 429:
      return 'rate limited'
    default:
      if (req.status != null && req.status >= 500) return 'server error'
      return 'request failed'
  }
}

function bodySnippet(body: string | null | undefined, max = 160): string {
  if (!body) return ''
  const trimmed = body.trim().replace(/\s+/g, ' ')
  return trimmed.length > max ? ` — ${trimmed.slice(0, max)}…` : ` — ${trimmed}`
}

/** Analyze a set of captured requests into a ranked diagnosis. */
export function analyzeRequests(requests: readonly NetworkRequest[], options: AnalyzeOptions = {}): RequestDiagnosis {
  const slowMs = options.slowMs ?? 1000
  const oversizedBytes = options.oversizedBytes ?? 1_000_000
  const repeatedThreshold = options.repeatedThreshold ?? 4
  const maxFindings = options.maxFindings ?? 50
  const maxSlowest = options.maxSlowest ?? 5

  const findings: DiagnosisFinding[] = []
  let failed = 0

  const isFailure = (r: NetworkRequest) => Boolean(r.error) || (r.status != null && r.status >= 400)

  for (const req of requests) {
    const path = pathOf(req.url)

    if (isFailure(req)) {
      failed += 1
      const isAuth = req.status === 401 || req.status === 403
      const severity: DiagnosisSeverity =
        req.error != null || (req.status != null && req.status >= 500) ? 'error' : 'warning'
      findings.push({
        severity,
        kind: isAuth ? 'auth' : 'failure',
        message: `${req.method} ${path} → ${req.status ?? 'ERR'}: ${failureCause(req)}${bodySnippet(req.responseBody)}`,
        requestId: req.id,
        url: req.url,
      })
    }

    if (req.duration != null && req.duration > slowMs) {
      findings.push({
        severity: 'warning',
        kind: 'slow',
        message: `${req.method} ${path} took ${Math.round(req.duration)}ms (> ${slowMs}ms)`,
        requestId: req.id,
        url: req.url,
      })
    }

    // Plaintext secret in a request body that redaction did not mask.
    if (req.requestBody) {
      SECRET_KEY.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = SECRET_KEY.exec(req.requestBody)) !== null) {
        const value = m[2]
        if (value && value !== '[REDACTED]') {
          findings.push({
            severity: 'warning',
            kind: 'secret-in-body',
            message: `${req.method} ${path} sends a plaintext "${m[1]}" in its body — configure body redaction`,
            requestId: req.id,
            url: req.url,
          })
          break
        }
      }
    }

    if (req.responseBodySize != null && req.responseBodySize > oversizedBytes) {
      findings.push({
        severity: 'info',
        kind: 'oversized',
        message: `${req.method} ${path} returned ${(req.responseBodySize / 1_000_000).toFixed(1)} MB`,
        requestId: req.id,
        url: req.url,
      })
    }

    // Cacheable GETs that ship no caching hints.
    if (req.method.toUpperCase() === 'GET' && req.status === 200 && req.responseHeaders) {
      const headers = Object.keys(req.responseHeaders).map((h) => h.toLowerCase())
      if (!headers.includes('cache-control') && !headers.includes('etag')) {
        findings.push({
          severity: 'info',
          kind: 'uncacheable',
          message: `${req.method} ${path} → 200 with no cache-control or etag`,
          requestId: req.id,
          url: req.url,
        })
      }
    }
  }

  // Cross-request: N+1 / redundant fetches.
  const counts = new Map<string, { count: number; url: string }>()
  for (const req of requests) {
    const key = `${req.method.toUpperCase()} ${req.url}`
    const entry = counts.get(key) ?? { count: 0, url: req.url }
    entry.count += 1
    counts.set(key, entry)
  }
  for (const [key, { count, url }] of counts) {
    if (count > repeatedThreshold) {
      findings.push({
        severity: 'warning',
        kind: 'repeated',
        message: `${key.split(' ')[0]} ${pathOf(url)} requested ${count}× — possible N+1 / redundant fetch`,
        url,
      })
    }
  }

  // Rank by severity, then cap.
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  const ranked = findings.slice(0, maxFindings)

  // Slowest N.
  const slowest: SlowRequest[] = [...requests]
    .filter((r) => r.duration != null)
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, maxSlowest)
    .map((r) => ({ id: r.id, url: r.url, durationMs: Math.round(r.duration ?? 0) }))

  return {
    total: requests.length,
    failed,
    slowest,
    findings: ranked,
    summary: buildSummary(requests, failed, ranked, slowest),
  }
}

function buildSummary(
  requests: readonly NetworkRequest[],
  failed: number,
  findings: readonly DiagnosisFinding[],
  slowest: readonly SlowRequest[],
): string {
  if (requests.length === 0) return 'No requests captured yet.'
  const parts: string[] = [`${requests.length} request${requests.length === 1 ? '' : 's'}`]
  if (failed > 0) {
    // Cluster failures by host for the headline.
    const byHost = new Map<string, number>()
    for (const r of requests) {
      if (Boolean(r.error) || (r.status != null && r.status >= 400)) {
        byHost.set(hostOf(r.url), (byHost.get(hostOf(r.url)) ?? 0) + 1)
      }
    }
    const topHost = [...byHost.entries()].sort((a, b) => b[1] - a[1])[0]
    parts.push(`${failed} failed${topHost ? ` (mostly ${topHost[0]})` : ''}`)
  } else {
    parts.push('0 failed')
  }
  if (slowest[0]) parts.push(`slowest ${pathOf(slowest[0].url)} ${slowest[0].durationMs}ms`)
  const warnings = findings.filter((f) => f.severity !== 'error' && f.kind !== 'slow').length
  if (warnings > 0) parts.push(`${warnings} audit finding${warnings === 1 ? '' : 's'}`)
  return parts.join(', ') + '.'
}
