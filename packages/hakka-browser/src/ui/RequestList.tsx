import type { FrameworkSpan, NetworkRequest, RequestGroup } from 'hakka-core'
import { assembleTraceTree, deriveTraceId, summarizeTraceGroup } from 'hakka-core'
import { createEffect, createMemo, createSignal, For, Loading, lazy, onSettled, Show } from 'solid-js'
import type { Component } from 'solid-js'

import { IconInbox } from './icons'
import { RequestRow } from './RequestRow'
import { TraceBadgeRow } from './TraceBadgeRow'
import { windowFlatItems, type FlatWindow } from './windowedList'

// Lazy chunk, fetched only the first time a trace group actually needs one
// (most sessions never group by trace) — same pattern as Inspector.tsx's
// CommandPalette/RequestDiff/Tour.
const TraceWaterfall = lazy(() => import('./TraceWaterfall').then((m) => ({ default: m.TraceWaterfall })))

interface RequestListProps {
  /** Already sorted (Inspector handles sort/filter). */
  requests: NetworkRequest[]
  /** Non-null when group !== 'none'; overrides flat list rendering. */
  groups: RequestGroup[] | null
  /** True when grouping by trace — renders a hop-chain waterfall per group. */
  traceView?: boolean
  selected: NetworkRequest | null
  onSelect: (req: NetworkRequest) => void
  /** Multi-select state. */
  selectMode: boolean
  selectedIds: ReadonlySet<string>
  onToggleSelect: (id: string) => void
  /** Compact row density — tightens padding and hides host. */
  compact: boolean
  /** Seeds ~8 demo requests into the store — shown only on the empty state. */
  onLoadSample?: () => void
  /** Framework spans (Next.js/OTel request tree), keyed by traceId (== a trace group's `key`). */
  spansByTrace?: ReadonlyMap<string, FrameworkSpan[]>
  /** Show verbose (non-primary) spans in the waterfall + badge row. */
  verboseSpans?: boolean
  /** Flips `verboseSpans` — backs each group's `TraceBadgeRow` switch (`FilterViewModel.setVerboseSpans`). */
  onToggleVerboseSpans?: () => void
  /**
   * Request-kind filter — `'all'`/unset means no constraint. Narrows which
   * trace GROUPS render, by each group's root span's `requestKind`. Only
   * applied while `groups` is non-null and `traceView` is on; a no-op
   * outside trace grouping.
   */
  requestKindFilter?: string
}

// Above this many rows, switch to windowed rendering — the inspector's
// primary deployment is mobile WebViews, which can't hold a Shadow DOM with
// hundreds of live nodes.
const VIRTUALIZE_ABOVE = 60
const OVERSCAN = 8
const DEFAULT_ROW_HEIGHT = 54
const DEFAULT_HEADER_HEIGHT = 32
const DEFAULT_WF_HOP_HEIGHT = 20
const DEFAULT_WF_PAD = 14
const DEFAULT_BADGE_ROW_HEIGHT = 28

// Only real traces get a waterfall — the empty-key "No trace" bucket holds
// unrelated requests with no shared correlationId, so aligning them on one
// axis would imply a causality that isn't there. A single-request group still
// earns one when framework spans exist (a document load is one request plus
// a server-side span tree).
function groupShowsWaterfall(traceView: boolean | undefined, grp: RequestGroup, spanCount: number): boolean {
  return Boolean(traceView) && grp.key !== '' && (grp.items.length > 1 || spanCount > 0)
}

// Spans are bucketed by their W3C traceId = deriveTraceId(correlationId);
// group keys are the RAW correlationId (dashed UUID) — derive before lookup
// or client-originated groups never find their spans.
function spansFor(spansByTrace: ReadonlyMap<string, FrameworkSpan[]> | undefined, key: string): FrameworkSpan[] {
  if (!spansByTrace || key === '') return []
  return spansByTrace.get(deriveTraceId(key)) ?? []
}

/** Bar count for a group's waterfall — MUST be the same `assembleTraceTree`
 * call the waterfall itself renders from, never `group.items.length`: once
 * span bars render, `items.length` alone undercounts and the windowed slice
 * drifts out of alignment with its real on-screen height. */
