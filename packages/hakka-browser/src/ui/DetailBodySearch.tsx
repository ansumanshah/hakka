// Solid 2.0 moved the JSX namespace type to @solidjs/web (solid-js no longer
// exports it).
import type { JSX } from '@solidjs/web'
import type { Component } from 'solid-js'
import { createMemo, createSignal, onSettled, Show } from 'solid-js'

import { IconArrowDown, IconArrowUp } from './icons'
import { JsonViewer } from './LazyJsonViewer'

const BODY_DISPLAY_CAP = 50_000

interface BodySearchProps {
  text: string | null | undefined
}

/**
 * Body viewer with an inline search bar. Renders the raw text with all matches
 * highlighted (amber) and the active match highlighted brighter. Next/prev
 * buttons and an n/m counter navigate between matches. When no query is active,
 * falls back to the normal JsonViewer.
 */
export const BodySearch: Component<BodySearchProps> = (props) => {
  // `inputValue` mirrors every keystroke immediately (bound to the <input>);
  // `query` only catches up ~120ms after typing stops and is what actually
  // drives the (potentially expensive, full-body) search below — so a fast
  // typist doesn't re-scan the body on every single character.
  const [inputValue, setInputValue] = createSignal('')
  const [query, setQuery] = createSignal('')
  const [activeIdx, setActiveIdx] = createSignal(0)

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  onSettled(() => () => clearTimeout(debounceTimer))

  // Body clipped to the same window highlightedBody displays — matches past
  // BODY_DISPLAY_CAP can never be shown, so there's no point scanning past it.
  const cappedBody = createMemo(() => {
    const rawBody = props.text ?? ''
    return rawBody.length > BODY_DISPLAY_CAP ? rawBody.slice(0, BODY_DISPLAY_CAP) : rawBody
  })

  const matches = createMemo<[number, number][]>(() => {
    const q = query().toLowerCase()
    const body = cappedBody()
    if (!q || !body) return []
    const result: [number, number][] = []
    const bodyLower = body.toLowerCase()
    let pos = 0
    while (pos < bodyLower.length) {
      const idx = bodyLower.indexOf(q, pos)
      if (idx < 0) break
      result.push([idx, idx + q.length])
      pos = idx + q.length
    }
    return result
  })

  const total = () => matches().length
  const clampedIdx = () => (total() === 0 ? 0 : activeIdx() % total())

  const goNext = () => {
    if (total() === 0) return
    setActiveIdx((i) => (i + 1) % total())
  }

  const goPrev = () => {
    if (total() === 0) return
    setActiveIdx((i) => (i - 1 + total()) % total())
  }

  const highlightedBody = createMemo((): JSX.Element => {
    const rawBody = props.text ?? ''
    const body = cappedBody()
    const truncated = rawBody.length > BODY_DISPLAY_CAP
    const ms = matches()
    const activeI = clampedIdx()
    const parts: JSX.Element[] = []
    let cursor = 0
    ms.forEach(([start, end], i) => {
      if (start >= body.length) return
      const safeEnd = Math.min(end, body.length)
      if (cursor < start) parts.push(<span>{body.slice(cursor, start)}</span>)
      const isActive = i === activeI
      parts.push(
        <mark
          style={
            isActive
              ? 'background:var(--hakka-status-warning);color:var(--hakka-status-on-warm);border-radius: var(--hakka-radius-xs)'
              : 'background:var(--hakka-code-highlight);color:inherit;border-radius: var(--hakka-radius-xs)'
          }
        >
          {body.slice(start, safeEnd)}
        </mark>,
      )
      cursor = safeEnd
    })
    if (cursor < body.length) parts.push(<span>{body.slice(cursor)}</span>)
    return (
      <>
        <pre class="hakka-body-pre">{parts}</pre>
        <Show when={truncated}>
          {/* max-width:none — .hakka-empty-hint's 36ch cap is meant for a centered
              empty-state caption; this is a full-width footnote under a wide <pre>. */}
          <p class="hakka-empty-hint" style="margin-top:var(--hakka-space-sm);max-width:none">
            … {(rawBody.length - BODY_DISPLAY_CAP).toLocaleString()} more chars hidden (body too large to display fully)
          </p>
        </Show>
      </>
    )
  })

  return (
    <>
      {/* Search toolbar — a plain bordered input row; the full-bleed
          .hakka-search treatment belongs to the list's primary bar only. */}
      <div style="display:flex;align-items:center;gap:var(--hakka-space-sm);margin-bottom:var(--hakka-space-md)">
        <input
          class="hakka-input"
          style="flex:1;height:var(--hakka-ctl-h);padding:0 var(--hakka-space-md)"
          type="text"
          placeholder="Search body…"
          value={inputValue()}
          onInput={(e) => {
            const next = e.currentTarget.value
            setInputValue(next)
            setActiveIdx(0)
            clearTimeout(debounceTimer)
            debounceTimer = setTimeout(() => setQuery(next), 120)
          }}
        />
        <Show when={query() && total() > 0}>
          <span style="font-size:var(--hakka-font-xs);color:var(--hakka-text-tertiary);white-space:nowrap">
            {clampedIdx() + 1}/{total()}
          </span>
          <button class="hakka-btn" onClick={goPrev} title="Previous match (↑)">
            <IconArrowUp size={11} />
          </button>
          <button class="hakka-btn" onClick={goNext} title="Next match (↓)">
            <IconArrowDown size={11} />
          </button>
        </Show>
        <Show when={query() && total() === 0}>
          <span style="font-size:var(--hakka-font-xs);color:var(--hakka-status-error);white-space:nowrap">
            No matches
          </span>
        </Show>
      </div>
      <Show when={query() && total() > 0} fallback={<JsonViewer text={props.text} />}>
        {highlightedBody()}
      </Show>
    </>
  )
}
