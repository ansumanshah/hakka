// The panel header: tab strip (network/stats/rules/logs/storage/settings) +
// count + actions. Below the panel's own container width (not the
// viewport's — must hold for a narrow mount() embed on an otherwise-wide
// page too) the wide header-actions collapse into a kebab menu instead (see
// styles.ts's "Header — narrow container" rule) — same actions, different
// chrome, so both blocks below stay side by side rather than merged.
import type { HakkaPanel } from 'hakka-core'
import type { Component } from 'solid-js'
import { createEffect, For, Show } from 'solid-js'

import { HakkaMark } from './HakkaMark'
import { IconChart, IconClose, IconDatabase, IconExport, IconGear, IconPulse, IconSliders, IconTerminal } from './icons'
import type { InspectorExportActions } from './inspectorExports'

// Tab-bar icons for the builtin panels. Plugin panels without an entry render
// text-only, so third-party panels need no icon to participate.
const TAB_ICONS: Record<string, Component<{ size?: number }>> = {
  network: IconPulse,
  stats: IconChart,
  rules: IconSliders,
  console: IconTerminal,
  storage: IconDatabase,
  settings: IconGear,
}

interface InspectorToolbarProps {
  panels: HakkaPanel[]
  tab: () => string
  setTab: (id: string) => void
  errorCount: () => number
  requestCount: () => number
  embedded: () => boolean
  selectMode: () => boolean
  clearLogs: () => void
  exportActions: InspectorExportActions
  setPaletteOpen: (v: boolean) => void
  setOpen: (v: boolean) => void
  /** Owned by Inspector — the command palette's "Load session" action needs
   * to trigger the same hidden `<input>` this toolbar renders. */
  sessionFileInputRef: (el: HTMLInputElement) => void
  onTriggerLoadSession: () => void
}

