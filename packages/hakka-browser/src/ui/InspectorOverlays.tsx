// Top-level global overlays — command palette (Cmd/Ctrl-K) and the first-run
// tour. Both float above the whole shell (unlike InspectorPluginPanels'
// request-diff overlay, which is positioned relative to `.hakka-panel`), so
// these render as siblings after the panel div closes.
import type { Component } from 'solid-js'
import { lazy, Loading, Show } from 'solid-js'

import type { PaletteAction } from './CommandPalette'
import type { TourStep } from './Tour'

// Command palette + tour are occasional full-overlay features — lazy chunks
// fetched only the first time the user opens Cmd-K or the tour.
const CommandPalette = lazy(() => import('./CommandPalette').then((m) => ({ default: m.CommandPalette })))
const Tour = lazy(() => import('./Tour').then((m) => ({ default: m.Tour })))

interface InspectorOverlaysProps {
  paletteOpen: () => boolean
  paletteActions: () => PaletteAction[]
  onClosePalette: () => void
  tourActive: () => boolean
  open: () => boolean
  panelRootEl: () => HTMLDivElement | undefined
  tourSteps: TourStep[]
  onTourDone: () => void
}

export const InspectorOverlays: Component<InspectorOverlaysProps> = (props) => (
  <>
    {/* Command palette — Cmd/Ctrl-K, lazy chunk. */}
    <Show when={props.paletteOpen()}>
      <Loading fallback={null}>
        <CommandPalette actions={props.paletteActions()} onClose={props.onClosePalette} />
      </Loading>
    </Show>

    {/* First-run tour — lazy chunk, shown once. */}
    <Show when={props.tourActive() && props.open() && props.panelRootEl()}>
      <Loading fallback={null}>
        <Tour root={props.panelRootEl()!} steps={props.tourSteps} onDone={props.onTourDone} />
      </Loading>
    </Show>
  </>
)
