import type { FrameworkSpan, RequestGroup, TraceBar } from 'hakka-core'
import { assembleTraceTree, formatDuration, getRequestStatus, RequestStatus } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import { createMemo, For } from 'solid-js'
import type { Component } from 'solid-js'

/**
 * TraceWaterfall — cross-runtime hop chain for one trace group. Every hop
 * sharing a `correlationId`, plus every `FrameworkSpan` sharing that id as
 * its OTel `traceId`, is placed on one time axis: hops are always depth 0,
 * spans indent by their `parentId` chain. Span bars with no backing
 * `NetworkRequest` (e.g. a synthetic SSR root span) aren't selectable.
 */

function toneOf(req: NetworkRequest): 'success' | 'warning' | 'error' | 'pending' {
  if (req.error || (req.status != null && req.status >= 500)) return 'error'
  if (req.status != null && req.status >= 400) return 'warning'
  const s = getRequestStatus(req)
  if (s === RequestStatus.Pending) return 'pending'
  return 'success'
}

interface TraceWaterfallProps {
  group: RequestGroup
  selectedId: string | null
  onSelect: (req: NetworkRequest) => void
  /** Framework spans for this trace. `[]` is a fully valid input — degrades to hop-only rendering. */
  spans?: FrameworkSpan[]
  /** Show verbose (non-primary) spans. */
  verbose?: boolean
}

export const TraceWaterfall: Component<TraceWaterfallProps> = (props) => {
  const tree = createMemo(() =>
    assembleTraceTree(props.group.items, props.spans ?? [], { verbose: props.verbose ?? false }),
  )

  const span = () => Math.max(tree().t1 - tree().t0, 1)

  // Bars are colored by runtime (tone only overrides on failure) — that
  // legend isn't self-evident, so spell it out for the runtimes present.
  const runtimesPresent = createMemo(() => [...new Set(tree().bars.map((b) => b.runtime))])

  const barTone = (bar: TraceBar): 'success' | 'warning' | 'error' | 'pending' => {
    if (bar.kind === 'request' && bar.request) return toneOf(bar.request)
    return 'success'
  }

  const isSelected = (bar: TraceBar): boolean => bar.kind === 'request' && props.selectedId === bar.id

  const handleClick = (bar: TraceBar): void => {
    if (bar.kind === 'request' && bar.request) props.onSelect(bar.request)
  }

  // One name string per row — method-prefixed path for a hop, the span name
  // (plus its request kind, for the synthetic root span) otherwise. No
  // per-row runtime text; that lives once, in the legend above.
  const nameOf = (bar: TraceBar): string => {
    if (bar.kind === 'request' && bar.request) return `${bar.request.method.toUpperCase()} ${bar.label}`
    const isRootSpan = bar.kind === 'span' && bar.span?.parentId === null
    if (isRootSpan && bar.span?.requestKind) return `${bar.label} · ${bar.span.requestKind}`
    return bar.label
  }

  return (
    <div class="hakka-trace-wf" role="list" aria-label="Trace timeline">
      <div class="hakka-wf-legend" aria-hidden="true">
        <For each={runtimesPresent()}>
          {(rt) => <span class={`hakka-wf-legend-item rt-${rt}`}>{rt === 'client' ? 'web' : rt}</span>}
        </For>
      </div>
      <For each={tree().bars}>
        {(bar) => {
          const offset = () => (bar.startTime - tree().t0) / span()
          const width = () => Math.max((bar.endTime - bar.startTime) / span(), 0)
          // Request bars: show '…' while genuinely pending (no `duration`
          // yet). Span bars are only ever emitted onEnd() (see hakka-node's
          // SpanProcessor), so they always have a real endTime.
          const dur = () => {
            if (bar.kind === 'request')
              return bar.request?.duration != null ? formatDuration(bar.request.duration) : '…'
            return formatDuration(Math.max(bar.endTime - bar.startTime, 0))
          }
          const isSpan = bar.kind === 'span'
          const isVerbose = bar.verbosity === 'verbose'
          return (
            <div
              role="listitem"
              class={`hakka-wf-hop rt-${bar.runtime} tone-${barTone(bar)}${isSpan ? ' kind-span' : ''}${isVerbose ? ' verbose' : ''}${isSelected(bar) ? ' selected' : ''}`}
              // Indent scales --hakka-space-lg by depth via a CSS custom
              // property — the calc() itself lives in styles.ts's .kind-span
              // rule.
              style={{ '--wf-depth': isSpan && bar.depth > 0 ? String(bar.depth) : undefined }}
              onClick={() => handleClick(bar)}
              title={
                bar.kind === 'request' && bar.request
                  ? `${bar.request.method} ${bar.request.url} — ${bar.runtime}`
                  : `${bar.label} — ${bar.runtime}`
              }
            >
              {/* Label column (dot + name) is a FIXED width — indentation is
                  padding-left inside it, never margin on the row. Keeps
                  every row's track starting at the same x. */}
              <div class="hakka-wf-label">
                <span class="hakka-wf-dot" aria-hidden="true" />
                <span class="hakka-wf-name">{nameOf(bar)}</span>
              </div>
              <div class="hakka-wf-track">
                <div
                  class="hakka-wf-bar"
                  style={{
                    left: `${(offset() * 100).toFixed(2)}%`,
                    // Sub-pixel bars vanish; floor the visible width at 2%.
                    width: `${Math.max(width() * 100, 2).toFixed(2)}%`,
                  }}
                />
              </div>
              <span class="hakka-wf-dur">{dur()}</span>
            </div>
          )
        }}
      </For>
    </div>
  )
}
