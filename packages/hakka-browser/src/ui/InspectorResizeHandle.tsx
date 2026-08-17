// Desktop/tablet sheet resize handle (drag the top-edge grip, or Arrow
// Up/Down when focused) plus the mobile (<680px) full-height expand grip.
// Height is applied as the --hakka-panel-height CSS var (ui/presets.ts)
// rather than a direct style write, so a host-page override and this control
// never fight over two code paths. Embedded mode's size is the caller's
// container, not ours to resize or expand — both grips are hidden there.
import type { Component, Setter } from 'solid-js'
import { onSettled, Show } from 'solid-js'

import { clampPanelHeightPx, setPanelHeightPx } from './presets'

interface InspectorResizeHandleProps {
  embedded: () => boolean
  mobileFull: () => boolean
  setMobileFull: Setter<boolean>
  panelRootEl: () => HTMLDivElement | undefined
  /** `saved.panelHeightPx` at mount — 0 means unset (CSS default 80vh). */
  initialHeightPx: number
}

export const InspectorResizeHandle: Component<InspectorResizeHandleProps> = (props) => {
  const RESIZE_STEP_PX = 24
  let currentHeightPx = props.initialHeightPx
  const defaultHeightPx = () => Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) * 0.8)
  const maxHeightPx = () => Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) * 0.95)

  const applyHeight = (px: number) => {
    const clamped = clampPanelHeightPx(px, maxHeightPx())
    currentHeightPx = clamped
    setPanelHeightPx(clamped)
  }

  function onResizeKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const base = currentHeightPx > 0 ? currentHeightPx : defaultHeightPx()
    applyHeight(base + (e.key === 'ArrowUp' ? RESIZE_STEP_PX : -RESIZE_STEP_PX))
  }

  let resizeStartY = 0
  let resizeStartHeight = 0
  function onResizeMouseMove(e: MouseEvent) {
    applyHeight(resizeStartHeight + (resizeStartY - e.clientY))
  }
  function onResizeMouseUp() {
    window.removeEventListener('mousemove', onResizeMouseMove)
    window.removeEventListener('mouseup', onResizeMouseUp)
  }
  function onResizeMouseDown(e: MouseEvent) {
    e.preventDefault()
    resizeStartY = e.clientY
    resizeStartHeight =
      currentHeightPx > 0 ? currentHeightPx : (props.panelRootEl()?.getBoundingClientRect().height ?? defaultHeightPx())
    window.addEventListener('mousemove', onResizeMouseMove)
    window.addEventListener('mouseup', onResizeMouseUp)
  }
  onSettled(() => () => {
    window.removeEventListener('mousemove', onResizeMouseMove)
    window.removeEventListener('mouseup', onResizeMouseUp)
  })

  return (
    <>
      {/* Resize handle — desktop/tablet sheet layout only. */}
      <Show when={!props.embedded()}>
        <div
          class="hakka-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel height"
          tabindex={0}
          onMouseDown={onResizeMouseDown}
          onKeyDown={onResizeKeyDown}
        >
          <span class="hakka-resize-grip" />
        </div>
      </Show>
      {/* Mobile expand grip — < 680px only (CSS-gated), tap to toggle full height. */}
      <Show when={!props.embedded()}>
        <button
          type="button"
          class="hakka-mobile-grip"
          aria-label={props.mobileFull() ? 'Collapse panel to partial height' : 'Expand panel to full height'}
          aria-pressed={props.mobileFull() ? 'true' : 'false'}
          onClick={() => props.setMobileFull((v) => !v)}
        >
          <span class="hakka-resize-grip" />
        </button>
      </Show>
    </>
  )
}