function barCountFor(group: RequestGroup, spans: FrameworkSpan[], verbose: boolean): number {
  return assembleTraceTree(group.items, spans, { verbose }).bars.length
}

/** A group's header row + badge row + (optionally) trace waterfall — shared
 * by both the unvirtualized and windowed grouped branches below, so their
 * markup (and the height math in `groupedWindow`) never drifts apart. */
const GroupHeaderBlock: Component<{
  group: RequestGroup
  traceView: boolean | undefined
  selected: NetworkRequest | null
  onSelect: (req: NetworkRequest) => void
  spansByTrace: ReadonlyMap<string, FrameworkSpan[]> | undefined
  verboseSpans: boolean | undefined
  onToggleVerbose: () => void
}> = (p) => {
  const spans = () => spansFor(p.spansByTrace, p.group.key)
  const showsWaterfall = () => groupShowsWaterfall(p.traceView, p.group, spans().length)
  return (
    <>
      <div class="hakka-group-header">
        <span class="hakka-group-label">{p.group.label}</span>
        <span class="hakka-count-badge sm outline">{p.group.items.length}</span>
      </div>
      <Show when={showsWaterfall()}>
        <TraceBadgeRow
          summary={summarizeTraceGroup(p.group.items, spans())}
          verbose={Boolean(p.verboseSpans)}
          onToggleVerbose={p.onToggleVerbose}
        />
        <Loading fallback={null}>
          <TraceWaterfall
            group={p.group}
            selectedId={p.selected?.id ?? null}
            onSelect={p.onSelect}
            spans={spans()}
            verbose={p.verboseSpans}
          />
        </Loading>
      </Show>
    </>
  )
}

/** One entry in the grouped branch once it's been flattened for windowing. */
type FlatItem = { kind: 'header'; group: RequestGroup } | { kind: 'row'; group: RequestGroup; req: NetworkRequest }
type HeaderFlatItem = Extract<FlatItem, { kind: 'header' }>
type RowFlatItem = Extract<FlatItem, { kind: 'row' }>

