/**
 * assembleTraceTree — merges a trace group's `NetworkRequest` hops with its
 * `FrameworkSpan`s into one ordered, depth-annotated bar list, for a
 * waterfall (`TraceWaterfall.tsx`) and group-header height math
 * (`RequestList.tsx`). Both call sites MUST use this same function so their
 * bar counts never silently drift. Pure, no DOM, platform-neutral.
 */

import type { FrameworkSpan, NetworkRequest, RequestRuntime } from '../model/types'

export interface TraceBar {
  kind: 'request' | 'span'
  id: string
  startTime: number
  endTime: number
  depth: number
  label: string
  runtime: RequestRuntime
  verbosity?: 'primary' | 'verbose'
  request?: NetworkRequest
  span?: FrameworkSpan
}

export interface TraceTree {
  bars: TraceBar[]
  t0: number
  t1: number
}

export interface AssembleTraceTreeOptions {
  verbose?: boolean
}

/** End of a request on the wall clock — endTime, else start+duration, else start. */
function hopEnd(req: NetworkRequest): number {
  if (req.endTime != null) return req.endTime
  if (req.duration != null) return req.startTime + req.duration
  return req.startTime
}

function requestRuntime(req: NetworkRequest): RequestRuntime {
  return req.runtime === 'server' || req.runtime === 'edge' ? req.runtime : 'client'
}

/** Path-only label for a request, matching TraceWaterfall's `parseUrl(...).path` idiom without a DOM/URL dependency here. */
function requestLabel(req: NetworkRequest): string {
  const match = req.url.match(/^https?:\/\/[^/]+(.*)/)
  return (match ? match[1] : req.url) || '/'
}

/**
 * Depth of each span within its trace, walking the `parentId` chain against
 * the FULL span set (visible + verbosity-filtered) so a visible span nests
 * under its nearest VISIBLE ancestor instead of collapsing to depth 0 when
 * its immediate parent is hidden — a hidden parent is transparent, so a run
 * of hidden ancestors adds zero extra depth. Root spans (`parentId === null`
 * or not present in this trace) get depth 0. A visited-set cycle guard
 * prevents an infinite loop on a cyclic `parentId` chain.
 */
function computeSpanDepths(spans: FrameworkSpan[], isVisible: (span: FrameworkSpan) => boolean): Map<string, number> {
  const byId = new Map<string, FrameworkSpan>()
  for (const span of spans) byId.set(span.id, span)

  const depths = new Map<string, number>()

  function depthOf(span: FrameworkSpan, visiting: Set<string>): number {
    const cached = depths.get(span.id)
    if (cached !== undefined) return cached

    if (span.parentId === null || visiting.has(span.id)) {
      depths.set(span.id, 0)
      return 0
    }
    const parent = byId.get(span.parentId)
    if (!parent) {
      depths.set(span.id, 0)
      return 0
    }

    visiting.add(span.id)
    const parentDepth = depthOf(parent, visiting)
    visiting.delete(span.id)
    // A nested cycle-guard may have already cached this node's depth while we
    // were still unwinding (see the cycle test) — respect that value instead
    // of clobbering it with the depth computed from the (broken) chain above.
    const already = depths.get(span.id)
    if (already !== undefined) return already
    const depth = isVisible(parent) ? parentDepth + 1 : parentDepth
    depths.set(span.id, depth)
    return depth
  }

  for (const span of spans) depthOf(span, new Set())
  return depths
}

/**
 * Assemble one trace group's requests + spans into an ordered bar list,
 * sorted by `startTime`. Request bars (hops) always sit at `depth: 0`; span
 * bars get depth from their `parentId` chain (cycle-guarded). Spans are
 * filtered to `verbosity === 'primary'` unless `options.verbose` is set.
 */
export function assembleTraceTree(
  requests: NetworkRequest[],
  spans: FrameworkSpan[],
  options?: AssembleTraceTreeOptions,
): TraceTree {
  const verbose = options?.verbose ?? false
  const isVisible = (s: FrameworkSpan): boolean => verbose || s.verbosity === 'primary'
  // Depths are computed against the FULL span set (see computeSpanDepths'
  // doc) — a verbosity-filtered ancestor must still be walkable so a visible
  // span nests under its nearest visible ancestor instead of depth 0.
  const depths = computeSpanDepths(spans, isVisible)
  const visibleSpans = spans.filter(isVisible)

  const requestBars: TraceBar[] = requests.map((req) => ({
    kind: 'request',
    id: req.id,
    startTime: req.startTime,
    endTime: hopEnd(req),
    depth: 0,
    label: requestLabel(req),
    runtime: requestRuntime(req),
    request: req,
  }))

  const spanBars: TraceBar[] = visibleSpans.map((span) => ({
    kind: 'span',
    id: span.id,
    startTime: span.startTime,
    endTime: span.endTime,
    depth: depths.get(span.id) ?? 0,
    label: span.name,
    runtime: span.runtime,
    verbosity: span.verbosity,
    span,
  }))

  const bars = [...requestBars, ...spanBars].sort((a, b) => a.startTime - b.startTime)

  if (bars.length === 0) return { bars, t0: 0, t1: 0 }

  const t0 = Math.min(...bars.map((b) => b.startTime))
  const t1 = Math.max(...bars.map((b) => b.endTime))
  return { bars, t0, t1: Math.max(t1, t0 + 1) }
}
