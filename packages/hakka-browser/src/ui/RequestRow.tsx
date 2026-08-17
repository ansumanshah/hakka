import type { NetworkRequest } from 'hakka-core'
import { getRequestStatus, RequestStatus, formatBytes, formatDuration, parseUrl, extractHost } from 'hakka-core'
import { Show } from 'solid-js'
import type { Component } from 'solid-js'

import { IconCheck } from './icons'
import { durationTier, sizeTier } from './numberGates'

// Exported — Inspector.tsx's floating-launcher HUD reuses this for its
// recent-requests summary; keep it in sync rather than forking a copy.
export function methodClass(method: string): string {
  const m = method.toUpperCase()
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return `method-${m}`
  return 'method-OTHER'
}

export function statusClass(req: NetworkRequest): string {
  const s = getRequestStatus(req)
  switch (s) {
    case RequestStatus.Success:
      return 'status-success'
    case RequestStatus.Error:
      return 'status-error'
    case RequestStatus.Pending:
      return 'status-pending'
    default:
      return 'status-pending'
  }
}

export function statusLabel(req: NetworkRequest): string {
  // Status-code-first: statusClass() colors error-first, but the TEXT never
  // hides a real code behind 'ERR' — a 200-with-ECONNRESET still reads 200.
  // 'ERR' is the no-code fallback. Also used as the Detail header text.
  if (req.status != null) return String(req.status)
  if (req.error) return 'ERR'
  return '…'
}

/**
 * Runtime tag tooltip. Edge has no `AsyncLocalStorage`, so `hakka-node`'s
 * trace propagation is disabled there (`startCapture`'s `runtime !== 'edge'`
 * guard) — a trace that stops at an edge hop isn't a bug; say so here.
 */
function runtimeTitle(runtime: string): string {
  if (runtime === 'edge') return 'edge runtime — no trace correlation (no AsyncLocalStorage)'
  return `${runtime} runtime`
}

// Row-tap origin — the list row and detail header are the same component, so
// "expanding" is a FLIP: record where the tap landed, and Detail slides its
// header from that y on mount. The freshness window below stops a stale
// record from animating an unrelated mount.
let rowTapOrigin: { y: number; t: number } | null = null

function recordRowTapOrigin(y: number): void {
  rowTapOrigin = { y, t: Date.now() }
}

/** Returns the tap's viewport y if recorded within the last 400ms, else null. Consumes the record. */
export function consumeRowTapOrigin(): number | null {
  const o = rowTapOrigin
  rowTapOrigin = null
  if (!o || Date.now() - o.t > 400) return null
  return o.y
}

interface RequestRowProps {
  req: NetworkRequest
  /** True when this row is the detail-selected row (non-select-mode). */
  selected: boolean
  onSelect: () => void
  /** Multi-select props — when set, row shows checkbox + uses checked styling. */
  selectMode?: boolean
  checked?: boolean
}

export const RequestRow: Component<RequestRowProps> = (props) => {
  const pathDisplay = () => parseUrl(props.req.url).path || '/'
  const host = () => extractHost(props.req.url)

  const dur = () => {
    if (props.req.duration != null) return formatDuration(props.req.duration)
    return '…'
  }

  const size = () => {
    const s = props.req.responseBodySize ?? props.req.size
    if (s != null) return formatBytes(s)
    return ''
  }

  const rowClass = () => {
    const parts = ['hakka-row']
    if (props.selectMode) parts.push('multi-select-mode')
    if (props.selectMode && props.checked) parts.push('row-selected')
    else if (!props.selectMode && props.selected) parts.push('selected')
    // Severity stripe on the row's left edge — errors/5xx chili, 4xx turmeric.
    const s = props.req.status
    if (props.req.error || (s != null && s >= 500)) parts.push('is-error')
    else if (s != null && s >= 400) parts.push('is-warn')
    return parts.join(' ')
  }

  return (
    <div
      class={rowClass()}
      onClick={(e) => {
        recordRowTapOrigin(e.currentTarget.getBoundingClientRect().top)
        props.onSelect()
      }}
    >
      <Show when={props.selectMode}>
        <span class={`hakka-row-checkbox${props.checked ? ' checked' : ''}`}>
          <Show when={props.checked}>
            <IconCheck size={12} />
          </Show>
        </span>
      </Show>
      <span class={`hakka-method-badge ${methodClass(props.req.method)}`}>{props.req.method.toUpperCase()}</span>
      <div class="hakka-row-url">
        <div class="hakka-row-path">{pathDisplay()}</div>
        <div class="hakka-row-host">{host()}</div>
      </div>
      <div class="hakka-row-meta">
        {/* One wrapper for 0-5 optional badges (runtime/cache/graphql/mock/live) —
            keeps them ONE grid cell in the wide row-grid layout instead of each
            becoming its own auto-placed track and misaligning status/size/duration. */}
        <div class="hakka-row-badges">
          <Show when={props.req.runtime && props.req.runtime !== 'client'}>
            <span class={`hakka-rt-tag hakka-rt-${props.req.runtime}`} title={runtimeTitle(props.req.runtime!)}>
              {props.req.runtime}
            </span>
          </Show>
          {/* Cache badge — .hakka-rt-tag pill base + a per-status tone class
              (hit=jade, stale=turmeric, miss stays neutral). */}
          <Show when={props.req.cacheStatus}>
            <span
              class={`hakka-rt-tag hakka-cache-${props.req.cacheStatus!.toLowerCase()}`}
              title={`data cache: ${props.req.cacheStatus}`}
            >
              {props.req.cacheStatus!.toLowerCase()}
            </span>
          </Show>
          <Show when={props.req.graphql}>
            <span class="hakka-gql-tag" title={`GraphQL ${props.req.graphql!.operationType}`}>
              {props.req.graphql!.operationName ?? 'GQL'}
            </span>
          </Show>
          <Show when={props.req.mocked}>
            <span class="hakka-mocked-tag">mock</span>
          </Show>
          <Show when={props.req.streaming}>
            <span class="hakka-rt-tag hakka-live-tag" title="stream still receiving">
              live
            </span>
          </Show>
        </div>
        <span class={`hakka-status ${statusClass(props.req)}`}>{statusLabel(props.req)}</span>
        {/* Duration over size in one column on mobile/compact (mirrors path-over-host);
            becomes two aligned grid columns at >=768px — see the row-grid rule in styles.ts. */}
        <div class="hakka-row-timing">
          <span class={`hakka-row-dur ${durationTier(props.req.duration)}`}>{dur()}</span>
          <Show when={size()}>
            <span class={`hakka-row-size ${sizeTier(props.req.responseBodySize ?? props.req.size)}`}>{size()}</span>
          </Show>
        </div>
      </div>
    </div>
  )
}