export const RequestList: Component<RequestListProps> = (props) => {
  let listEl: HTMLDivElement | undefined
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewportH, setViewportH] = createSignal(0)
  // Measured from real rendered elements so the virtual window stays aligned
  // regardless of theme/density/font-size.
  const [rowH, setRowH] = createSignal(DEFAULT_ROW_HEIGHT)
  const [headerH, setHeaderH] = createSignal(DEFAULT_HEADER_HEIGHT)
  const [wfHopH, setWfHopH] = createSignal(DEFAULT_WF_HOP_HEIGHT)
  const [wfPad, setWfPad] = createSignal(DEFAULT_WF_PAD)
  const [badgeRowH, setBadgeRowH] = createSignal(DEFAULT_BADGE_ROW_HEIGHT)

  const measure = () => {
    if (!listEl) return
    setViewportH(listEl.clientHeight)
    const firstRow = listEl.querySelector('.hakka-row') as HTMLElement | null
    if (firstRow && firstRow.offsetHeight > 0) setRowH(firstRow.offsetHeight)
    const firstHeader = listEl.querySelector('.hakka-group-header') as HTMLElement | null
    if (firstHeader && firstHeader.offsetHeight > 0) setHeaderH(firstHeader.offsetHeight)
    const firstBadgeRow = listEl.querySelector('.hakka-trace-badges') as HTMLElement | null
    if (firstBadgeRow && firstBadgeRow.offsetHeight > 0) setBadgeRowH(firstBadgeRow.offsetHeight)
    // A rendered waterfall's box height minus its bar rows is the container's
    // vertical padding — back that out so headerH + badgeRowH + n*wfHopH +
    // wfPad reconstructs a trace header block's real on-screen height.
    // `.hakka-wf-hop` matches both hop (request) and span bars.
    const firstWf = listEl.querySelector('.hakka-trace-wf') as HTMLElement | null
    const hops = firstWf?.querySelectorAll('.hakka-wf-hop') ?? null
    const firstHop = hops && hops.length > 0 ? (hops[0] as HTMLElement) : null
    if (firstHop && firstHop.offsetHeight > 0) setWfHopH(firstHop.offsetHeight)
    if (firstWf && hops && hops.length > 0 && firstWf.offsetHeight > 0) {
      setWfPad(Math.max(0, firstWf.offsetHeight - hops.length * wfHopH()))
    }
  }

  onSettled(() => {
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && listEl) ro.observe(listEl)
    return () => ro?.disconnect()
  })

  // ResizeObserver alone won't catch header/waterfall heights the first time
  // they appear (switching flat ↔ grouped or toggling trace view rarely
  // resizes the container itself) — nudge a re-measure whenever the rendered
  // shape changes, deferred a tick so the new DOM exists.
  createEffect(
    () => [props.groups, props.traceView, props.spansByTrace, props.verboseSpans] as const,
    () => {
      queueMicrotask(measure)
    },
  )

  // The visible window: all rows below the threshold, a slice + spacers above it.
  const windowed = createMemo(() => {
    const all = props.requests
    if (all.length <= VIRTUALIZE_ABOVE) {
      return { slice: all, padTop: 0, padBottom: 0 }
    }
    const h = rowH()
    const vh = viewportH() || 400
    const start = Math.max(0, Math.floor(scrollTop() / h) - OVERSCAN)
    const count = Math.ceil(vh / h) + OVERSCAN * 2
    const end = Math.min(all.length, start + count)
    return {
      slice: all.slice(start, end),
      padTop: start * h,
      padBottom: (all.length - end) * h,
    }
  })

  // Narrows which trace groups render, by each group's root span's
  // requestKind. A no-op outside trace grouping or when unset/'all'.
  const visibleGroups = createMemo<RequestGroup[] | null>(() => {
    const groups = props.groups
    if (!groups) return null
    const kind = props.requestKindFilter
    if (!kind || kind === 'all' || !props.traceView) return groups
    return groups.filter((grp) => {
      const spans = spansFor(props.spansByTrace, grp.key)
      if (!groupShowsWaterfall(props.traceView, grp, spans.length)) return true // ungrouped/singleton buckets pass through unfiltered
      return summarizeTraceGroup(grp.items, spans).requestKind === kind
    })
  })

  // Flatten groups into one array of header/row entries so a single window
  // computation can virtualize across group boundaries.
  const flatGrouped = createMemo<FlatItem[]>(() => {
    const groups = visibleGroups()
    if (!groups) return []
    const out: FlatItem[] = []
    for (const grp of groups) {
      if (grp.items.length === 0) continue
      out.push({ kind: 'header', group: grp })
      for (const req of grp.items) out.push({ kind: 'row', group: grp, req })
    }
    return out
  })

  // Only virtualize the grouped branch once it's actually large enough to
  // matter — the common small-capture case keeps full unwindowed DOM,
  // preserving the stable group-object-identity benefit of hakka-core's
  // createGroupCache().
  const groupedIsVirtualized = () => flatGrouped().length > VIRTUALIZE_ABOVE

  const groupedWindow = createMemo<FlatWindow<FlatItem>>(() => {
    const items = flatGrouped()
    if (items.length <= VIRTUALIZE_ABOVE) {
      return { slice: items, padTop: 0, padBottom: 0 }
    }
    const h = rowH()
    const hh = headerH()
    const whh = wfHopH()
    const wpad = wfPad()
    const brh = badgeRowH()
    const verbose = Boolean(props.verboseSpans)
    const heights = items.map((item) => {
      if (item.kind === 'row') return h
      const grpSpans = spansFor(props.spansByTrace, item.group.key)
      const showsWf = groupShowsWaterfall(props.traceView, item.group, grpSpans.length)
      if (!showsWf) return hh
      // Bar count comes from the SAME assembleTraceTree call the waterfall
      // renders from (see barCountFor), not `item.group.items.length`.
      const bars = barCountFor(item.group, grpSpans, verbose)
      return hh + brh + wpad + bars * whh
    })
    return windowFlatItems(items, heights, scrollTop(), viewportH() || 400, OVERSCAN * h)
  })

  const isEmpty = () => {
    const g = visibleGroups()
    if (g !== null) return g.every((grp) => grp.items.length === 0)
    return props.requests.length === 0
  }

  const handleSelect = (req: NetworkRequest) => {
    if (props.selectMode) {
      props.onToggleSelect(req.id)
    } else {
      props.onSelect(req)
    }
  }

  return (
    <div
      class={`hakka-list${props.compact ? ' compact' : ''}`}
      ref={(el) => (listEl = el)}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
    >
      <Show
        when={!isEmpty()}
        fallback={
          <div class="hakka-list-empty">
            <span class="hakka-empty-icon">
              <IconInbox size={28} />
            </span>
            <span class="hakka-empty-title">No requests captured yet</span>
            <span class="hakka-empty-hint">
              Traffic from fetch, XHR, and WebSocket shows up here as your app makes requests.
            </span>
            <Show when={props.onLoadSample}>
              <div class="hakka-empty-actions">
                <button class="hakka-empty-sample-btn" onClick={() => props.onLoadSample?.()}>
                  Load sample traffic
                </button>
              </div>
              <span class="hakka-empty-sample-hint">
                Adds ~11 demo requests so you can try the inspector — Clear removes them.
              </span>
            </Show>
          </div>
        }
      >
        <Show when={visibleGroups() !== null}>
          <Show
            when={groupedIsVirtualized()}
            fallback={
              <For each={visibleGroups()!}>
                {(grp) => (
                  <Show when={grp.items.length > 0}>
                    <GroupHeaderBlock
                      group={grp}
                      traceView={props.traceView}
                      selected={props.selected}
                      onSelect={props.onSelect}
                      spansByTrace={props.spansByTrace}
                      verboseSpans={props.verboseSpans}
                      onToggleVerbose={() => props.onToggleVerboseSpans?.()}
                    />
                    <For each={grp.items}>
                      {(req) => (
                        <RequestRow
                          req={req}
                          selected={props.selected?.id === req.id}
                          onSelect={() => handleSelect(req)}
                          selectMode={props.selectMode}
                          checked={props.selectedIds.has(req.id)}
                        />
                      )}
                    </For>
                  </Show>
                )}
              </For>
            }
          >
            {/* Windows across group boundaries by *position* (keyed={false}):
                a slice's positions are stable frame to frame, not the
                identity of any one flat-item wrapper, which is rebuilt every
                recompute. */}
            <Show when={groupedWindow().padTop > 0}>
              <div style={{ height: `${groupedWindow().padTop}px` }} />
            </Show>
            <For each={groupedWindow().slice} keyed={false}>
              {(item) => (
                <Show
                  when={item().kind === 'header'}
                  fallback={
                    <RequestRow
                      req={(item() as RowFlatItem).req}
                      selected={props.selected?.id === (item() as RowFlatItem).req.id}
                      onSelect={() => handleSelect((item() as RowFlatItem).req)}
                      selectMode={props.selectMode}
                      checked={props.selectedIds.has((item() as RowFlatItem).req.id)}
                    />
                  }
                >
                  <GroupHeaderBlock
                    group={(item() as HeaderFlatItem).group}
                    traceView={props.traceView}
                    selected={props.selected}
                    onSelect={props.onSelect}
                    spansByTrace={props.spansByTrace}
                    verboseSpans={props.verboseSpans}
                    onToggleVerbose={() => props.onToggleVerboseSpans?.()}
                  />
                </Show>
              )}
            </For>
            <Show when={groupedWindow().padBottom > 0}>
              <div style={{ height: `${groupedWindow().padBottom}px` }} />
            </Show>
          </Show>
        </Show>

        <Show when={props.groups === null}>
          <Show when={windowed().padTop > 0}>
            <div style={{ height: `${windowed().padTop}px` }} />
          </Show>
          <For each={windowed().slice} keyed={false}>
            {(item) => (
              <RequestRow
                req={item()}
                selected={props.selected?.id === item().id}
                onSelect={() => handleSelect(item())}
                selectMode={props.selectMode}
                checked={props.selectedIds.has(item().id)}
              />
            )}
          </For>
          <Show when={windowed().padBottom > 0}>
            <div style={{ height: `${windowed().padBottom}px` }} />
          </Show>
        </Show>
      </Show>
    </div>
  )
}
