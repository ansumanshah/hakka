import { createSignal, For, onCleanup, onSettled, Show } from 'solid-js'
import type { Component } from 'solid-js'

import {
  describeElement,
  getPageElements,
  getPageOutline,
  getRemotePageEditsEnabled,
  inspectPageElement,
  setRemotePageEditsEnabled,
} from './pageDiagnostics'
import type { PageElementSummary } from './pageDiagnostics'

interface PageTabProps {
  active: boolean
}

export const PageTab: Component<PageTabProps> = () => {
  const [query, setQuery] = createSignal('')
  const [matches, setMatches] = createSignal<Element[]>([])
  const [selected, setSelected] = createSignal<PageElementSummary | null>(null)
  const [picking, setPicking] = createSignal(false)
  const [error, setError] = createSignal('')
  const [outline, setOutline] = createSignal<Element[]>([])

  const select = (element: Element) => {
    setSelected(inspectPageElement(element))
    setError('')
  }

  const find = () => {
    const selector = query().trim()
    if (!selector) return
    try {
      const found = getPageElements(selector)
      setMatches(found)
      setError(found.length ? '' : 'No matches.')
      if (found[0]) select(found[0])
    } catch (cause: unknown) {
      setMatches([])
      setError(cause instanceof Error ? cause.message : 'Invalid selector.')
    }
  }

  const stopPicking = () => setPicking(false)
  const onPick = (event: PointerEvent) => {
    if (!picking()) return
    const element = event.target instanceof Element ? event.target : null
    if (!element || element.closest('hakka-inspector')) return
    event.preventDefault()
    event.stopPropagation()
    select(element)
    stopPicking()
  }

  onSettled(() => {
    setOutline(getPageOutline())
    document.addEventListener('pointerdown', onPick, true)
  })
  onCleanup(() => document.removeEventListener('pointerdown', onPick, true))

  return (
    <div class="hakka-page-tab">
      <div class="hakka-page-search">
        <input
          class="hakka-input hakka-input-mono"
          aria-label="Find by CSS"
          placeholder="#checkout, main"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => event.key === 'Enter' && find()}
        />
        <button class="hakka-btn" onClick={find}>
          Find
        </button>
        <button
          class={`hakka-btn${picking() ? ' active' : ''}`}
          onClick={() => setPicking(!picking())}
          aria-pressed={picking() ? 'true' : 'false'}
        >
          {picking() ? 'Cancel' : 'Pick'}
        </button>
      </div>
      <Show when={picking()}>
        <p class="hakka-hint hakka-hint-em">Tap an element to inspect it.</p>
      </Show>
      <label class="hakka-hint">
        <input
          type="checkbox"
          checked={getRemotePageEditsEnabled()}
          onChange={(event) => setRemotePageEditsEnabled(event.currentTarget.checked)}
        />{' '}
        Allow remote edits this session
      </label>
      <Show when={error()}>
        <p class="hakka-page-error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="hakka-page-content">
        <div class="hakka-page-outline" aria-label="Page elements">
          <div class="hakka-section-title flush">Page outline</div>
          <For each={matches().length ? matches() : outline()}>
            {(element) => (
              <button class="hakka-page-node" onClick={() => select(element)}>
                {describeElement(element)}
              </button>
            )}
          </For>
        </div>
        <Show when={selected()} fallback={<p class="hakka-hint">Choose an element to inspect.</p>}>
          {(summary) => (
            <div class="hakka-page-detail">
              <div class="hakka-section-title flush">{summary().selector}</div>
              <Show when={summary().text}>
                <p class="hakka-page-text">{summary().text}</p>
              </Show>
              <div class="hakka-page-grid">
                <For each={summary().attributes.concat(summary().styles)}>
                  {([name, value]) => (
                    <>
                      <code>{name}</code>
                      <span>{value || '—'}</span>
                    </>
                  )}
                </For>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
