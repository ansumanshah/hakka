import type { JSX } from '@solidjs/web'
import { createEffect, createSignal, createMemo, For, onSettled, Show } from 'solid-js'
import type { Component } from 'solid-js'

import { IconChevronDown, IconChevronRight } from './icons'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// `q` is always already-lowercased (the caller debounces + lowercases once,
// not per node) — true when `q` appears in this node's own key/value or
// anywhere in its subtree. Used both to auto-expand a collapsed branch that
// contains a match and to know whether the WHOLE document has any match at
// all (for the search input's border tint).
function jsonMatches(value: JsonValue, q: string, key?: string): boolean {
  if (!q) return false
  if (key !== undefined && key.toLowerCase().includes(q)) return true
  if (value === null) return 'null'.includes(q)
  if (Array.isArray(value)) return value.some((v, i) => jsonMatches(v, q, String(i)))
  if (typeof value === 'object') return Object.entries(value).some(([k, v]) => jsonMatches(v, q, k))
  return String(value).toLowerCase().includes(q)
}

// Wraps the FIRST case-insensitive occurrence of `q` in `text` with a
// highlight mark — minimal, matches the "no separate results list" framing
// (a node highlights that it contains a hit; jumping between every
// occurrence inside a single string is out of scope for this feature).
function highlightMatch(text: string, q: string): JSX.Element {
  if (!q) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q)
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark class="hakka-json-mark">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

interface NodeProps {
  value: JsonValue
  keyName?: string
  depth: number
  isLast: boolean
  /** Depth at which nodes start collapsed. Defaults to 2 (historic behavior). */
  maxDepth?: number
  /** Live search query (already lowercased), if the tree has an active search. */
  query?: () => string
}

const JsonNode: Component<NodeProps> = (props) => {
  const query = () => props.query?.() ?? ''
  const [collapsed, setCollapsed] = createSignal(props.depth >= (props.maxDepth ?? 2))

  const isObject = () => typeof props.value === 'object' && props.value !== null && !Array.isArray(props.value)
  const isArray = () => Array.isArray(props.value)
  const isComplex = () => isObject() || isArray()

  // Memoised so count() and the <For> below share one entries() computation
  // per value change instead of recomputing it twice per render.
  const entries = createMemo((): [string, JsonValue][] => {
    if (isArray()) return (props.value as JsonValue[]).map((v, i) => [String(i), v])
    if (isObject()) return Object.entries(props.value as Record<string, JsonValue>)
    return []
  })

  const openBracket = () => (isArray() ? '[' : '{')
  const closeBracket = () => (isArray() ? ']' : '}')
  const count = () => entries().length
  const comma = () => (props.isLast ? '' : ',')

  // Auto-expand a collapsed branch the moment a live query matches something
  // inside it — the "auto-expanding matched branches" adoption from the
  // inspector design audit. Only ever expands; clearing the query leaves
  // whatever the user already had open alone.
  createEffect(
    () => {
      const q = query()
      return q.length > 0 && jsonMatches(props.value, q, props.keyName)
    },
    (matches) => {
      if (matches) setCollapsed(false)
    },
  )

  return (
    <div class="hakka-json-node">
      <Show when={isComplex()}>
        <div class="hakka-json-row">
          <button class="hakka-json-toggle" onClick={() => setCollapsed((c) => !c)}>
            {collapsed() ? <IconChevronRight size={9} /> : <IconChevronDown size={9} />}
          </button>
          <Show when={props.keyName !== undefined}>
            <span class="hakka-json-key">"{highlightMatch(props.keyName ?? '', query())}"</span>
            <span class="hakka-json-colon">: </span>
          </Show>
          <span class="hakka-json-bracket">{openBracket()}</span>
          <Show when={collapsed()}>
            <span class="hakka-json-ellipsis" onClick={() => setCollapsed(false)}>
              {count()} {count() === 1 ? 'item' : 'items'}
            </span>
            <span class="hakka-json-bracket">
              {closeBracket()}
              {comma()}
            </span>
          </Show>
        </div>
        <Show when={!collapsed()}>
          <div class="hakka-json-children">
            <For each={entries()}>
              {([k, v], i) => (
                <JsonNode
                  value={v}
                  keyName={isArray() ? undefined : k}
                  depth={props.depth + 1}
                  isLast={i() === count() - 1}
                  maxDepth={props.maxDepth}
                  query={props.query}
                />
              )}
            </For>
          </div>
          <div class="hakka-json-row">
            <span class="hakka-json-bracket">
              {closeBracket()}
              {comma()}
            </span>
          </div>
        </Show>
      </Show>

      <Show when={!isComplex()}>
        <div class="hakka-json-row">
          {/* 14px — not a space rung; matches .hakka-json-toggle's icon+padding footprint so
              leaf rows line up flush under sibling nodes that do have a toggle button. */}
          <span style="width:14px" />
          <Show when={props.keyName !== undefined}>
            <span class="hakka-json-key">"{highlightMatch(props.keyName ?? '', query())}"</span>
            <span class="hakka-json-colon">: </span>
          </Show>
          <Show when={typeof props.value === 'string'}>
            <span class="hakka-json-string">
              "{highlightMatch(props.value as string, query())}"{comma()}
            </span>
          </Show>
          <Show when={typeof props.value === 'number'}>
            <span class="hakka-json-number">
              {highlightMatch(String(props.value), query())}
              {comma()}
            </span>
          </Show>
          <Show when={typeof props.value === 'boolean'}>
            <span class="hakka-json-boolean">
              {highlightMatch(String(props.value), query())}
              {comma()}
            </span>
          </Show>
          <Show when={props.value === null}>
            <span class="hakka-json-null">
              {highlightMatch('null', query())}
              {comma()}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  )
}

