import type { GroupBy } from 'hakka-core'
import { createSignal, For, onSettled, Show } from 'solid-js'
import type { Component } from 'solid-js'

import {
  IconChevronDown,
  IconClose,
  IconFunnel,
  IconInfo,
  IconRows,
  IconSearch,
  IconSort,
  IconSparkle,
  IconSwap,
} from './icons'
import { CONTENT_TYPES, GROUP_OPTIONS, RUNTIMES, SORT_COMBOS, STATUS_CHIPS, type FilterViewModel } from './viewModels'

/** Public search-DSL reference — the cheat-sheet the ⓘ affordance below links out to. */
const SEARCH_DSL_DOCS_URL = 'https://hakka.noodleapps.com/spec/search-dsl/'

// Compact duration/size range number inputs — .hakka-input on the cluster's var(--hakka-ctl-h) line.
const RANGE_INPUT_STYLE =
  'width:56px;height:var(--hakka-ctl-h);padding:0 var(--hakka-space-sm);font-size:var(--hakka-font-sm)'

export interface FilterBarProps {
  /**
   * The shared filter/sort/group slice — required, unlike `Detail`/`StatsTab`'s
   * optional `viewModel` prop. A default-constructed `FilterViewModel` is
   * inert (no `<hakka-request-list>` would see its mutations), so the caller
   * (`Inspector.tsx`) always owns and passes one in.
   */
  filters: FilterViewModel
  /**
   * Autocomplete suggestions: recent filters first, then matching hosts, then
   * scope hints. Needs the raw store mirror (to rank hosts), which lives in
   * `RequestListViewModel`, not here — passed through rather than owned.
   */
  suggestions?: string[]
  /** True once any captured request carries a non-client runtime — gates the Runtime segmented control. */
  hasServerCaptures: boolean
  /**
   * Compact row density + multi-select mode toggles. Not filter state — they
   * belong to `RequestList`'s own display preference and `SelectionViewModel`
   * respectively — passed through so the cluster layout isn't duplicated in
   * `Inspector.tsx`.
   */
  compact: boolean
  onToggleCompact: () => void
  selectMode: boolean
  onToggleSelectMode: () => void
  /** Ref callback for the search `<input>` — lets the Inspector focus it via the '/' shortcut. */
  inputRef?: (el: HTMLInputElement) => void
  /**
   * Request-kind filter — client-side-only, NOT part of `FilterViewModel`'s
   * `AdvancedQuery`-backed state (it filters visible trace GROUPS by their
   * root span's `requestKind`, which `compileQuery` doesn't model). `'all'`
   * = no constraint. Only meaningful (and only shown) while grouped by trace.
   */
  requestKindFilter?: string
  onRequestKindFilterChange?: (value: string) => void
}

