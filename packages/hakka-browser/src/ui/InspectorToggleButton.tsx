// The draggable floating toggle button — three states: collapsed → tap
// expands `hudOpen` (a compact inline HUD, NOT the panel) → tap again
// collapses it. Long-press, right-click, or Shift-Enter open the full panel
// instead; drag repositions the button from any state.
import type { NetworkRequest } from 'hakka-core'
import { parseUrl } from 'hakka-core'
import type { Component, Setter } from 'solid-js'
import { For, onSettled, Show } from 'solid-js'

import { HakkaMark } from './HakkaMark'
import { saveUiState } from './persist'
import { methodClass, statusClass, statusLabel } from './RequestRow'

interface InspectorToggleButtonProps {
  embedded: () => boolean
  open: () => boolean
  hudOpen: () => boolean
  setHudOpen: Setter<boolean>
  setOpen: (v: boolean) => void
  btnX: () => number
  setBtnX: Setter<number>
  btnY: () => number
  setBtnY: Setter<number>
  requestCount: () => number
  requestLogs: () => NetworkRequest[]
}

export const InspectorToggleButton: Component<InspectorToggleButtonProps> = (props) => {
  // Mirrors the native bubble's allowableMovement=10 (see
  // ios/Sources/UI/Overlay/BubbleWindowGestures.swift) so the tap/long-press/
  // drag feel is the same threshold on every platform.
  const DRAG_THRESHOLD = 10
  let dragStartX = 0
  let dragStartY = 0
  let dragStartBtnX = 0
  let dragStartBtnY = 0
  let isDragging = false
  let handledByPointerUp = false

  // Long-press → open panel, via a plain pointerdown timer rather than a
  // gesture library: a drag must never also open the panel, and clearing this
  // timer the instant isDragging flips true proves that directly.
  // `suppressTapToggle` closes the remaining seam — once a gesture resolves
  // into "open the panel," the trailing pointerup/click must not also toggle
  // the HUD.
  const LONG_PRESS_MS = 450
  let longPressTimer: ReturnType<typeof setTimeout> | undefined
  let suppressTapToggle = false

  function clearLongPressTimer() {
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer)
      longPressTimer = undefined
    }
  }
  // A pointerdown's pending 450ms timer must not fire openPanel after the
  // Inspector tears down mid-press.
  onSettled(() => clearLongPressTimer)

  function openPanel() {
    clearLongPressTimer()
    suppressTapToggle = true
    props.setHudOpen(false)
    props.setOpen(true)
  }

  function getBtnStyle(): string {
    if (props.btnX() < 0 || props.btnY() < 0) {
      return 'position:fixed;bottom:20px;right:20px;z-index:2147483646'
    }
    const x = Math.max(0, Math.min(props.btnX(), window.innerWidth - 44))
    const y = Math.max(0, Math.min(props.btnY(), window.innerHeight - 44))
    return `position:fixed;left:${x}px;top:${y}px;z-index:2147483646`
  }

  // Anchors the HUD near the button's current corner (the button can be
  // dragged anywhere). Opens upward when the button is in the lower half of
  // the viewport, downward otherwise, and clamps horizontally to stay on-screen.
  const HUD_WIDTH = 280
  const HUD_GAP = 10
  function getHudStyle(): string {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const bx = props.btnX() >= 0 ? props.btnX() : vw - 20 - 44
    const by = props.btnY() >= 0 ? props.btnY() : vh - 20 - 44
    const right = Math.min(Math.max(8, vw - (bx + 44)), Math.max(8, vw - HUD_WIDTH - 8))
    const parts = [`position:fixed`, `width:${HUD_WIDTH}px`, `right:${right}px`, `z-index:2147483646`]
    if (by > vh / 2) parts.push(`bottom:${vh - by + HUD_GAP}px`)
    else parts.push(`top:${by + 44 + HUD_GAP}px`)
    return parts.join(';')
  }

  function onPointerDown(e: PointerEvent) {
    dragStartX = e.clientX
    dragStartY = e.clientY
    const vw = typeof window !== 'undefined' ? window.innerWidth : 400
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    dragStartBtnX = props.btnX() >= 0 ? props.btnX() : vw - 20 - 44
    dragStartBtnY = props.btnY() >= 0 ? props.btnY() : vh - 20 - 44
    isDragging = false
    suppressTapToggle = false
    clearLongPressTimer()
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined
      openPanel()
    }, LONG_PRESS_MS)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    if (!isDragging) {
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        isDragging = true
        // Repositioning the launcher must never open the panel — cancel the
        // pending long-press the moment real drag distance is detected.
        clearLongPressTimer()
      } else {
        return
      }
    }
    const vw = typeof window !== 'undefined' ? window.innerWidth : 400
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const newX = Math.max(0, Math.min(dragStartBtnX + dx, vw - 44))
    const newY = Math.max(0, Math.min(dragStartBtnY + dy, vh - 44))
    props.setBtnX(newX)
    props.setBtnY(newY)
  }

  function onPointerUp(e: PointerEvent) {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    clearLongPressTimer()
    if (!isDragging) {
      // It was a tap or a completed long-press/right-click — either way the
      // native 'click' that follows this pointerup must not run twice.
      handledByPointerUp = true
      if (!suppressTapToggle) props.setHudOpen((v) => !v)
    } else {
      saveUiState({ bx: props.btnX(), by: props.btnY() })
    }
    isDragging = false
  }

  function onPointerCancel() {
    clearLongPressTimer()
    isDragging = false
  }

  // Fallback: some test environments dispatch click without pointer events.
  function onToggleClick() {
    if (handledByPointerUp) {
      handledByPointerUp = false
      return
    }
    props.setHudOpen((v) => !v)
  }

  // Mouse idiom for long-press: right-click opens the panel directly instead
  // of the browser's native context menu.
  function onToggleContextMenu(e: MouseEvent) {
    e.preventDefault()
    openPanel()
  }

  // Enter/Space already toggle the HUD via native <button> click activation
  // (onToggleClick). Shift-Enter needs its own handler, and must
  // preventDefault so the browser doesn't also synthesize the plain click.
  function onToggleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      openPanel()
    }
  }

  return (
    <>
      {/* Toggle button — draggable. Embedded mode has no floating chrome (the
          panel fills its container). Hidden while the panel is open —
          otherwise, at the default bottom-right position, its z-index (kept
          above the panel's so it stays clickable there) sits directly over the
          multi-select action bar's Cancel button and eats its clicks. */}
      <Show when={!props.embedded() && !props.open()}>
        <button
          class="hakka-toggle"
          title="Hakka inspector — tap for a recent-requests summary, long-press or right-click for the full inspector"
          aria-label="Hakka network inspector. Enter or tap toggles a recent-requests summary; Shift-Enter or right-click opens the full inspector."
          aria-expanded={props.hudOpen() ? 'true' : 'false'}
          aria-controls="hakka-hud"
          style={getBtnStyle()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={onToggleClick}
          onContextMenu={onToggleContextMenu}
          onKeyDown={onToggleKeyDown}
        >
          <HakkaMark size={24} />
          <Show when={props.requestCount() > 0}>
            <span class="hakka-badge">{props.requestCount() > 99 ? '99+' : props.requestCount()}</span>
          </Show>
        </button>
      </Show>

      {/* Compact inline HUD — expands from the toggle, never opens the panel.
          Most-recent 3-5 requests plus a live count; the method column reuses
          .hakka-method-badge stripped of its chip box per DESIGN.md's
          "chips are for controls; rows get plain text". */}
      <Show when={!props.embedded() && !props.open() && props.hudOpen()}>
        <div id="hakka-hud" class="hakka-hud" role="region" aria-label="Recent requests" style={getHudStyle()}>
          <div class="hakka-hud-header">
            <span class="hakka-hud-count">{props.requestCount()} captured</span>
          </div>
          <Show
            when={props.requestLogs().length > 0}
            fallback={<div class="hakka-hud-empty">No requests captured yet</div>}
          >
            <ul class="hakka-hud-list">
              <For each={props.requestLogs().slice(0, 5)}>
                {(req) => (
                  <li class="hakka-hud-row">
                    <span class={`hakka-method-badge ${methodClass(req.method)}`}>{req.method.toUpperCase()}</span>
                    <span class="hakka-hud-path">{parseUrl(req.url).path || '/'}</span>
                    <span class={`hakka-status ${statusClass(req)}`}>{statusLabel(req)}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </>
  )
}
