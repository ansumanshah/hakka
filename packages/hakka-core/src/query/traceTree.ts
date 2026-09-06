/** Shared waterfall bars and geometry for trace rendering and list row heights. */

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

/**
 * Count visible ancestors, walking through hidden parents and stopping at cycles.
 */
function computeSpanDepths(spans: FrameworkSpan[], verbose: boolean): Map<string, number> {
  const byId = new Map<string, FrameworkSpan>()
  for (const span of spans) byId.set(span.id, span)

  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  function depthOf(span: FrameworkSpan): number {
    const cached = depths.get(span.id)
    if (cached !== undefined) return cached

    const parent = span.parentId === null ? undefined : byId.get(span.parentId)
    if (!parent || visiting.has(span.id)) {
      depths.set(span.id, 0)
      return 0
    }

    visiting.add(span.id)
    const parentDepth = depthOf(parent)
    visiting.delete(span.id)
    // Preserve a depth cached by the cycle guard during recursion.
    const already = depths.get(span.id)
    if (already !== undefined) return already
    const depth = verbose || parent.verbosity === 'primary' ? parentDepth + 1 : parentDepth
    depths.set(span.id, depth)
    return depth
  }

  for (const span of spans) depthOf(span)
  return depths
}

/** Sort trace bars by start time, nesting spans beneath visible ancestors. */
export function assembleTraceTree(
  requests: NetworkRequest[],
  spans: FrameworkSpan[],
  options?: AssembleTraceTreeOptions,
): TraceTree {
  const verbose = options?.verbose ?? false
  const depths = computeSpanDepths(spans, verbose)
  const bars: TraceBar[] = requests.map((req) => ({
    kind: 'request',
    id: req.id,
    startTime: req.startTime,
    endTime: req.endTime ?? req.startTime + (req.duration ?? 0),
    depth: 0,
    label: (req.url.match(/^https?:\/\/[^/]+(.*)/)?.[1] ?? req.url) || '/',
    runtime: req.runtime === 'server' || req.runtime === 'edge' ? req.runtime : 'client',
    request: req,
  }))

  for (const span of spans) {
    if (!verbose && span.verbosity !== 'primary') continue
    bars.push({
      kind: 'span',
      id: span.id,
      startTime: span.startTime,
      endTime: span.endTime,
      depth: depths.get(span.id) ?? 0,
      label: span.name,
      runtime: span.runtime,
      verbosity: span.verbosity,
      span,
    })
  }
  bars.sort((a, b) => a.startTime - b.startTime)

  if (bars.length === 0) return { bars, t0: 0, t1: 0 }

  const t0 = bars[0].startTime
  let t1 = t0 + 1
  for (const bar of bars) t1 = Math.max(t1, bar.endTime)
  return { bars, t0, t1 }
}
