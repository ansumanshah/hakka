/**
 * First-run tour — a lightweight, dismissible 3-step hint sequence shown once
 * on first open (persisted via `tourSeen` in persist.ts). Lazy chunk: fetched
 * only the first time the panel opens with no prior tour, same convention as
 * CommandPalette/RequestDiff (see Inspector.tsx).
 *
 * Points at three anchors already on screen (filter bar, tab strip, ⌘K
 * button) via getBoundingClientRect — no portal/positioning library, just a
 * fixed-position callout placed next to the measured anchor each step.
 */
import { createMemo, createSignal, onSettled, Show } from 'solid-js'
import type { Component } from 'solid-js'

export interface TourStep {
  /** CSS selector (queried inside the panel root) for the element this step points at. */
  selector: string
  title: string
  body: string
}

interface TourProps {
  /** Root element to query selectors against (the panel, so it works inside a Shadow DOM host). */
  root: HTMLElement
  steps: TourStep[]
  onDone: () => void
}

interface Placement {
  top: number
  left: number
  /** Callout renders above or below the anchor depending on available space. */
  side: 'above' | 'below'
}

const CALLOUT_WIDTH = 260

export const Tour: Component<TourProps> = (props) => {
  const [stepIdx, setStepIdx] = createSignal(0)
  const [placement, setPlacement] = createSignal<Placement | null>(null)

  const step = createMemo(() => props.steps[stepIdx()])
  const isLast = createMemo(() => stepIdx() === props.steps.length - 1)

  const measure = () => {
    const s = step()
    if (!s) return
    const anchor = props.root.querySelector(s.selector) as HTMLElement | null
    if (!anchor) {
      // Anchor not present (e.g. narrow viewport hides a control) — skip this step.
      if (stepIdx() < props.steps.length - 1) setStepIdx((i) => i + 1)
      else props.onDone()
      return
    }
    const rect = anchor.getBoundingClientRect()
    const vh = window.innerHeight
    const spaceBelow = vh - rect.bottom
    const side: Placement['side'] = spaceBelow > 140 || rect.top < 140 ? 'below' : 'above'
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - CALLOUT_WIDTH - 8))
    const top = side === 'below' ? rect.bottom + 10 : rect.top - 10
    setPlacement({ top, left, side })
  }

  onSettled(() => {
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

  const goNext = () => {
    if (isLast()) {
      props.onDone()
      return
    }
    setStepIdx((i) => i + 1)
    // Re-measure next tick so the new anchor's rect is used.
    queueMicrotask(measure)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onDone()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      goNext()
    }
  }

  onSettled(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <Show when={placement() && step()}>
      <div
        class="hakka-tour-overlay"
        role="dialog"
        aria-modal="false"
        aria-label="Inspector tour"
        style={{
          position: 'fixed',
          top: `${placement()!.top}px`,
          left: `${placement()!.left}px`,
          transform: placement()!.side === 'above' ? 'translateY(-100%)' : 'none',
          width: `${CALLOUT_WIDTH}px`,
        }}
      >
        <div class="hakka-tour-card">
          <div class="hakka-tour-head">
            <span class="hakka-tour-step-count">
              {stepIdx() + 1} / {props.steps.length}
            </span>
            <button class="hakka-tour-skip" onClick={props.onDone} aria-label="Skip tour">
              Skip
            </button>
          </div>
          <div class="hakka-tour-title">{step()!.title}</div>
          <div class="hakka-tour-body">{step()!.body}</div>
          <div class="hakka-tour-actions">
            <button class="hakka-tour-next" onClick={goNext}>
              {isLast() ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
