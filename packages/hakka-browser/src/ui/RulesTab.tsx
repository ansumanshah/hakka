/**
 * Rules panel — Mock, Breakpoints and Throttle share one segmented tab
 * (all three shape traffic before it reaches the app) instead of three
 * top-level tabs. Active section survives tab switches (module-level signal)
 * but isn't persisted across reloads. Each sub-tab is its own `lazy()` chunk,
 * same pattern as CommandPalette/RequestDiff/Tour, so opening Rules fetches
 * only the picked section.
 */
import type { Component } from 'solid-js'
import { createSignal, lazy, Show, For, Loading } from 'solid-js'

import type { PanelProps } from './panelRegistry'

const MockTab = lazy(() => import('./MockTab').then((m) => ({ default: m.MockTab })))
const BreakpointsTab = lazy(() => import('./BreakpointsTab').then((m) => ({ default: m.BreakpointsTab })))
const ThrottleTab = lazy(() => import('./ThrottleTab').then((m) => ({ default: m.ThrottleTab })))

type RulesSection = 'mock' | 'breakpoints' | 'throttle'

const SECTIONS: { id: RulesSection; label: string }[] = [
  { id: 'mock', label: 'Mock' },
  { id: 'breakpoints', label: 'Breakpoints' },
  { id: 'throttle', label: 'Throttle' },
]

const [section, setSection] = createSignal<RulesSection>('mock')

export const RulesTab: Component<PanelProps> = (props) => {
  return (
    <div class="hakka-rules">
      <div class="hakka-rules-switch">
        <div class="hakka-seg" role="tablist" aria-label="Rule type">
          <For each={SECTIONS}>
            {(s) => (
              <button
                class={`hakka-seg-btn${section() === s.id ? ' on' : ''}`}
                role="tab"
                aria-selected={section() === s.id ? 'true' : 'false'}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            )}
          </For>
        </div>
      </div>
      <Loading fallback={<div class="hakka-panel-loading">Loading…</div>}>
        <Show when={section() === 'mock'}>
          <MockTab active={props.active} />
        </Show>
        <Show when={section() === 'breakpoints'}>
          <BreakpointsTab active={props.active} />
        </Show>
        <Show when={section() === 'throttle'}>
          <ThrottleTab active={props.active} />
        </Show>
      </Loading>
    </div>
  )
}