export const InspectorToolbar: Component<InspectorToolbarProps> = (props) => {
  const showNetworkActions = () => props.tab() === 'network' && !props.selectMode()

  let tabsEl: HTMLDivElement | undefined

  // Same guarantee as Detail's secondary tab strip: keep the active tab
  // visible when this strip overflows (plugin panels can add enough tabs to
  // scroll on a narrow phone). Guarded for jsdom/happy-dom, which may not
  // implement scrollIntoView at all.
  createEffect(
    () => props.tab(),
    () => {
      if (!tabsEl) return
      const active = tabsEl.querySelector<HTMLElement>('.hakka-tab.active')
      if (!active || typeof active.scrollIntoView !== 'function') return
      const reduceMotion =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      active.scrollIntoView({ inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
    },
  )

  return (
    <div class="hakka-header">
      <span title="Capturing">
        <HakkaMark size={20} live />
      </span>
      <div class="hakka-tabs" role="tablist" ref={(el) => (tabsEl = el)}>
        <For each={props.panels}>
          {(p) => {
            const TabIcon = TAB_ICONS[p.id]
            return (
              <button
                class={`hakka-tab${props.tab() === p.id ? ' active' : ''}`}
                role="tab"
                aria-selected={props.tab() === p.id ? 'true' : 'false'}
                onClick={() => props.setTab(p.id)}
              >
                {TabIcon ? <TabIcon size={12} /> : null}
                {p.title}
                <Show when={p.id === 'console' && props.errorCount() > 0}>
                  <span class="hakka-count-badge sm" style="color: var(--hakka-status-error)">
                    {props.errorCount() > 99 ? '99+' : props.errorCount()}
                  </span>
                </Show>
              </button>
            )
          }}
        </For>
      </div>
      <span class="hakka-header-count">{props.requestCount()}</span>
      {/* Wide header: actions inline. */}
      <div class="hakka-header-actions">
        <Show when={showNetworkActions()}>
          <button class="hakka-btn" onClick={props.clearLogs}>
            Clear
          </button>
          <details class="hakka-menu">
            <summary class="hakka-btn" title="Export the visible (filtered) requests">
              <IconExport size={11} /> Export
            </summary>
            <div class="hakka-menu-list">
              <button
                class="hakka-btn"
                onClick={() => void props.exportActions.exportHar()}
                title="Export the visible (filtered) requests as HAR 1.2"
              >
                HAR
              </button>
              <button
                class="hakka-btn"
                onClick={() => void props.exportActions.exportOtel()}
                title="Export the visible (filtered) requests as OpenTelemetry JSON"
              >
                OTel
              </button>
              <button
                class="hakka-btn"
                onClick={() => void props.exportActions.exportPostman()}
                title="Export the visible (filtered) requests as Postman Collection v2.1"
              >
                Postman
              </button>
            </div>
          </details>
          <details class="hakka-menu">
            <summary class="hakka-btn" title="Save or load a .hakka session file">
              Session
            </summary>
            <div class="hakka-menu-list">
              <button
                class="hakka-btn"
                onClick={() => void props.exportActions.saveSession()}
                title="Download the current (filtered) session as a .hakka file"
              >
                Save
              </button>
              <button class="hakka-btn" onClick={props.onTriggerLoadSession} title="Import a .hakka session file">
                Load
              </button>
              <button
                class="hakka-btn"
                onClick={() => void props.exportActions.downloadReproBundle()}
                title="Download the current (filtered) requests as a self-contained .hakka-repro bundle (requests + replay mocks)"
              >
                Repro bundle
              </button>
            </div>
          </details>
        </Show>
        <button
          class="hakka-btn"
          onClick={() => props.setPaletteOpen(true)}
          title="Command palette (Cmd/Ctrl-K)"
          aria-label="Open command palette"
        >
          ⌘K
        </button>
      </div>
      {/* Narrow-container fallback — same actions, one tap behind a kebab,
          so the tab strip above always keeps its width instead of
          clipping or losing tabs. */}
      <details class="hakka-menu hakka-header-kebab">
        <summary class="hakka-btn" title="More actions" aria-label="More actions">
          ⋮
        </summary>
        <div class="hakka-menu-list">
          <Show when={showNetworkActions()}>
            <button class="hakka-btn" onClick={props.clearLogs}>
              Clear
            </button>
            <button
              class="hakka-btn"
              onClick={() => void props.exportActions.exportHar()}
              title="Export the visible (filtered) requests as HAR 1.2"
            >
              Export HAR
            </button>
            <button
              class="hakka-btn"
              onClick={() => void props.exportActions.exportOtel()}
              title="Export the visible (filtered) requests as OpenTelemetry JSON"
            >
              Export OTel
            </button>
            <button
              class="hakka-btn"
              onClick={() => void props.exportActions.exportPostman()}
              title="Export the visible (filtered) requests as Postman Collection v2.1"
            >
              Export Postman
            </button>
            <button
              class="hakka-btn"
              onClick={() => void props.exportActions.saveSession()}
              title="Download the current (filtered) session as a .hakka file"
            >
              Save session
            </button>
            <button class="hakka-btn" onClick={props.onTriggerLoadSession} title="Import a .hakka session file">
              Load session
            </button>
            <button
              class="hakka-btn"
              onClick={() => void props.exportActions.downloadReproBundle()}
              title="Download the current (filtered) requests as a self-contained .hakka-repro bundle (requests + replay mocks)"
            >
              Repro bundle
            </button>
          </Show>
          <button class="hakka-btn" onClick={() => props.setPaletteOpen(true)}>
            Command palette (⌘K)
          </button>
        </div>
      </details>
      {/* Nothing to "close" in embedded mode — the caller controls lifetime via mount()'s returned handle. */}
      <Show when={!props.embedded()}>
        <button class="hakka-btn hakka-btn-close" onClick={() => props.setOpen(false)} aria-label="Close inspector">
          <IconClose size={14} />
        </button>
      </Show>
      {/* Hidden file input backing "Load" — accepts .hakka session files. */}
      <input
        ref={props.sessionFileInputRef}
        type="file"
        accept=".hakka,application/json"
        style="display:none"
        onChange={(e) => void props.exportActions.loadSessionFile(e)}
        aria-label="Load session file"
      />
    </div>
  )
}
