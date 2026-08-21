import { analyzeRequests } from '../analyze/analyzeRequests'
import type { RequestDiagnosis } from '../analyze/analyzeRequests'
import type { Exporter } from '../contract/exporter'
import type { LogEntry } from '../log/types'
import type { FrameworkSpan, NetworkRequest } from '../model/types'
import { summarizeTraceGroup } from '../query/traceSummary'
import type { TraceBadgeSummary } from '../query/traceSummary'
import { assembleTraceTree } from '../query/traceTree'
import type { TraceTree } from '../query/traceTree'
import { scrubRequestsForShare } from '../utils/shareScrub'
import type { ShareScrubOptions, ShareScrubSummary } from '../utils/shareScrub'
import { buildReproBundle } from './buildReproBundle'
import type { BuildReproBundleOptions, ReproMockRule } from './buildReproBundle'

/**
 * The one bundling primitive behind the AI-devtool features (`export_evidence`,
 * "Copy as agent context", `get_trace`'s sibling read paths) — never a second
 * bundler. Composes `buildReproBundle`/`assembleTraceTree`/`summarizeTraceGroup`/
 * `analyzeRequests` rather than reimplementing them. See /spec/export for the
 * determinism guarantee, console-correlation approximation, and why `storage`
 * is always `null` in v1.
 */

/** Current evidence-bundle schema version. Bump on breaking shape changes. */
export const EVIDENCE_BUNDLE_SCHEMA_VERSION = 1

export type EvidenceBundleTruncationKind =
  | 'spans.verbose.dropped'
  | 'console.trimmed'
  | 'diagnose.findings.capped'
  | 'requests.body.trimmed'
  | 'mocks.dropped'
  | 'requests.nonfocal.dropped'
  | 'focal.body.hard-truncate'
  | 'focusRequestId.not-found.fallback'

export interface EvidenceBundleTruncation {
  kind: EvidenceBundleTruncationKind
  /** Human-readable, e.g. "dropped 12 verbose spans (had 40 total)". */
  detail: string
  /** Best-effort — post-pass minus pre-pass serialized size. Never negative. */
  bytesSaved: number
}

export interface EvidenceBundleOptions {
  /** Default: `requests[0].id` after sort. */
  focusRequestId?: string
  /** TextEncoder-measured budget (works identically in a browser Worker, main thread, and Node). Default 65536. */
  maxBytes?: number
  spans?: FrameworkSpan[]
  logs?: LogEntry[]
  /** Padding (ms) around [min(startTime), max(endTime)] used to correlate console entries. Default 2000. */
  logWindowMs?: number
  /** Default: computed via `analyzeRequests(requests)`. */
  diagnosis?: RequestDiagnosis
  /** Forwarded to `buildReproBundle` for the requests+mocks derivation. `scrub` is ignored here — see `scrub`/`scrubOptions` below, which control the ONE scrub pass this function runs before deriving anything (repro, trace, diagnosis) from the requests. */
  reproOptions?: BuildReproBundleOptions
  /** ISO timestamp to stamp the bundle with. Default `new Date().toISOString()` — for deterministic tests, pass one explicitly. */
  exportedAt?: string
  /**
   * Apply share-time scrubbing (`shareScrub.ts`) to `requests` before anything is derived
   * from them (repro, trace, diagnosis, non-focal body trimming). Default true: this is
   * the ONE bundling primitive behind `export_evidence` and the browser's "Copy as agent
   * context" action, both of which hand bodies to an agent — see the module docblock.
   */
  scrub?: boolean
  /** Forwarded to the scrub pass when `scrub` is true (or defaulted true). */
  scrubOptions?: ShareScrubOptions
}

export interface EvidenceBundle {
  version: number
  exportedAt: string
  focusRequestId: string
  /** Sorted startTime asc, id tie-break — the same order `buildReproBundle` would use for this input. */
  requests: NetworkRequest[]
  mocks: ReproMockRule[]
  trace: TraceTree
  /** `null` only when `requests` is empty. */
  traceSummary: TraceBadgeSummary | null
  diagnosis: RequestDiagnosis
  console: LogEntry[]
  /** Always `null` in v1 — see module docblock. */
  storage: null
  /** `[]` when nothing was cut — never a silently-shrunk field. */
  truncations: EvidenceBundleTruncation[]
  /** Whether share-time scrubbing ran on this bundle and what it found. See `shareScrub.ts`. */
  redaction: ShareScrubSummary
}

