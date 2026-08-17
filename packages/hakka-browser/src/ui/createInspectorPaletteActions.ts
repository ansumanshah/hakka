// Command palette (Cmd/Ctrl-K) action list — every "Go to <tab>" entry plus
// the shell's Actions/Export/Session groups. A factory (not a component)
// called once from Inspector's render body; the returned accessor is the
// same `createMemo` Inspector used to own inline, just relocated.
import type { HakkaPanel } from 'hakka-core'
import type { Accessor } from 'solid-js'
import { createMemo } from 'solid-js'

import type { PaletteAction } from './CommandPalette'
import type { InspectorExportActions } from './inspectorExports'
import type { FilterState, FilterViewModel, SelectionState, SelectionViewModel } from './viewModels'

export interface InspectorPaletteActionsDeps {
  panels: HakkaPanel[]
  tab: Accessor<string>
  setTab: (id: string) => void
  clearLogs: () => void
  compact: Accessor<boolean>
  setCompact: (v: boolean) => void
  selection: SelectionViewModel
  selectionSnap: Accessor<SelectionState>
  filters: FilterViewModel
  filterSnap: Accessor<FilterState>
  canCompare: () => boolean
  openCompare: () => void
  startTour: () => void
  exportActions: InspectorExportActions
  triggerLoadSession: () => void
}

export function createInspectorPaletteActions(deps: InspectorPaletteActionsDeps): Accessor<PaletteAction[]> {
  return createMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = []
    for (const p of deps.panels) {
      actions.push({
        id: `tab:${p.id}`,
        group: 'Go to',
        label: p.title,
        hint: deps.tab() === p.id ? 'current' : undefined,
        run: () => deps.setTab(p.id),
      })
    }
    actions.push(
      { id: 'clear', group: 'Actions', label: 'Clear captured requests', run: deps.clearLogs },
      {
        id: 'density',
        group: 'Actions',
        label: deps.compact() ? 'Switch to comfortable density' : 'Switch to compact density',
        run: () => deps.setCompact(!deps.compact()),
      },
      {
        id: 'select-mode',
        group: 'Actions',
        label: deps.selectionSnap().selectMode ? 'Exit select mode' : 'Select requests',
        run: () => deps.selection.intents.setSelectMode(!deps.selectionSnap().selectMode),
      },
      {
        id: 'nl-mode',
        group: 'Actions',
        label: deps.filterSnap().nlMode ? 'Turn off natural-language search' : 'Turn on natural-language search',
        run: deps.filters.intents.toggleNlMode,
      },
      {
        id: 'compare',
        group: 'Actions',
        label: 'Compare two selected requests',
        hint: deps.canCompare() ? undefined : 'select exactly 2',
        run: deps.openCompare,
      },
      // The only entry point to the tour — it never auto-opens (see the Tour
      // block in Inspector.tsx for why).
      { id: 'tour', group: 'Actions', label: 'Show quick tour', run: deps.startTour },
      {
        id: 'export-har',
        group: 'Export (visible)',
        label: 'Export HAR',
        run: () => void deps.exportActions.exportHar(),
      },
      {
        id: 'export-otel',
        group: 'Export (visible)',
        label: 'Export OpenTelemetry JSON',
        run: () => void deps.exportActions.exportOtel(),
      },
      {
        id: 'export-postman',
        group: 'Export (visible)',
        label: 'Export Postman collection',
        run: () => void deps.exportActions.exportPostman(),
      },
      {
        id: 'session-save',
        group: 'Session',
        label: 'Save session (.hakka file)',
        run: () => void deps.exportActions.saveSession(),
      },
      { id: 'session-load', group: 'Session', label: 'Load session (.hakka file)', run: deps.triggerLoadSession },
      {
        id: 'repro-bundle-download',
        group: 'Session',
        label: 'Download repro bundle (.hakka-repro)',
        run: () => void deps.exportActions.downloadReproBundle(),
      },
    )
    return actions
  })
}
