/**
 * Command palette — Cmd/Ctrl-K overlay listing every high-value inspector
 * action (switch tab, clear, export, toggle density, save/load session…)
 * behind a fuzzy filter. Lazy chunk (see panelRegistry.ts conventions):
 * fetched only the first time the user opens it, never part of the eager UI.
 */
import { createEffect, createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import type { Component } from 'solid-js'

export interface PaletteAction {
  id: string
  label: string
  /** Optional secondary text (e.g. current state) shown right-aligned. */
  hint?: string
  /** Group heading — actions are rendered grouped, in first-seen order. */
  group: string
  run: () => void
}

interface CommandPaletteProps {
  actions: PaletteAction[]
  onClose: () => void
}

/** Case-insensitive subsequence fuzzy match — same tolerance level as a typical Cmd-K. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const idx = t.indexOf(q)
  if (idx >= 0) return 1000 - idx // substring match — ranked by how early it starts
  // Subsequence fallback: every char of q must appear in order in t.
  let qi = 0
  let score = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      score++
    }
  }
  return qi === q.length ? score : -1
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const [query, setQuery] = createSignal('')
  const [activeIdx, setActiveIdx] = createSignal(0)
  let inputEl: HTMLInputElement | undefined
  let listEl: HTMLDivElement | undefined

  const filtered = createMemo(() => {
    const q = query().trim()
    const scored = props.actions
      .map((a) => ({ a, score: fuzzyScore(q, `${a.group} ${a.label}`) }))
      .filter((x) => x.score >= 0)
    if (!q) return props.actions
    scored.sort((x, y) => y.score - x.score)
    return scored.map((x) => x.a)
  })

  // Reset selection whenever the filtered list changes shape.
  createEffect(
    () => filtered(),
    () => {
      setActiveIdx(0)
    },
  )

  const clampedIdx = () => {
    const n = filtered().length
    if (n === 0) return 0
    return ((activeIdx() % n) + n) % n
  }

  const runActive = () => {
    const list = filtered()
    const item = list[clampedIdx()]
    if (item) {
      props.onClose()
      item.run()
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => i + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => i - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runActive()
    }
  }

  onSettled(() => {
    inputEl?.focus()
  })

  // Keep the active row scrolled into view as arrow keys move selection.
  createEffect(
    () => clampedIdx(),
    (idx) => {
      if (!listEl) return
      const row = listEl.querySelectorAll('.hakka-palette-item')[idx] as HTMLElement | undefined
      row?.scrollIntoView({ block: 'nearest' })
    },
  )

  const onOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose()
  }

  return (
    <div
      class="hakka-palette-overlay"
      onClick={onOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div class="hakka-palette">
        <input
          ref={(el) => (inputEl = el)}
          class="hakka-palette-input"
          type="text"
          placeholder="Type a command…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          aria-label="Command palette search"
          aria-activedescendant={filtered()[clampedIdx()] ? `hakka-palette-item-${clampedIdx()}` : undefined}
        />
        <div class="hakka-palette-list" ref={(el) => (listEl = el)} role="listbox">
          <Show when={filtered().length > 0} fallback={<div class="hakka-palette-empty">No matching commands</div>}>
            <For each={filtered()}>
              {(action, i) => (
                <button
                  id={`hakka-palette-item-${i()}`}
                  class={`hakka-palette-item${i() === clampedIdx() ? ' active' : ''}`}
                  role="option"
                  aria-selected={i() === clampedIdx() ? 'true' : 'false'}
                  onMouseEnter={() => setActiveIdx(i())}
                  onClick={() => {
                    props.onClose()
                    action.run()
                  }}
                >
                  <span class="hakka-palette-group">{action.group}</span>
                  <span class="hakka-palette-label">{action.label}</span>
                  <Show when={action.hint}>
                    <span class="hakka-palette-hint">{action.hint}</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
        <div class="hakka-palette-footer">
          <span>
            <kbd class="hakka-kbd">↑</kbd>
            <kbd class="hakka-kbd">↓</kbd> navigate
          </span>
          <span>
            <kbd class="hakka-kbd">Enter</kbd> select
          </span>
          <span>
            <kbd class="hakka-kbd">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
