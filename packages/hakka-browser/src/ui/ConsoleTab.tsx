import { logStore } from 'hakka-core'
import type { LogEntry, LogLevel } from 'hakka-core'
import { createSignal, onSettled, For, Show, createMemo } from 'solid-js'
import type { Component } from 'solid-js'

import { getConsoleEntries, onConsoleEntry, clearConsole } from '../capture/console'
import type { ConsoleEntry } from '../capture/console'
import { JsonViewer } from './LazyJsonViewer'

type LevelFilter = 'all' | 'log' | 'warn' | 'error'
type SourceView = 'console' | 'logs'
type StructuredLevelFilter = 'all' | LogLevel

const LEVEL_FILTERS: LevelFilter[] = ['all', 'log', 'warn', 'error']
const STRUCTURED_LEVEL_FILTERS: StructuredLevelFilter[] = ['all', 'debug', 'info', 'warn', 'error']

function levelColor(level: ConsoleEntry['level']): string {
  switch (level) {
    case 'error':
      return 'var(--hakka-status-error)'
    case 'warn':
      return 'var(--hakka-status-warning)'
    case 'info':
      return 'var(--hakka-status-info)'
    default:
      return 'var(--hakka-text)'
  }
}

/** Structured LogLevel -> Wok Hei semantic tone. debug=tertiary, info=steel, warn=turmeric, error=chili. */
function structuredLevelColor(level: LogLevel): string {
  switch (level) {
    case 'error':
      return 'var(--hakka-status-error)'
    case 'warn':
      return 'var(--hakka-status-warning)'
    case 'info':
      return 'var(--hakka-status-info)'
    default:
      return 'var(--hakka-text-tertiary)'
  }
}

/** hh:mm:ss.mmm — structured logs benefit from millisecond resolution beyond formatTimestamp. */
function formatLogTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const hh = date.getHours().toString().padStart(2, '0')
  const mm = date.getMinutes().toString().padStart(2, '0')
  const ss = date.getSeconds().toString().padStart(2, '0')
  const ms = date.getMilliseconds().toString().padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

interface StructuredLogRowProps {
  entry: LogEntry
}

const StructuredLogRow: Component<StructuredLogRowProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false)
  const hasMetadata = () => props.entry.metadata !== undefined && Object.keys(props.entry.metadata).length > 0

  return (
    <div
      class="hakka-log-row"
      style="display:flex;flex-direction:column;padding:var(--hakka-space-sm) var(--hakka-space-xl);border-bottom:1px solid var(--hakka-border)"
    >
      <div style="display:flex;align-items:flex-start;gap:var(--hakka-space-md)">
        <span style="font-family:var(--hakka-font-mono);font-size:var(--hakka-font-xs);color:var(--hakka-text-tertiary);flex-shrink:0;padding-top: var(--hakka-space-xxs);font-variant-numeric:tabular-nums">
          {formatLogTimestamp(props.entry.timestamp)}
        </span>

        <span
          style={`font-size:var(--hakka-font-xs);font-weight:700;min-width:36px;flex-shrink:0;padding-top: var(--hakka-space-xxs);color:${structuredLevelColor(props.entry.level)}`}
        >
          {props.entry.level.toUpperCase()}
        </span>

        <Show when={props.entry.category}>
          <span style="flex-shrink:0;padding-top:1px" title={props.entry.category}>
            <span class="hakka-chip" style="cursor:default;pointer-events:none">
              {props.entry.category}
            </span>
          </span>
        </Show>

        <pre style="flex:1;margin:0;font-family:var(--hakka-font-mono);font-size:var(--hakka-font-xs);line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--hakka-text)">
          {props.entry.message}
        </pre>

        <Show when={hasMetadata()}>
          <button
            class="hakka-json-toggle"
            style="flex-shrink:0"
            onClick={() => setExpanded((e) => !e)}
            title={expanded() ? 'Hide metadata' : 'Show metadata'}
          >
            {expanded() ? '▾' : '▸'} meta
          </button>
        </Show>
      </div>

      <Show when={hasMetadata() && expanded()}>
        {/* 44px lines the metadata up under the message column (past timestamp+level+category) —
            not a space rung, content-driven alignment. */}
        {/* ui-token-check-ignore-next-line: aligns under the message column, not a spacing rung */}
        <div style="margin:var(--hakka-space-sm) 0 0 44px">
          <JsonViewer text={JSON.stringify(props.entry.metadata)} />
        </div>
      </Show>
    </div>
  )
}

