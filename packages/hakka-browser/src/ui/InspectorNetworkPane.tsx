// Network tab content — filter bar + request list on the left, request
// detail on the right (wide viewports) or swapped in via drill-down (narrow
// viewports). Wide viewports keep the list pane mounted alongside Detail
// (split view); narrow viewports render only whichever side is active.
import type { FrameworkSpan, NetworkRequest, RequestGroup } from 'hakka-core'
import type { Component } from 'solid-js'
import { Show } from 'solid-js'

import { Detail } from './Detail'
import { FilterBar } from './FilterBar'
import { RequestList } from './RequestList'
import type {
  FilterState,
  FilterViewModel,
  RequestListViewModel,
  SelectionState,
  SelectionViewModel,
} from './viewModels'

interface InspectorNetworkPaneProps {
  filters: FilterViewModel
  filterSnap: () => FilterState
  selection: SelectionViewModel
  selectionSnap: () => SelectionState
  requestListVm: RequestListViewModel
  searchSuggestions: () => string[] | undefined
  hasServerCaptures: () => boolean
  compact: () => boolean
  onToggleCompact: () => void
  searchInputRef: (el: HTMLInputElement) => void
  requestKindFilter: () => string
  onRequestKindFilterChange: (v: string) => void
  isFiltered: () => boolean
  filteredRequests: () => NetworkRequest[]
  requestCount: () => number
  requestGroups: () => RequestGroup[] | null
  spansByTrace: () => ReadonlyMap<string, FrameworkSpan[]> | undefined
  selected: () => NetworkRequest | null
  onSelect: (req: NetworkRequest | null) => void
  isWide: () => boolean
  canCompare: () => boolean
  onOpenCompare: () => void
  bulkExportHar: () => Promise<void>
  bulkCopyCurl: () => Promise<void>
  bulkExportPostman: () => Promise<void>
  bulkExportOtel: () => Promise<void>
}

export const InspectorNetworkPane: Component<InspectorNetworkPaneProps> = (props) => (
  <div class={`hakka-network-split${props.selected() !== null ? ' has-detail' : ''}`}>
    <Show when={props.selected() === null || props.isWide()}>
      <div class="hakka-network-list-pane">
        {/* FilterBar owns the full filter UI (ADR 0003 (b)) — Inspector only
            wires in values that live elsewhere (search suggestions from
            RequestListViewModel, density/select-mode). */}
        <FilterBar
          filters={props.filters}
          suggestions={props.searchSuggestions()}
          hasServerCaptures={props.hasServerCaptures()}
          compact={props.compact()}
          onToggleCompact={props.onToggleCompact}
          selectMode={props.selectionSnap().selectMode}
          onToggleSelectMode={() => props.selection.intents.setSelectMode(!props.selectionSnap().selectMode)}
          inputRef={props.searchInputRef}
          requestKindFilter={props.requestKindFilter()}
          onRequestKindFilterChange={props.onRequestKindFilterChange}
        />
        {/* Scope hint — the header HAR/OTel/Postman buttons export exactly this visible subset */}
        <Show when={props.isFiltered() && !props.selectionSnap().selectMode}>
          <div class="hakka-filter-bar hakka-filter-sub">
            <span style="font-size:var(--hakka-font-xs);color:var(--hakka-text-tertiary);white-space:nowrap">
              Showing {props.filteredRequests().length} of {props.requestCount()} — exports apply to the visible list
            </span>
          </div>
        </Show>
        <RequestList
          requests={props.filteredRequests()}
          groups={props.requestGroups()}
          traceView={props.filterSnap().groupBy === 'trace'}
          selected={props.selected()}
          onSelect={(req) => props.onSelect(req)}
          selectMode={props.selectionSnap().selectMode}
          selectedIds={props.selectionSnap().selectedIds}
          onToggleSelect={props.selection.intents.toggleSelectId}
          compact={props.compact()}
          onLoadSample={() => void props.requestListVm.intents.loadSampleTraffic()}
          spansByTrace={props.spansByTrace()}
          verboseSpans={props.filterSnap().verboseSpans}
          onToggleVerboseSpans={() => props.filters.intents.setVerboseSpans(!props.filterSnap().verboseSpans)}
          requestKindFilter={props.requestKindFilter()}
        />
        <Show when={props.selectionSnap().selectMode && props.selectionSnap().selectedIds.size > 0}>
          <div class="hakka-action-bar">
            <span class="hakka-action-bar-count">{props.selectionSnap().selectedIds.size} selected</span>
            <button class="hakka-action-btn" onClick={() => void props.bulkExportHar()} title="Export HAR for selected">
              HAR
            </button>
            <button
              class="hakka-action-btn"
              onClick={() => void props.bulkCopyCurl()}
              title="Copy cURL for selected to clipboard"
            >
              cURL
            </button>
            <button
              class="hakka-action-btn"
              onClick={() => void props.bulkExportPostman()}
              title="Export Postman collection for selected"
            >
              Postman
            </button>
            <button
              class="hakka-action-btn"
              onClick={() => void props.bulkExportOtel()}
              title="Export OTel JSON for selected"
            >
              OTel
            </button>
            <Show when={props.canCompare()}>
              <button class="hakka-action-btn" onClick={props.onOpenCompare} title="Compare the two selected requests">
                Compare
              </button>
            </Show>
            <div class="hakka-action-spacer" />
            <button
              class="hakka-action-btn hakka-action-btn-danger"
              onClick={() => {
                for (const id of props.selectionSnap().selectedIds) props.requestListVm.intents.removeFromView(id)
                props.selection.intents.setSelectMode(false)
              }}
              title="Remove selected from list"
            >
              Remove
            </button>
            <button class="hakka-action-cancel" onClick={() => props.selection.intents.setSelectMode(false)}>
              Cancel
            </button>
          </div>
        </Show>
      </div>
    </Show>
    <Show when={props.selected() !== null}>
      <div class="hakka-network-detail-pane">
        <Detail req={props.selected()!} onBack={() => props.onSelect(null)} />
      </div>
    </Show>
  </div>
)