/** Request-kind options for the advanced-cluster segmented filter. */
const REQUEST_KINDS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'document', label: 'Document' },
  { id: 'rsc', label: 'RSC' },
  { id: 'route-handler', label: 'Route' },
  { id: 'server-action', label: 'Action' },
]

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export const FilterBar: Component<FilterBarProps> = (props) => {
  const [snap, setSnap] = createSignal(props.filters.getSnapshot())
  onSettled(() => {
    const unsub = props.filters.subscribe(() => setSnap(props.filters.getSnapshot()))
    // onSettled runs later than 1.x onMount — re-pull immediately so any
    // mutation between first render and settle isn't missed forever.
    setSnap(props.filters.getSnapshot())
    return unsub
  })

  // Recents are a recall affordance for an EMPTY search box — while a query is
  // live they just echo it back as noise (and cost a row on mobile).
  const visibleRecents = () => (snap().filterText.trim() ? [] : snap().recentFilters)
  const hasSavedOrRecent = () => snap().savedFilters.length > 0 || visibleRecents().length > 0

  const handleSaveFilter = () => {
    const name = window.prompt('Save filter as:')
    if (!name) return
    props.filters.intents.saveFilter(name)
  }

  return (
    <>
      {/* Primary row — one full-width search field. AI toggle, ⓘ syntax
          reference, and Filters disclosure ride inside the input's trailing
          edge; method/status quick chips live in the Filters panel. */}
      <div class="hakka-filter-bar">
        <Show when={props.suggestions && props.suggestions.length > 0}>
          <datalist id="hakka-search-suggestions">
            <For each={props.suggestions ?? []}>{(s) => <option value={s} />}</For>
          </datalist>
        </Show>
        {/* Plain human placeholder, not a syntax dump — the full grammar
            lives in the ⓘ affordance right after it. */}
        <div class="hakka-search-wrap">
          <span class="hakka-search-icon" aria-hidden="true">
            <IconSearch size={13} />
          </span>
          <input
            ref={props.inputRef}
            class="hakka-search"
            type="text"
            placeholder={snap().nlMode ? 'Describe: "slow POSTs to /checkout"' : 'Search'}
            value={snap().filterDisplay}
            onInput={(e) => props.filters.intents.setFilterText(e.currentTarget.value)}
            list={props.suggestions && props.suggestions.length > 0 ? 'hakka-search-suggestions' : undefined}
          />
          <div class="hakka-search-trailing">
            <button
              class={`hakka-chip${snap().nlMode ? ' active' : ''}`}
              onClick={props.filters.intents.toggleNlMode}
              title="AI search — describe what you want in plain English and it's converted to the search syntax"
              aria-pressed={snap().nlMode ? 'true' : 'false'}
              aria-label="Toggle AI search"
            >
              <IconSparkle size={11} /> AI
            </button>
            <details class="hakka-menu hakka-search-help">
              <summary
                class="hakka-btn hakka-search-help-btn"
                title="Search syntax reference"
                aria-label="Search syntax reference"
              >
                <IconInfo size={13} />
              </summary>
              <div class="hakka-menu-list hakka-search-help-list">
                <div class="hakka-search-help-row">
                  <code>url:/path</code>
                  <span>match the URL path</span>
                </div>
                <div class="hakka-search-help-row">
                  <code>header:auth</code>
                  <span>match a request/response header</span>
                </div>
                <div class="hakka-search-help-row">
                  <code>/regex/</code>
                  <span>regular expression</span>
                </div>
                <div class="hakka-search-help-row">
                  <code>*glob*</code>
                  <span>wildcard match</span>
                </div>
                <div class="hakka-search-help-row">
                  <code>-negate</code>
                  <span>exclude a term</span>
                </div>
                <div class="hakka-search-help-row">
                  <code>dur&gt;100</code>
                  <span>duration filter (ms)</span>
                </div>
                <div class="hakka-search-help-row">
                  <code>size&lt;2kb</code>
                  <span>body size filter</span>
                </div>
                <a class="hakka-search-help-link" href={SEARCH_DSL_DOCS_URL} target="_blank" rel="noopener noreferrer">
                  Full search syntax docs →
                </a>
              </div>
            </details>
            <button
              class={`hakka-chip${snap().advOpen || snap().advancedCount > 0 ? ' active' : ''}`}
              onClick={props.filters.intents.toggleAdvanced}
              title="Show method, status, sort, group, type, and range filters"
              aria-expanded={snap().advOpen ? 'true' : 'false'}
              aria-label="Toggle filters"
            >
              <IconFunnel size={11} />
              {snap().advancedCount > 0 ? ` +${snap().advancedCount}` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* Advanced filter group — one composed panel behind "Filters", a
          single wrapping cluster: wide viewports share one row with view
          tools pinned right, narrow viewports wrap naturally. */}
      <div class={`hakka-filter-adv${snap().advOpen ? '' : ' hakka-collapsed'}`}>
        {/* Quick chips — two labeled rows (Method, Status): quiet at rest,
            semantic color only when active. Labeled like every other cluster
            so the panel scans as named rows. */}
        <div class="hakka-filter-cluster hakka-method-chips">
          <span class="hakka-filter-label">Method</span>
          <For each={METHODS}>
            {(m) => (
              <button
                class={`hakka-chip method-${m}${snap().methodFilter === m ? ' active' : ''}`}
                onClick={() => props.filters.intents.setMethodFilter(snap().methodFilter === m ? '' : m)}
              >
                {m}
              </button>
            )}
          </For>
        </div>
        <div class="hakka-filter-cluster hakka-method-chips">
          <span class="hakka-filter-label">Status</span>
          <For each={STATUS_CHIPS.filter((c) => c !== 'all')}>
            {(chip) => (
              <button
                class={`hakka-chip status-${chip}${snap().statusChip === chip ? ' active' : ''}`}
                aria-pressed={snap().statusChip === chip ? 'true' : 'false'}
                title={`Only ${chip} responses`}
                onClick={() => props.filters.intents.setStatusChip(snap().statusChip === chip ? 'all' : chip)}
              >
                {chip}
              </button>
            )}
          </For>
        </div>
        {/* Runtime / Kind / Type — same labeled chip-row grammar as
            Method/Status, no "All" chip: nothing selected means no
            constraint, tapping the active chip clears it. */}
        <Show when={props.hasServerCaptures}>
          <div class="hakka-filter-cluster">
            <span class="hakka-filter-label">Runtime</span>
            <For each={RUNTIMES.filter((rt) => rt.id !== 'all')}>
              {(rt) => (
                <button
                  class={`hakka-chip${snap().runtimeFilter === rt.id ? ' active' : ''}`}
                  aria-pressed={snap().runtimeFilter === rt.id ? 'true' : 'false'}
                  onClick={() => props.filters.intents.setRuntimeFilter(snap().runtimeFilter === rt.id ? 'all' : rt.id)}
                >
                  {rt.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={snap().groupBy === 'trace'}>
          <div class="hakka-filter-cluster">
            <span class="hakka-filter-label">Kind</span>
            <For each={REQUEST_KINDS.filter((k) => k.id !== 'all')}>
              {(k) => (
                <button
                  class={`hakka-chip${props.requestKindFilter === k.id ? ' active' : ''}`}
                  aria-pressed={props.requestKindFilter === k.id ? 'true' : 'false'}
                  onClick={() => props.onRequestKindFilterChange?.(props.requestKindFilter === k.id ? 'all' : k.id)}
                >
                  {k.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="hakka-filter-cluster">
          <span class="hakka-filter-label">Type</span>
          <For each={CONTENT_TYPES.filter((ct) => ct.id !== 'all')}>
            {(ct) => (
              <button
                class={`hakka-chip${snap().contentType === ct.id ? ' active' : ''}`}
                aria-pressed={snap().contentType === ct.id ? 'true' : 'false'}
                onClick={() => props.filters.intents.setContentType(snap().contentType === ct.id ? 'all' : ct.id)}
              >
                {ct.label}
              </button>
            )}
          </For>
        </div>
        {/* Sort collapses field + direction into one human select ("Newest",
            "Slowest", "Errors first"). */}
        <div class="hakka-filter-cluster">
          <span class="hakka-filter-label">
            <IconSort size={11} /> Sort
          </span>
          <span class="hakka-select-wrap">
            <select
              class="hakka-select"
              value={`${snap().sortField}-${snap().sortOrder}`}
              onChange={(e) => {
                const combo = SORT_COMBOS.find((c) => c.id === e.currentTarget.value)
                if (!combo) return
                props.filters.intents.setSortField(combo.field)
                props.filters.intents.setSortOrder(combo.order)
              }}
              title="Sort order"
            >
              <For each={SORT_COMBOS}>{(o) => <option value={o.id}>{o.label}</option>}</For>
            </select>
            <span class="hakka-select-caret" aria-hidden="true">
              <IconChevronDown size={11} />
            </span>
          </span>
        </div>
        <div class="hakka-filter-cluster">
          <span class="hakka-filter-label">Group</span>
          <span class="hakka-select-wrap">
            <select
              class="hakka-select"
              value={snap().groupBy}
              onChange={(e) => props.filters.intents.setGroupBy(e.currentTarget.value as GroupBy)}
              title="Group by"
            >
              <For each={GROUP_OPTIONS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
            </select>
            <span class="hakka-select-caret" aria-hidden="true">
              <IconChevronDown size={11} />
            </span>
          </span>
        </div>
        <div class="hakka-filter-cluster">
          <button
            class={`hakka-chip${snap().showRange || snap().hasRange ? ' active' : ''}`}
            onClick={props.filters.intents.toggleShowRange}
            title="Duration / size range filters"
            aria-label="Toggle range filters"
            aria-pressed={snap().showRange ? 'true' : 'false'}
          >
            <IconSwap size={11} /> Range
          </button>
          <div class="hakka-filter-cluster-spacer" />
          {/* View tools — words, not glyphs. Legacy class names stay
              alongside .hakka-chip as stable behavioral hooks. */}
          <button
            class={`hakka-chip hakka-density-btn${props.compact ? ' active' : ''}`}
            onClick={props.onToggleCompact}
            aria-pressed={props.compact ? 'true' : 'false'}
            title="Compact rows — fit twice as many requests on screen"
          >
            <IconRows size={12} /> Compact
          </button>
          <button
            class={`hakka-chip hakka-select-mode-btn${props.selectMode ? ' active' : ''}`}
            onClick={props.onToggleSelectMode}
            aria-pressed={props.selectMode ? 'true' : 'false'}
            title="Select multiple rows to export or compare"
          >
            Select rows
          </button>
          <button
            class="hakka-chip hakka-save-filter-btn"
            onClick={handleSaveFilter}
            title="Save the current filter set as a named preset"
            aria-label="Save filter"
          >
            Save filter
          </button>
        </div>
        {/* Duration / size range inputs */}
        <Show when={snap().showRange}>
          <div class="hakka-filter-cluster" style="gap:var(--hakka-space-sm)">
            <span class="hakka-filter-label">Dur ms</span>
            <input
              class="hakka-input"
              type="number"
              min={0}
              placeholder="min"
              aria-label="Minimum duration in milliseconds"
              style={RANGE_INPUT_STYLE}
              value={snap().durMin || ''}
              onInput={(e) => props.filters.intents.setDurMin(Math.max(0, Number(e.currentTarget.value) || 0))}
            />
            <span class="hakka-filter-label">–</span>
            <input
              class="hakka-input"
              type="number"
              min={0}
              placeholder="max"
              aria-label="Maximum duration in milliseconds"
              style={RANGE_INPUT_STYLE}
              value={snap().durMax || ''}
              onInput={(e) => props.filters.intents.setDurMax(Math.max(0, Number(e.currentTarget.value) || 0))}
            />
            <div class="hakka-chip-sep" />
            <span class="hakka-filter-label">Size KB</span>
            <input
              class="hakka-input"
              type="number"
              min={0}
              placeholder="min"
              aria-label="Minimum total body size in KB"
              style={RANGE_INPUT_STYLE}
              value={snap().sizeMinKb || ''}
              onInput={(e) => props.filters.intents.setSizeMinKb(Math.max(0, Number(e.currentTarget.value) || 0))}
            />
            <span class="hakka-filter-label">–</span>
            <input
              class="hakka-input"
              type="number"
              min={0}
              placeholder="max"
              aria-label="Maximum total body size in KB"
              style={RANGE_INPUT_STYLE}
              value={snap().sizeMaxKb || ''}
              onInput={(e) => props.filters.intents.setSizeMaxKb(Math.max(0, Number(e.currentTarget.value) || 0))}
            />
            <Show when={snap().hasRange}>
              <button
                class="hakka-btn"
                style="font-size:var(--hakka-font-sm)"
                onClick={props.filters.intents.clearRange}
                title="Clear range"
              >
                Clear
              </button>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={hasSavedOrRecent()}>
        <div class="hakka-filter-bar hakka-saved-filters-row" style="padding-top:0;gap:var(--hakka-space-xs)">
          <Show when={snap().savedFilters.length > 0}>
            <span style="font-size:var(--hakka-font-xs);color:var(--hakka-text-tertiary);white-space:nowrap">
              Saved:
            </span>
            <For each={snap().savedFilters}>
              {(sf) => (
                <span class="hakka-saved-filter-entry">
                  <button
                    class="hakka-chip hakka-saved-chip"
                    title={`Apply filter: ${sf.name}`}
                    onClick={() => props.filters.intents.applyFilter(sf.query)}
                  >
                    {sf.name}
                  </button>
                  <button
                    class="hakka-saved-filter-remove"
                    title={`Remove saved filter: ${sf.name}`}
                    aria-label={`Remove saved filter ${sf.name}`}
                    onClick={() => props.filters.intents.removeSavedFilter(sf.name)}
                  >
                    <IconClose size={10} />
                  </button>
                </span>
              )}
            </For>
          </Show>

          <Show when={snap().savedFilters.length > 0 && visibleRecents().length > 0}>
            <div class="hakka-chip-sep" />
          </Show>

          <Show when={visibleRecents().length > 0}>
            <span style="font-size:var(--hakka-font-xs);color:var(--hakka-text-tertiary);white-space:nowrap">
              Recent:
            </span>
            <For each={visibleRecents()}>
              {(rf) => (
                <button
                  class="hakka-chip hakka-recent-chip"
                  title={`Apply recent filter: ${rf.filterText}`}
                  onClick={() => props.filters.intents.applyFilter(rf)}
                >
                  {rf.filterText}
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </>
  )
}
