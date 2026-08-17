/**
 * Inline-embed mode — renders the inspector INTO a host element instead of
 * the floating overlay. Reuses the same `<Inspector/>` tree register.ts's
 * `<hakka-inspector>` renders (tabs, filters, Detail, Settings, theming);
 * only layout (`embedded`) and mount target (its own Shadow DOM under
 * `target`, isolated from the host page like the floating panel's) differ.
 * Floating mode is untouched — the two can run side by side on one page.
 */
import { render } from '@solidjs/web'

import { InspectorRoot } from './CrashBoundary'
import type { InspectorApi } from './Inspector'

export interface MountOptions {
  /** Panel id to show first (e.g. 'network', 'console', 'storage', 'rules', 'stats', 'settings'). Falls back to the persisted/default tab if omitted or unknown. */
  panel?: string
}

export interface MountHandle {
  /** Tear down the embedded inspector and remove it from the DOM. Safe to call more than once. */
  unmount(): void
  /** Switch the visible panel/tab programmatically. No-op for an unknown id. */
  setPanel(panel: string): void
}

/**
 * Mount the inspector inline into `target` instead of the floating overlay.
 * `target`'s own layout controls the size — the embedded panel fills it
 * (width/height: 100%).
 */
export function mount(target: HTMLElement, options: MountOptions = {}): MountHandle {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'display:block;width:100%;height:100%;position:relative;'
  target.appendChild(wrapper)
  const shadow = wrapper.attachShadow({ mode: 'open' })
  const mountEl = document.createElement('div')
  mountEl.style.cssText = 'display:block;width:100%;height:100%;'
  shadow.appendChild(mountEl)

  let api: InspectorApi | null = null
  let unmounted = false

  const dispose = render(
    () => (
      <InspectorRoot
        embedded
        initialTab={options.panel}
        onReady={(a) => {
          api = a
        }}
      />
    ),
    mountEl,
  )

  return {
    unmount() {
      if (unmounted) return
      unmounted = true
      dispose()
      wrapper.remove()
    },
    setPanel(panel: string) {
      api?.setTab(panel)
    },
  }
}
