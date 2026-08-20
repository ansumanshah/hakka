import { analyzeRequests } from '../analyze/analyzeRequests'
import type { AnalyzeOptions } from '../analyze/analyzeRequests'
import type { Exporter } from '../contract/exporter'
import type { NetworkRequest } from '../model/types'

/**
 * Agent context pack: a compact, token-dense (not pretty) paste-into-an-AI-agent
 * view over captured requests — the `analyzeRequests()` summary and top findings
 * up front, then one dense line per request. Header/body redaction happens
 * upstream at capture time, so a "[REDACTED]" value is passed through as literal
 * text, exactly as it should appear.
 */

export interface AgentContextOptions extends AnalyzeOptions {
  /** Max requests to include in the per-request section. Default 100. */
  maxRequests?: number
  /** Which request/response headers to surface per line (case-insensitive). */
  headerAllowlist?: string[]
  /** Max chars of body snippet to show per request. Default 120. */
  bodySnippetLength?: number
}

const DEFAULT_HEADER_ALLOWLIST = ['content-type', 'authorization', 'accept', 'x-request-id']

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function oneLine(text: string, max: number): string {
  const collapsed = text.trim().replace(/\s+/g, ' ')
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed
}

/** Pull the allowlisted headers (case-insensitive) from a headers map, "K: V" joined by "; ". */
function pickHeaders(headers: Record<string, string> | undefined, allowlist: string[]): string {
  if (!headers) return ''
  const lower = new Set(allowlist.map((h) => h.toLowerCase()))
  const picked: string[] = []
  for (const [k, v] of Object.entries(headers)) {
    if (lower.has(k.toLowerCase())) picked.push(`${k}: ${v}`)
  }
  return picked.join('; ')
}

/** One dense line summarizing a single request. */
function requestLine(req: NetworkRequest, headerAllowlist: string[], bodySnippetLength: number): string {
  const path = pathOf(req.url)
  const status = req.error ? `ERR(${req.error})` : (req.status ?? 'pending')
  const duration = req.duration != null ? `${Math.round(req.duration)}ms` : '-'

  const segments = [`${req.method} ${path} -> ${status} ${duration}`]

  const reqHeaders = pickHeaders(req.requestHeaders, headerAllowlist)
  const resHeaders = pickHeaders(req.responseHeaders, headerAllowlist)
  if (reqHeaders) segments.push(`req[${reqHeaders}]`)
  if (resHeaders) segments.push(`res[${resHeaders}]`)

  const body = req.requestBody || req.responseBody
  if (body) segments.push(`body: ${oneLine(body, bodySnippetLength)}`)

  return segments.join(' | ')
}

/** Builds a compact agent-context string: analysis summary + top findings, then one dense line per request. */
export function toAgentContext(requests: readonly NetworkRequest[], options: AgentContextOptions = {}): string {
  const {
    maxRequests = 100,
    headerAllowlist = DEFAULT_HEADER_ALLOWLIST,
    bodySnippetLength = 120,
    ...analyzeOptions
  } = options

  const diagnosis = analyzeRequests(requests, analyzeOptions)

  const lines: string[] = []
  lines.push(`# Hakka agent context — ${diagnosis.summary}`)

  if (diagnosis.findings.length > 0) {
    lines.push('')
    lines.push('## Findings')
    for (const f of diagnosis.findings) {
      lines.push(`- [${f.severity}/${f.kind}] ${f.message}`)
    }
  }

  if (diagnosis.slowest.length > 0) {
    lines.push('')
    lines.push('## Slowest')
    for (const s of diagnosis.slowest) {
      lines.push(`- ${pathOf(s.url)} ${s.durationMs}ms`)
    }
  }

  lines.push('')
  lines.push(`## Requests (${Math.min(requests.length, maxRequests)}/${requests.length})`)
  for (const req of requests.slice(0, maxRequests)) {
    lines.push(requestLine(req, headerAllowlist, bodySnippetLength))
  }

  return lines.join('\n')
}

/**
 * `Exporter` (ADR 0009) wrapper around `toAgentContext()`. `lossy: true` —
 * only allowlisted headers survive, bodies are snipped to `bodySnippetLength`
 * chars, and requests past `maxRequests` (default 100) are dropped from the
 * per-request section entirely. `includesBodies: true` — whichever of
 * `requestBody`/`responseBody` is non-empty (request checked first) appears
 * as a truncated `body: …` snippet on its own dense line; a caller needing
 * FULL, untruncated bodies should use a different exporter (HAR, evidence
 * bundle, repro bundle).
 */
export function createAgentContextExporter(options?: AgentContextOptions): Exporter {
  return {
    id: 'hakka.agent-context',
    label: 'Agent Context (Text)',
    fileExtension: 'txt',
    mimeType: 'text/plain',
    lossy: true,
    includesBodies: true,
    streaming: false,
    export(requests) {
      return toAgentContext(requests, options)
    },
  }
}