const MAX_JSON_RENDER_BYTES = 50_000
const PREVIEW_BYTES = 2_048

interface JsonViewerProps {
  text: string | null | undefined
  /** Depth at which nodes start collapsed. Defaults to 2. */
  maxDepth?: number
}

export const JsonViewer: Component<JsonViewerProps> = (props) => {
  const [showRaw, setShowRaw] = createSignal(false)
  const [searchInput, setSearchInput] = createSignal('')
  const [query, setQuery] = createSignal('')

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  onSettled(() => () => clearTimeout(debounceTimer))

  // A fresh body should never inherit the previous one's active filter —
  // switching rows/requests resets the search instead of silently filtering
  // the new tree against stale text.
  createEffect(
    () => props.text,
    () => {
      setSearchInput('')
      setQuery('')
    },
  )

  const onSearchInput = (value: string): void => {
    setSearchInput(value)
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => setQuery(value.trim().toLowerCase()), 150)
  }

  const isLarge = () => (props.text?.length ?? 0) > MAX_JSON_RENDER_BYTES

  // Memoized parse. `isLarge()` bodies render the preview/reveal UI and never
  // read `parsed().value`, so skip the (potentially expensive) JSON.parse
  // with a dummy `ok: true` — this also spares an invalid-JSON large body
  // from an unbounded raw dump, since it still gets the bounded preview.
  const parsed = createMemo((): { ok: true; value: JsonValue } | { ok: false } => {
    if (!props.text) return { ok: false }
    if (isLarge()) return { ok: true, value: null }
    try {
      return { ok: true, value: JSON.parse(props.text) as JsonValue }
    } catch {
      return { ok: false }
    }
  })
  const kbSize = () => Math.round((props.text?.length ?? 0) / 1024)
  const preview = () => (props.text ?? '').slice(0, PREVIEW_BYTES)

  const hasMatches = createMemo(() => {
    const q = query()
    const p = parsed()
    if (!q || !p.ok) return false
    return jsonMatches(p.value, q)
  })

  const searchClass = (): string => {
    if (!query()) return 'hakka-input hakka-json-search'
    return `hakka-input hakka-json-search ${hasMatches() ? 'match' : 'no-match'}`
  }

  return (
    <Show
      when={parsed().ok}
      fallback={
        <Show when={props.text} fallback={<p class="hakka-empty-hint">No body</p>}>
          <pre class="hakka-body-pre">{props.text}</pre>
        </Show>
      }
    >
      <Show
        when={!isLarge()}
        fallback={
          <div>
            <Show when={!showRaw()} fallback={<pre class="hakka-body-pre">{props.text}</pre>}>
              <pre class="hakka-body-pre">{preview()}</pre>
            </Show>
            <Show when={!showRaw()}>
              <button class="hakka-curl-btn" style="margin-top:var(--hakka-space-md)" onClick={() => setShowRaw(true)}>
                Show raw ({kbSize()} KB)
              </button>
            </Show>
          </div>
        }
      >
        <input
          class={searchClass()}
          type="text"
          placeholder="Search keys and values…"
          aria-label="Search JSON keys and values"
          value={searchInput()}
          onInput={(e) => onSearchInput(e.currentTarget.value)}
        />
        <div class="hakka-json">
          <JsonNode
            value={(parsed() as { ok: true; value: JsonValue }).value}
            depth={0}
            isLast={true}
            maxDepth={props.maxDepth}
            query={query}
          />
        </div>
      </Show>
    </Show>
  )
}
