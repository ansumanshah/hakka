import type { Exporter } from '../contract/exporter'
import { buildEvidenceBundle } from '../repro/buildEvidenceBundle'
import type { EvidenceBundle, EvidenceBundleOptions } from '../repro/buildEvidenceBundle'

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

/**
 * `Exporter` (ADR 0003) wrapper around `formatEvidenceBundleForAgent()`.
 * AWKWARD FIT, documented rather than forced: the underlying function takes
 * an already-built `EvidenceBundle`, not requests — building one needs a
 * `focusRequestId` and a byte budget that the browser/MCP callers
 * (`export_evidence`, "Copy as agent context") control explicitly. This
 * wrapper builds a bundle with `buildEvidenceBundle(requests, bundleOptions)`
 * using its documented defaults (focus = earliest request, `maxBytes` =
 * 65536) unless `bundleOptions` overrides them at construction time — a
 * caller needing a specific focal request or a tighter budget per call
 * should compose `buildEvidenceBundle`/`formatEvidenceBundleForAgent`
 * directly rather than through this contract wrapper, which only exposes
 * the "export everything with sane defaults" path a share sheet needs.
 */
export function createAgentEvidenceExporter(
  bundleOptions?: EvidenceBundleOptions,
  formatOptions?: FormatEvidenceBundleForAgentOptions,
): Exporter {
  return {
    id: 'hakka.agent-evidence',
    label: 'Evidence for Agent (Markdown)',
    fileExtension: 'md',
    mimeType: 'text/markdown',
    lossy: true,
    includesBodies: true,
    streaming: false,
    export(requests) {
      const bundle = buildEvidenceBundle([...requests], bundleOptions)
      return formatEvidenceBundleForAgent(bundle, formatOptions)
    },
  }
}
