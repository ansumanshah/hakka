import type { TraceBadgeSummary } from 'hakka-core'
import { formatDuration } from 'hakka-core'
import { Show } from 'solid-js'
import type { Component } from 'solid-js'

/**
 * TraceBadgeRow — badge strip + slowest-op callout + verbose toggle for one
 * trace group's header. Pure props-driven, no view-model of its own.
 *
 * Every indicator reuses a shared component: method/status/requestKind are
 * `.hakka-rt-tag` pills (same as `RequestRow.tsx`'s badges, never `.hakka-chip`,
 * which DESIGN.md reserves for interactive controls); fetchCount/operationCount
 * are `.hakka-count-badge`; the verbose toggle is `.hakka-switch`, same markup
 * as `SettingsTab.tsx`/`MockTab.tsx`. cacheSummary and slowest-op render as
 * plain prose, not tags.
 */
interface TraceBadgeRowProps {
  summary: TraceBadgeSummary
  verbose: boolean
  onToggleVerbose: () => void
}

function statusLabel(status: TraceBadgeSummary['status']): string {
  if (status === 'pending') return '…'
  if (status == null) return '…'
  return String(status)
}

export const TraceBadgeRow: Component<TraceBadgeRowProps> = (props) => {
  return (
    <div class="hakka-trace-badges">
      <Show when={props.summary.method}>
        <span class="hakka-rt-tag">{props.summary.method}</span>
      </Show>
      <Show when={props.summary.status != null}>
        <span class="hakka-rt-tag">{statusLabel(props.summary.status)}</span>
      </Show>
      <Show when={props.summary.requestKind}>
        <span class={`hakka-rt-tag hakka-kind-${props.summary.requestKind}`}>{props.summary.requestKind}</span>
      </Show>
      <span class="hakka-count-badge sm" title="Fetch/XHR/WebSocket requests captured for this trace">
        {props.summary.fetchCount}
      </span>
      <span class="hakka-count-badge sm" title="Total operations (requests + framework spans)">
        {props.summary.operationCount}
      </span>
      <span class="hakka-trace-badge-prose">{props.summary.cacheSummary}</span>
      <Show when={props.summary.slowest}>
        {(slowest) => (
          <span class="hakka-trace-badge-prose">
            Slowest: {slowest().label} ({formatDuration(slowest().durationMs)})
          </span>
        )}
      </Show>
      <div class="hakka-trace-badge-spacer" />
      <label class="hakka-trace-verbose-toggle">
        <span>Verbose</span>
        <button
          type="button"
          aria-label="Toggle verbose spans"
          aria-pressed={props.verbose ? 'true' : 'false'}
          class={`hakka-switch${props.verbose ? ' on' : ''}`}
          onClick={props.onToggleVerbose}
        >
          <div class="hakka-switch-knob" />
        </button>
      </label>
    </div>
  )
}
