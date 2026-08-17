/** Persist inspector UI state to localStorage under `hakka:ui` — the `hakka:`
 * prefix keeps storage adapters from surfacing it in the Storage tab. */

const KEY = 'hakka:ui'

/** A snapshot of the current filter/sort/group state that can be saved and restored. */
export interface SavedFilter {
  filterText: string
  filterMethod: string
  filterStatus: string
  filterContentType: string
  filterRuntime: string
  sortField: string
  sortOrder: string
  groupBy: string
  /** Duration range in milliseconds (0/absent = unset). Optional for filters saved before this feature. */
  durMin?: number
  durMax?: number
  /** Total body-size range in KB (0/absent = unset). */
  sizeMinKb?: number
  sizeMaxKb?: number
}

export interface UiState {
  open: boolean
  tab: string
  /** Toggle button X position (px from viewport left). */
  bx: number
  /** Toggle button Y position (px from viewport top). */
  by: number
  /** Mirror each captured request to the browser devtools console. */
  logToConsole: boolean
  /** Capture the call-site stack ("Initiator") for each request. */
  captureStack: boolean
  /** Connect to the Hakka desktop app over WebSocket. */
  desktopConnect: boolean
  /** WebSocket URL for desktop bridge (default ws://localhost:8989). */
  desktopUrl: string
  /** Maximum requests to keep in the ring buffer. */
  maxRecords: number
  /** Age-based retention in seconds (0 = keep forever, bounded only by maxRecords). */
  maxAge: number
  /** JSON body field names to redact before storage (case-insensitive). */
  redactBodyFields: string[]
  /** Persisted Network-tab filters (survive page reloads). */
  filterText: string
  filterMethod: string
  filterStatus: string
  filterContentType: string
  filterRuntime: string
  /** Duration/size range filters (ms / KB; 0 = unset). */
  durMin: number
  durMax: number
  sizeMinKb: number
  sizeMaxKb: number
  /** Sort/group preferences for the request list. */
  sortField: string
  sortOrder: string
  groupBy: string
  /** Show verbose (non-primary) framework spans in the trace waterfall. */
  verboseSpans: boolean
  /** Compact row density — doubles visible rows on small screens. */
  compactDensity: boolean
  /** Named saved filters — user can apply these quickly. */
  savedFilters: { name: string; query: SavedFilter }[]
  /** Recent non-empty filter states (capped at 8, deduped by filterText). */
  recentFilters: SavedFilter[]
  /** First-run tour (filter bar / tabs / Cmd-K) shown once, then never again. */
  tourSeen: boolean
  /** Curated theme preset id ('navy' | 'light' | 'high-contrast' | 'amber' | 'matrix' | 'paper'). See ui/presets.ts. */
  preset: string
  /** Floating panel opacity (0.4-1). 1 = fully opaque (default). See ui/presets.ts. */
  panelOpacity: number
  /** Floating panel height in px at the desktop/tablet sheet layout (>=680px). 0 = unset (CSS default 80vh). */
  panelHeightPx: number
}

const RECENT_CAP = 8

const DEFAULTS: UiState = {
  open: false,
  tab: 'network',
  bx: -1,
  by: -1,
  logToConsole: false,
  captureStack: false,
  desktopConnect: false,
  desktopUrl: 'ws://localhost:8989',
  maxRecords: 500,
  maxAge: 0,
  redactBodyFields: [],
  filterText: '',
  filterMethod: '',
  filterStatus: 'all',
  filterContentType: 'all',
  filterRuntime: 'all',
  durMin: 0,
  durMax: 0,
  sizeMinKb: 0,
  sizeMaxKb: 0,
  sortField: 'time',
  sortOrder: 'desc',
  groupBy: 'none',
  verboseSpans: false,
  compactDensity: false,
  savedFilters: [],
  recentFilters: [],
  tourSeen: false,
  preset: 'navy',
  panelOpacity: 1,
  panelHeightPx: 0,
}

function isBrowser(): boolean {
  return typeof localStorage !== 'undefined'
}