const DEFAULT_MAX_BYTES = 65536
const DEFAULT_LOG_WINDOW_MS = 2000
/** Last-resort cap on the focal request's own body — always keeps *some* signal. */
const FOCAL_BODY_HARD_TRUNCATE_LEN = 200

const textEncoder = new TextEncoder()

function byteSize(bundle: EvidenceBundle): number {
  return textEncoder.encode(JSON.stringify(bundle)).length
}

function compareRequests(a: NetworkRequest, b: NetworkRequest): number {
  if (a.startTime !== b.startTime) return a.startTime - b.startTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** End of a request on the wall clock — endTime, else start+duration, else start. Duplicated from traceTree.ts/traceSummary.ts's own private `hopEnd` rather than shared. */
function hopEnd(req: NetworkRequest): number {
  if (req.endTime != null) return req.endTime
  if (req.duration != null) return req.startTime + req.duration
  return req.startTime
}

/** Approximate correlation: keeps entries with `timestamp` inside `[min(startTime), max(endTime)]` of the request set, padded by `logWindowMs`. */
function correlateLogEntries(logs: LogEntry[], requests: NetworkRequest[], logWindowMs: number): LogEntry[] {
  if (requests.length === 0 || logs.length === 0) return []
  const lo = Math.min(...requests.map((r) => r.startTime)) - logWindowMs
  const hi = Math.max(...requests.map(hopEnd)) + logWindowMs
  return logs.filter((l) => l.timestamp >= lo && l.timestamp <= hi)
}

interface TruncationContext {
  focusRequestId: string
  spans: FrameworkSpan[]
  sortedRequests: NetworkRequest[]
  maxBytes: number
}

function overBudget(bundle: EvidenceBundle, maxBytes: number): boolean {
  return byteSize(bundle) > maxBytes
}

/** Pass 1 — drop verbose (non-`primary`) spans from the trace. */
function passDropVerboseSpans(bundle: EvidenceBundle, ctx: TruncationContext): void {
  if (!overBudget(bundle, ctx.maxBytes)) return
  const before = byteSize(bundle)
  const totalSpanBars = bundle.trace.bars.filter((b) => b.kind === 'span').length
  const primaryOnly = assembleTraceTree(ctx.sortedRequests, ctx.spans, { verbose: false })
  const keptSpanBars = primaryOnly.bars.filter((b) => b.kind === 'span').length
  const droppedCount = totalSpanBars - keptSpanBars
  if (droppedCount <= 0) return
  bundle.trace = primaryOnly
  const after = byteSize(bundle)
  bundle.truncations.push({
    kind: 'spans.verbose.dropped',
    detail: `dropped ${droppedCount} verbose span${droppedCount === 1 ? '' : 's'} (had ${totalSpanBars} total)`,
    bytesSaved: Math.max(0, before - after),
  })
}

/** Pass 2 — trim the oldest console entries, keeping the most recent half. */
function passTrimConsole(bundle: EvidenceBundle, ctx: TruncationContext): void {
  if (!overBudget(bundle, ctx.maxBytes)) return
  const originalCount = bundle.console.length
  if (originalCount <= 1) return
  const before = byteSize(bundle)
  const byTime = [...bundle.console].sort((a, b) => a.timestamp - b.timestamp)
  const keepCount = Math.ceil(originalCount / 2)
  const kept = byTime.slice(originalCount - keepCount)
  bundle.console = kept
  const after = byteSize(bundle)
  bundle.truncations.push({
    kind: 'console.trimmed',
    detail: `trimmed ${originalCount - kept.length} console entries, kept ${kept.length} most recent of ${originalCount}`,
    bytesSaved: Math.max(0, before - after),
  })
}

/** Pass 3 — cap diagnose findings, keeping the highest-severity ones first (already `analyzeRequests`-sorted). */
function passCapFindings(bundle: EvidenceBundle, ctx: TruncationContext): void {
  if (!overBudget(bundle, ctx.maxBytes)) return
  const originalCount = bundle.diagnosis.findings.length
  if (originalCount <= 1) return
  const before = byteSize(bundle)
  const keepCount = Math.ceil(originalCount / 2)
  const kept = bundle.diagnosis.findings.slice(0, keepCount)
  bundle.diagnosis = { ...bundle.diagnosis, findings: kept }
  const after = byteSize(bundle)
  bundle.truncations.push({
    kind: 'diagnose.findings.capped',
    detail: `capped diagnose findings to ${kept.length} (had ${originalCount}), highest severity kept first`,
    bytesSaved: Math.max(0, before - after),
  })
}

/** Pass 4 — blank non-focal requests' bodies, keeping their metadata. */
function passTrimNonFocalBodies(bundle: EvidenceBundle, ctx: TruncationContext): void {
  if (!overBudget(bundle, ctx.maxBytes)) return
  const before = byteSize(bundle)
  let changed = 0
  const trimmed = bundle.requests.map((r) => {
    if (r.id === ctx.focusRequestId) return r
    if (r.requestBody == null && r.responseBody == null) return r
    changed++
    return {
      ...r,
      requestBody: r.requestBody != null ? null : r.requestBody,
      responseBody: r.responseBody != null ? null : r.responseBody,
    }
  })
  if (changed === 0) return
  bundle.requests = trimmed
  const after = byteSize(bundle)
  bundle.truncations.push({
    kind: 'requests.body.trimmed',
    detail: `blanked bodies on ${changed} non-focal request${changed === 1 ? '' : 's'}`,
    bytesSaved: Math.max(0, before - after),
  })
}

/** Pass 5 — drop mocks entirely. */
function passDropMocks(bundle: EvidenceBundle, ctx: TruncationContext): void {
  if (!overBudget(bundle, ctx.maxBytes)) return
  const count = bundle.mocks.length
  if (count === 0) return
  const before = byteSize(bundle)
  bundle.mocks = []
  const after = byteSize(bundle)
  bundle.truncations.push({
    kind: 'mocks.dropped',
    detail: `dropped ${count} mock rule${count === 1 ? '' : 's'}`,
    bytesSaved: Math.max(0, before - after),
  })
}

/** Pass 6 — drop non-focal requests entirely from the requests list (the trace's own bars, assembled earlier, are unaffected). */
function passDropNonFocalRequests(bundle: EvidenceBundle, ctx: TruncationContext): void {
  if (!overBudget(bundle, ctx.maxBytes)) return
  const originalCount = bundle.requests.length
  const focalOnly = bundle.requests.filter((r) => r.id === ctx.focusRequestId)
  const droppedCount = originalCount - focalOnly.length
  if (droppedCount <= 0) return
  const before = byteSize(bundle)
  bundle.requests = focalOnly
  const after = byteSize(bundle)
  bundle.truncations.push({
    kind: 'requests.nonfocal.dropped',
    detail: `dropped ${droppedCount} non-focal request${droppedCount === 1 ? '' : 's'} from the requests list (trace bars unaffected)`,
    bytesSaved: Math.max(0, before - after),
  })
}

/** Pass 7 (last resort) — hard-truncate the focal request's own body. Always keeps some signal; never drops it entirely. */
function passHardTruncateFocalBody(bundle: EvidenceBundle, ctx: TruncationContext): void {
  if (!overBudget(bundle, ctx.maxBytes)) return
  const idx = bundle.requests.findIndex((r) => r.id === ctx.focusRequestId)
  if (idx === -1) return
  const focal = bundle.requests[idx]!
  const reqLen = focal.requestBody?.length ?? 0
  const resLen = focal.responseBody?.length ?? 0
  if (reqLen <= FOCAL_BODY_HARD_TRUNCATE_LEN && resLen <= FOCAL_BODY_HARD_TRUNCATE_LEN) return
  const before = byteSize(bundle)
  const nextRequests = [...bundle.requests]
  nextRequests[idx] = {
    ...focal,
    requestBody:
      reqLen > FOCAL_BODY_HARD_TRUNCATE_LEN
        ? `${focal.requestBody!.slice(0, FOCAL_BODY_HARD_TRUNCATE_LEN)}…[truncated]`
        : focal.requestBody,
    responseBody:
      resLen > FOCAL_BODY_HARD_TRUNCATE_LEN
        ? `${focal.responseBody!.slice(0, FOCAL_BODY_HARD_TRUNCATE_LEN)}…[truncated]`
        : focal.responseBody,
  }
  bundle.requests = nextRequests
  const after = byteSize(bundle)
  bundle.truncations.push({
    kind: 'focal.body.hard-truncate',
    detail: `hard-truncated the focal request's body to ${FOCAL_BODY_HARD_TRUNCATE_LEN} chars`,
    bytesSaved: Math.max(0, before - after),
  })
}

/**
 * Fixed-order sequence of reduction passes, stopping as soon as the budget
 * is met. Each pass that actually cuts something appends exactly one
 * `EvidenceBundleTruncation`; a pass with nothing to cut is a no-op.
 */
function applyTruncationPasses(bundle: EvidenceBundle, ctx: TruncationContext): void {
  passDropVerboseSpans(bundle, ctx)
  passTrimConsole(bundle, ctx)
  passCapFindings(bundle, ctx)
  passTrimNonFocalBodies(bundle, ctx)
  passDropMocks(bundle, ctx)
  passDropNonFocalRequests(bundle, ctx)
  passHardTruncateFocalBody(bundle, ctx)
}

/** Builds a size-budgeted evidence bundle from already-captured requests. See module docblock. */
export function buildEvidenceBundle(requests: NetworkRequest[], options: EvidenceBundleOptions = {}): EvidenceBundle {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const logWindowMs = options.logWindowMs ?? DEFAULT_LOG_WINDOW_MS
  const exportedAt = options.exportedAt ?? new Date().toISOString()
  const spans = options.spans ?? []
  const logs = options.logs ?? []
  const scrub = options.scrub ?? true

  // Scrub BEFORE anything downstream (repro/trace/diagnosis) derives from `requests` —
  // every one of those reads bodies, so scrubbing after the fact would leave secrets in
  // whichever derived view ran first.
  const { requests: scrubbedInput, removed: redactionRemoved } = scrub
    ? scrubRequestsForShare(requests, options.scrubOptions)
    : { requests: [...requests], removed: [] as ShareScrubSummary['removed'] }

  const sorted = [...scrubbedInput].sort(compareRequests)
  const fallbackFocusRequestId = sorted[0]?.id ?? ''
  // An unmatched `focusRequestId` must not propagate silently — every pass
  // below keys off `r.id === focusRequestId`, so it would make every request
  // non-focal and empty `requests` under budget pressure (pass 6). Fall back
  // to the sorted default and record it as an explicit truncation instead.
  const requestedFocusMissing = options.focusRequestId != null && !sorted.some((r) => r.id === options.focusRequestId)
  const focusRequestId = requestedFocusMissing
    ? fallbackFocusRequestId
    : (options.focusRequestId ?? fallbackFocusRequestId)

  // `sorted` is already scrubbed above; tell buildReproBundle not to scrub again (it
  // would be idempotent, but skipping it avoids the redundant walk).
  const repro = buildReproBundle(sorted, { ...options.reproOptions, scrub: false })
  const trace = assembleTraceTree(sorted, spans, { verbose: true })
  const traceSummary = sorted.length === 0 ? null : summarizeTraceGroup(sorted, spans)
  const diagnosis = options.diagnosis ?? analyzeRequests(sorted)
  const console_ = correlateLogEntries(logs, sorted, logWindowMs)

  const bundle: EvidenceBundle = {
    version: EVIDENCE_BUNDLE_SCHEMA_VERSION,
    exportedAt,
    focusRequestId,
    requests: repro.requests,
    mocks: repro.mocks,
    trace,
    traceSummary,
    diagnosis,
    console: console_,
    storage: null,
    truncations: [],
    redaction: { applied: scrub, removed: redactionRemoved },
  }

  if (requestedFocusMissing) {
    bundle.truncations.push({
      kind: 'focusRequestId.not-found.fallback',
      detail:
        `focusRequestId "${options.focusRequestId}" was not found in the selected requests` +
        (focusRequestId ? `; fell back to "${focusRequestId}"` : '; no requests to fall back to'),
      bytesSaved: 0,
    })
  }

  applyTruncationPasses(bundle, { focusRequestId, spans, sortedRequests: sorted, maxBytes })

  return bundle
}

/**
 * `Exporter` (ADR 0009) wrapper around `buildEvidenceBundle()`, serialized as
 * pretty JSON. `options` (focus request, byte budget, spans/logs to
 * correlate, …) is captured at construction time, not per-call — see
 * `exporter.ts`'s docblock. `lossy: true` even though the bundle stores
 * `requests` near-verbatim below `maxBytes`: the truncation passes above are
 * a real, in-scope, documented behavior of this function, not an edge case,
 * so this contract commits to the conservative `lossy: true` rather than a
 * conditional claim a caller can't act on without re-deriving the budget
 * math itself.
 */
export function createEvidenceBundleExporter(options?: EvidenceBundleOptions): Exporter {
  return {
    id: 'hakka.evidence-bundle',
    label: 'Evidence Bundle (JSON)',
    fileExtension: 'json',
    mimeType: 'application/json',
    lossy: true,
    includesBodies: true,
    streaming: false,
    export(requests) {
      return JSON.stringify(buildEvidenceBundle([...requests], options), null, 2)
    },
  }
}
