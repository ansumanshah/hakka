import { formatBytes, formatDuration } from 'hakka-core'
import { createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import type { Component } from 'solid-js'

import { store } from '../worker'
import type { PanelProps } from './panelRegistry'
import { createStatsViewModel, type MethodBucket, type StatsViewModel } from './viewModels'

interface BarProps {
  count: number
  total: number
  color: string
  label: string
}

const ProportionBar: Component<BarProps> = (props) => {
  const pct = () => (props.total > 0 ? (props.count / props.total) * 100 : 0)

  return (
    <div style="display:flex;align-items:center;gap:var(--hakka-space-md);margin-bottom:var(--hakka-space-md)">
      <div
        style={`font-size:var(--hakka-font-xs);font-weight:600;color:${props.color};width:52px;flex-shrink:0;font-family:var(--hakka-font-mono)`}
      >
        {props.label}
      </div>
      {/* Track — ui-token-check-ignore-next-line: bar-chart track thickness */}
      <div style="flex:1;height:10px;background:var(--hakka-surface-raised);border-radius:var(--hakka-radius-sm);overflow:hidden">
        <div
          style={`height:100%;width:${pct().toFixed(1)}%;background:${props.color};border-radius:var(--hakka-radius-sm);transition:width 0.3s ease`}
        />
      </div>
      <div style="font-size:var(--hakka-font-xs);color:var(--hakka-text-tertiary);width:60px;flex-shrink:0;text-align:right">
        {props.count}{' '}
        <span style="color:var(--hakka-text-tertiary);font-size:var(--hakka-font-xs)">({pct().toFixed(0)}%)</span>
      </div>
    </div>
  )
}

export interface StatsTabProps extends PanelProps {
  /**
   * Injected view-model (ADR 0003 (b)) — omit to default-construct one
   * against the shared store singleton. A future `<hakka-stats>` custom
   * element passes its own instance here instead.
   */
  viewModel?: StatsViewModel
}

export const StatsTab: Component<StatsTabProps> = (props) => {
  // Aggregation lives in StatsViewModel (viewModels/StatsViewModel.ts) — this
  // component only renders its snapshot.
  const vm = props.viewModel ?? createStatsViewModel({ store: store() })
  const [snap, setSnap] = createSignal(vm.getSnapshot())

  onSettled(() => {
    const off = vm.subscribe(() => setSnap(vm.getSnapshot()))
    // onSettled runs later than onMount — resync in case the view-model
    // emitted between first render and settle.
    setSnap(vm.getSnapshot())
    return () => {
      off()
      // Only tear down a view-model this component created — an injected one
      // is owned by whoever constructed it.
      if (!props.viewModel) vm.destroy()
    }
  })

  const total = createMemo(() => snap().total)

  const statusCounts = createMemo(() => ({
    success: snap().success,
    error: snap().error,
    pending: snap().pending,
  }))

  const statusClassCounts = createMemo(() => snap().statusClass)

  const methodCounts = createMemo(() => snap().method)

  const durationStats = createMemo(() => snap().duration)

  const totalBytes = createMemo(() => snap().bytes)

  const uniqueHostCount = createMemo(() => snap().uniqueHosts)

  const METHOD_COLOR: Record<MethodBucket, string> = {
    GET: 'var(--hakka-method-get)',
    POST: 'var(--hakka-method-post)',
    PUT: 'var(--hakka-method-put)',
    PATCH: 'var(--hakka-method-patch)',
    DELETE: 'var(--hakka-method-delete)',
    OTHER: 'var(--hakka-method-other)',
  }

  return (
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
      {/* No tab-level title/header — tab strip is the title (DESIGN.md), same as Network. */}
      <div class="hakka-tab-content">
        <Show
          when={total() > 0}
          fallback={
            <div class="hakka-list-empty">
              <span class="hakka-empty-title">No requests captured yet</span>
            </div>
          }
        >
          <p class="hakka-section-title">Overview</p>
          <table class="hakka-kv-table" style="margin-bottom:var(--hakka-space-xl)">
            <tbody>
              <tr>
                <td class="hakka-kv-key">Total requests</td>
                <td class="hakka-kv-value">{total()}</td>
              </tr>
              <tr>
                <td class="hakka-kv-key">Unique hosts</td>
                <td class="hakka-kv-value">{uniqueHostCount()}</td>
              </tr>
              <tr>
                <td class="hakka-kv-key">Total transferred</td>
                <td class="hakka-kv-value">{formatBytes(totalBytes())}</td>
              </tr>
            </tbody>
          </table>

          <p class="hakka-section-title">Status</p>
          <div style="margin-bottom:var(--hakka-space-xl)">
            <ProportionBar
              count={statusCounts().success}
              total={total()}
              color="var(--hakka-status-success)"
              label="Success"
            />
            <ProportionBar
              count={statusCounts().error}
              total={total()}
              color="var(--hakka-status-error)"
              label="Error"
            />
            <ProportionBar
              count={statusCounts().pending}
              total={total()}
              color="var(--hakka-status-pending)"
              label="Pending"
            />
          </div>

          <p class="hakka-section-title">HTTP status class</p>
          <div style="margin-bottom:var(--hakka-space-xl)">
            <ProportionBar
              count={statusClassCounts()['2xx']}
              total={total()}
              color="var(--hakka-status-success)"
              label="2xx"
            />
            <ProportionBar
              count={statusClassCounts()['3xx']}
              total={total()}
              color="var(--hakka-status-info)"
              label="3xx"
            />
            <ProportionBar
              count={statusClassCounts()['4xx']}
              total={total()}
              color="var(--hakka-status-warning)"
              label="4xx"
            />
            <ProportionBar
              count={statusClassCounts()['5xx']}
              total={total()}
              color="var(--hakka-status-error)"
              label="5xx"
            />
          </div>

          <p class="hakka-section-title">Methods</p>
          <div style="margin-bottom:var(--hakka-space-xl)">
            <For each={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OTHER'] as const}>
              {(m) => (
                <Show when={methodCounts()[m] > 0}>
                  <ProportionBar count={methodCounts()[m]} total={total()} color={METHOD_COLOR[m]} label={m} />
                </Show>
              )}
            </For>
          </div>

          <Show when={durationStats() != null}>
            <p class="hakka-section-title">Duration</p>
            <table class="hakka-kv-table" style="margin-bottom:var(--hakka-space-xl)">
              <tbody>
                <tr>
                  <td class="hakka-kv-key">Avg</td>
                  <td class="hakka-kv-value">{formatDuration(durationStats()!.avg)}</td>
                </tr>
                <tr>
                  <td class="hakka-kv-key">Min</td>
                  <td class="hakka-kv-value">{formatDuration(durationStats()!.min)}</td>
                </tr>
                <tr>
                  <td class="hakka-kv-key">Max</td>
                  <td class="hakka-kv-value">{formatDuration(durationStats()!.max)}</td>
                </tr>
                <Show when={durationStats()!.p95 != null}>
                  <tr>
                    <td class="hakka-kv-key">p95</td>
                    <td class="hakka-kv-value">{formatDuration(durationStats()!.p95!)}</td>
                  </tr>
                </Show>
                <tr>
                  <td class="hakka-kv-key">Sampled</td>
                  <td class="hakka-kv-value" style="color:var(--hakka-text-tertiary)">
                    {durationStats()!.count} of {total()}
                  </td>
                </tr>
              </tbody>
            </table>
          </Show>
        </Show>
      </div>
    </div>
  )
}