interface ConsoleTabProps {
  /** Active prop: when true this tab is visible and should auto-scroll. */
  active: boolean
}

export const ConsoleTab: Component<ConsoleTabProps> = (props) => {
  const [view, setView] = createSignal<SourceView>('console')

  // ── browser console mirror state ──────────────────────────────────────────
  const [entries, setEntries] = createSignal<ConsoleEntry[]>(getConsoleEntries())
  const [levelFilter, setLevelFilter] = createSignal<LevelFilter>('all')
  const [search, setSearch] = createSignal('')

  // ── structured hakka-core logStore state ──────────────────────────────────
  const [logEntries, setLogEntries] = createSignal<LogEntry[]>(logStore.getEntries())
  const [structuredLevelFilter, setStructuredLevelFilter] = createSignal<StructuredLevelFilter>('all')
  const [structuredSearch, setStructuredSearch] = createSignal('')

  let listEl: HTMLDivElement | undefined
  let logListEl: HTMLDivElement | undefined

  function scrollToBottom(el: HTMLDivElement | undefined): void {
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    // Only auto-scroll if within 80px of the bottom
    if (scrollHeight - scrollTop - clientHeight < 80) {
      el.scrollTop = scrollHeight
    }
  }

  onSettled(() => {
    const unsub = onConsoleEntry(() => {
      setEntries(getConsoleEntries())
      if (props.active && view() === 'console') scrollToBottom(listEl)
    })
    const unsubLog = logStore.subscribe(() => {
      setLogEntries(logStore.getEntries())
      if (props.active && view() === 'logs') scrollToBottom(logListEl)
    })
    // onSettled runs later than onMount — resync in case entries arrived before settle.
    setEntries(getConsoleEntries())
    setLogEntries(logStore.getEntries())
    return () => {
      unsub()
      unsubLog()
    }
  })

  const filtered = createMemo(() => {
    const lf = levelFilter()
    const q = search().toLowerCase().trim()
    return entries().filter((e) => {
      if (lf !== 'all' && e.level !== lf && !(lf === 'error' && e.level === 'error')) {
        if (lf === 'log' && e.level !== 'log' && e.level !== 'debug') return false
        if (lf === 'warn' && e.level !== 'warn') return false
        if (lf === 'error' && e.level !== 'error') return false
      }
      if (q && !e.message.toLowerCase().includes(q)) return false
      return true
    })
  })

  const filteredLogs = createMemo(() => {
    const lf = structuredLevelFilter()
    const q = structuredSearch().toLowerCase().trim()
    return logEntries().filter((e) => {
      if (lf !== 'all' && e.level !== lf) return false
      if (q) {
        const haystack = `${e.message} ${e.category ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  })

  const handleClear = () => {
    clearConsole()
    setEntries([])
  }

  const handleClearLogs = () => {
    logStore.clear()
    setLogEntries([])
  }

  return (
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
      {/* No tab-level title (DESIGN.md) — straight into the source switch. */}
      {/* Source switch: browser console mirror vs hakka-core structured logs —
          the canonical segmented control (same component Rules uses for
          Mock/Breakpoints/Throttle), not a pair of filter chips. */}
      <div class="hakka-filter-bar">
        <div class="hakka-seg" role="tablist" aria-label="Log source">
          <button
            class={`hakka-seg-btn${view() === 'console' ? ' on' : ''}`}
            role="tab"
            aria-selected={view() === 'console' ? 'true' : 'false'}
            onClick={() => setView('console')}
          >
            Console
          </button>
          <button
            class={`hakka-seg-btn${view() === 'logs' ? ' on' : ''}`}
            role="tab"
            aria-selected={view() === 'logs' ? 'true' : 'false'}
            onClick={() => setView('logs')}
          >
            Structured
            <Show when={logStore.size() > 0}>
              <span class="hakka-count-badge sm outline">{logStore.size()}</span>
            </Show>
          </button>
        </div>
      </div>

      <Show when={view() === 'console'}>
        <div class="hakka-filter-bar">
          <input
            class="hakka-search"
            type="text"
            placeholder="Search console…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <div class="hakka-chip-sep" />
          <For each={LEVEL_FILTERS}>
            {(lf) => (
              <button class={`hakka-chip${levelFilter() === lf ? ' active' : ''}`} onClick={() => setLevelFilter(lf)}>
                {lf === 'all' ? 'All' : lf.charAt(0).toUpperCase() + lf.slice(1)}
              </button>
            )}
          </For>
          <div class="hakka-chip-sep" />
          <button class="hakka-btn" onClick={handleClear}>
            Clear
          </button>
        </div>

        <div ref={(el) => (listEl = el)} style="flex:1;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain">
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="hakka-list-empty">
                <span class="hakka-empty-title">No console output captured yet</span>
              </div>
            }
          >
            <For each={filtered()}>
              {(entry) => (
                <div
                  style={`display:flex;align-items:flex-start;gap:var(--hakka-space-md);padding:var(--hakka-space-sm) var(--hakka-space-xl);border-bottom:1px solid var(--hakka-border);color:${levelColor(entry.level)}`}
                >
                  <span
                    style={`font-size:var(--hakka-font-xs);font-weight:700;min-width:32px;flex-shrink:0;padding-top: var(--hakka-space-xxs);color:${levelColor(entry.level)}`}
                  >
                    {entry.level.toUpperCase()}
                  </span>

                  <pre style="flex:1;margin:0;font-family:var(--hakka-font-mono);font-size:var(--hakka-font-xs);line-height:1.5;white-space:pre-wrap;word-break:break-all;color:inherit">
                    {entry.message}
                  </pre>

                  {/* --hakka-text (not raw #fff) so the fill reads legibly against
                      --hakka-text-tertiary in both themes. */}
                  <Show when={entry.count > 1}>
                    <span
                      class="hakka-count-badge"
                      style="flex-shrink:0;background:var(--hakka-text-tertiary);color:var(--hakka-text)"
                    >
                      {entry.count}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <Show when={view() === 'logs'}>
        <div class="hakka-filter-bar">
          <input
            class="hakka-search"
            type="text"
            placeholder="Search logs…"
            value={structuredSearch()}
            onInput={(e) => setStructuredSearch(e.currentTarget.value)}
          />
          <div class="hakka-chip-sep" />
          <For each={STRUCTURED_LEVEL_FILTERS}>
            {(lf) => (
              <button
                class={`hakka-chip${structuredLevelFilter() === lf ? ' active' : ''}`}
                onClick={() => setStructuredLevelFilter(lf)}
              >
                {lf === 'all' ? 'All' : lf.charAt(0).toUpperCase() + lf.slice(1)}
              </button>
            )}
          </For>
          <div class="hakka-chip-sep" />
          <button class="hakka-btn" onClick={handleClearLogs}>
            Clear
          </button>
        </div>

        <div
          ref={(el) => (logListEl = el)}
          style="flex:1;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain"
        >
          <Show
            when={filteredLogs().length > 0}
            fallback={
              <div class="hakka-list-empty">
                <span class="hakka-empty-title">No structured logs captured yet</span>
              </div>
            }
          >
            <For each={filteredLogs()}>{(entry) => <StructuredLogRow entry={entry} />}</For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
