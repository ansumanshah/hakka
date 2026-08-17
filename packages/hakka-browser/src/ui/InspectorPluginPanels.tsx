// Plugin-registered panels (PANEL_REGISTRY) — everything besides the
// built-in Network tab — plus the request-diff overlay. Both render inside
// `.hakka-panel` (the diff overlay's `position:absolute;inset:0` is relative
// to that container), so this stays a sibling of InspectorNetworkPane rather
// than a top-level overlay like the command palette or tour.
import type { HakkaPanel, NetworkRequest } from 'hakka-core'
import type { Component } from 'solid-js'
import { lazy, For, Loading, Show } from 'solid-js'

import { PANEL_REGISTRY } from './panelRegistry'

// Occasional full-overlay feature — lazy chunk fetched only the first time
// the user opens a compare (same pattern as CommandPalette/Tour).
const RequestDiff = lazy(() => import('./RequestDiff').then((m) => ({ default: m.RequestDiff })))

interface InspectorPluginPanelsProps {
  panels: HakkaPanel[]
  tab: () => string
  diffPair: () => [NetworkRequest, NetworkRequest] | null
  onCloseCompare: () => void
}

export const InspectorPluginPanels: Component<InspectorPluginPanelsProps> = (props) => (
  <>
    {/* Plugin-registered panels via PANEL_REGISTRY — each is a lazy()
        chunk fetched on first open, hence the Loading boundary. */}
    <For each={props.panels.filter((p) => p.id !== 'network')}>
      {(p) => {
        const PanelComponent = PANEL_REGISTRY[p.id]
        return (
          <Show when={props.tab() === p.id}>
            {PanelComponent ? (
              <Loading fallback={<div class="hakka-panel-loading">Loading…</div>}>
                <PanelComponent active={props.tab() === p.id} />
              </Loading>
            ) : (
              <div style="padding:var(--hakka-space-xl);color:var(--hakka-text-tertiary);font-size:var(--hakka-font-sm)">
                No renderer registered for panel &quot;{p.id}&quot;
              </div>
            )}
          </Show>
        )
      }}
    </For>

    {/* Request diff — overlays the whole panel when two requests are being compared. */}
    <Show when={props.diffPair() !== null}>
      <div class="hakka-network-detail-pane" style="position:absolute;inset:0;z-index:5;background:var(--hakka-bg)">
        <Loading fallback={<div class="hakka-panel-loading">Loading…</div>}>
          <RequestDiff left={props.diffPair()![0]} right={props.diffPair()![1]} onClose={props.onCloseCompare} />
        </Loading>
      </div>
    </Show>
  </>
)
