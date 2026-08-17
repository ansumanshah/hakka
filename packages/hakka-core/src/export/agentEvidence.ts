import type { EvidenceBundle } from '../repro/buildEvidenceBundle'

/**
 * Formats an `EvidenceBundle` for pasting into an AI agent: a short preamble +
 * one fenced JSON block with the exact bundle. Kept as a thin formatter,
 * separate from `agentContext.ts`'s dense one-line-per-request text (a
 * different consumer, bulk session review) — the browser's "Copy as agent
 * context" click and the `export_evidence` MCP tool must produce
 * byte-comparable payloads for the same `EvidenceBundle` shape.
 */

export interface FormatEvidenceBundleForAgentOptions {
  /** Free-text reason appended to the preamble, e.g. "checkout 500s under load". */
  reason?: string
}

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function describeFocalOutcome(req: EvidenceBundle['requests'][number] | undefined): string {
  if (!req) return 'no focal request captured'
  if (req.error) return `failed: ${req.error}`
  if (req.status != null) return `${req.status}`
  return 'pending'
}

/**
 * 2-3 line preamble (what failed, when, how many hops/spans) + one
 * ```json fenced block containing the exact `EvidenceBundle` JSON — the same
 * shape `export_evidence`/`get_trace` return.
 */
export function formatEvidenceBundleForAgent(
  bundle: EvidenceBundle,
  options: FormatEvidenceBundleForAgentOptions = {},
): string {
  const focal = bundle.requests.find((r) => r.id === bundle.focusRequestId)
  const headline = focal
    ? `${focal.method} ${pathOf(focal.url)} -> ${describeFocalOutcome(focal)}`
    : 'Hakka evidence bundle'
  const spanCount = bundle.trace.bars.filter((b) => b.kind === 'span').length
  const hopCount = bundle.requests.length

  const lines: string[] = [
    `# ${headline}`,
    `${bundle.exportedAt} · ${hopCount} hop${hopCount === 1 ? '' : 's'} · ${spanCount} span${spanCount === 1 ? '' : 's'}${
      options.reason ? ` · ${options.reason}` : ''
    }`,
    '',
    '```json',
    JSON.stringify(bundle, null, 2),
    '```',
  ]
  return lines.join('\n')
}