export function loadUiState(): UiState {
  if (!isBrowser()) return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<UiState>
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : DEFAULTS.open,
      tab: typeof parsed.tab === 'string' ? parsed.tab : DEFAULTS.tab,
      bx: typeof parsed.bx === 'number' ? parsed.bx : DEFAULTS.bx,
      by: typeof parsed.by === 'number' ? parsed.by : DEFAULTS.by,
      logToConsole: typeof parsed.logToConsole === 'boolean' ? parsed.logToConsole : DEFAULTS.logToConsole,
      captureStack: typeof parsed.captureStack === 'boolean' ? parsed.captureStack : DEFAULTS.captureStack,
      desktopConnect: typeof parsed.desktopConnect === 'boolean' ? parsed.desktopConnect : DEFAULTS.desktopConnect,
      desktopUrl: typeof parsed.desktopUrl === 'string' ? parsed.desktopUrl : DEFAULTS.desktopUrl,
      maxRecords: typeof parsed.maxRecords === 'number' ? parsed.maxRecords : DEFAULTS.maxRecords,
      maxAge: typeof parsed.maxAge === 'number' ? parsed.maxAge : DEFAULTS.maxAge,
      redactBodyFields: Array.isArray(parsed.redactBodyFields)
        ? (parsed.redactBodyFields as string[])
        : DEFAULTS.redactBodyFields,
      filterText: typeof parsed.filterText === 'string' ? parsed.filterText : DEFAULTS.filterText,
      filterMethod: typeof parsed.filterMethod === 'string' ? parsed.filterMethod : DEFAULTS.filterMethod,
      filterStatus: typeof parsed.filterStatus === 'string' ? parsed.filterStatus : DEFAULTS.filterStatus,
      filterContentType:
        typeof parsed.filterContentType === 'string' ? parsed.filterContentType : DEFAULTS.filterContentType,
      filterRuntime: typeof parsed.filterRuntime === 'string' ? parsed.filterRuntime : DEFAULTS.filterRuntime,
      durMin: typeof parsed.durMin === 'number' ? parsed.durMin : DEFAULTS.durMin,
      durMax: typeof parsed.durMax === 'number' ? parsed.durMax : DEFAULTS.durMax,
      sizeMinKb: typeof parsed.sizeMinKb === 'number' ? parsed.sizeMinKb : DEFAULTS.sizeMinKb,
      sizeMaxKb: typeof parsed.sizeMaxKb === 'number' ? parsed.sizeMaxKb : DEFAULTS.sizeMaxKb,
      sortField: typeof parsed.sortField === 'string' ? parsed.sortField : DEFAULTS.sortField,
      sortOrder: typeof parsed.sortOrder === 'string' ? parsed.sortOrder : DEFAULTS.sortOrder,
      groupBy: typeof parsed.groupBy === 'string' ? parsed.groupBy : DEFAULTS.groupBy,
      verboseSpans: typeof parsed.verboseSpans === 'boolean' ? parsed.verboseSpans : DEFAULTS.verboseSpans,
      compactDensity: typeof parsed.compactDensity === 'boolean' ? parsed.compactDensity : DEFAULTS.compactDensity,
      savedFilters: Array.isArray(parsed.savedFilters)
        ? (parsed.savedFilters as { name: string; query: SavedFilter }[])
        : DEFAULTS.savedFilters,
      recentFilters: Array.isArray(parsed.recentFilters)
        ? (parsed.recentFilters as SavedFilter[])
        : DEFAULTS.recentFilters,
      tourSeen: typeof parsed.tourSeen === 'boolean' ? parsed.tourSeen : DEFAULTS.tourSeen,
      preset: typeof parsed.preset === 'string' ? parsed.preset : DEFAULTS.preset,
      panelOpacity: typeof parsed.panelOpacity === 'number' ? parsed.panelOpacity : DEFAULTS.panelOpacity,
      panelHeightPx: typeof parsed.panelHeightPx === 'number' ? parsed.panelHeightPx : DEFAULTS.panelHeightPx,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Push a filter onto recentFilters (deduped by filterText, capped at RECENT_CAP). */
export function pushRecentFilter(filter: SavedFilter): void {
  if (!filter.filterText) return
  const state = loadUiState()
  const deduped = state.recentFilters.filter((r) => r.filterText !== filter.filterText)
  const next = [filter, ...deduped].slice(0, RECENT_CAP)
  saveUiState({ recentFilters: next })
}

/** Add a named saved filter (overwrites an existing entry with the same name). */
export function addSavedFilter(name: string, query: SavedFilter): void {
  const state = loadUiState()
  const filtered = state.savedFilters.filter((sf) => sf.name !== name)
  saveUiState({ savedFilters: [...filtered, { name, query }] })
}

/** Remove a saved filter by name. */
export function removeSavedFilter(name: string): void {
  const state = loadUiState()
  saveUiState({ savedFilters: state.savedFilters.filter((sf) => sf.name !== name) })
}

export function saveUiState(partial: Partial<UiState>): void {
  if (!isBrowser()) return
  try {
    const current = loadUiState()
    const next: UiState = { ...current, ...partial }
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // no-op: private mode or quota exceeded
  }
}
