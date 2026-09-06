import { createSignal, For, onSettled } from 'solid-js'
import type { Component } from 'solid-js'

interface ReplEntry {
  input: string
  output: string
  tone: 'result' | 'error'
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

/** An explicit, page-context JavaScript runner. It never evaluates until Run is tapped. */
export const ConsoleRepl: Component = () => {
  const [source, setSource] = createSignal('')
  const [history, setHistory] = createSignal<string[]>([])
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const [draft, setDraft] = createSignal('')
  const [entries, setEntries] = createSignal<ReplEntry[]>([])
  let input: HTMLTextAreaElement | undefined

  onSettled(() => input?.focus())

  const run = async () => {
    const code = source().trim()
    if (!code) return
    setHistory((items) => (items.at(-1) === code ? items : [...items, code].slice(-100)))
    setHistoryIndex(-1)
    setDraft('')
    setSource('')
    try {
      // AsyncFunction keeps `await` useful from the mobile prompt while preserving
      // the page's global scope as the function's `this` value.
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...args: string[]
      ) => (...args: unknown[]) => unknown
      let evaluate: (...args: unknown[]) => unknown
      try {
        evaluate = new AsyncFunction(`return (${code})`)
      } catch {
        evaluate = new AsyncFunction(code)
      }
      const result = await evaluate.call(window)
      setEntries((items) =>
        [...items, { input: code, output: renderValue(result).slice(0, 16384), tone: 'result' } as ReplEntry].slice(
          -100,
        ),
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      setEntries((items) =>
        [...items, { input: code, output: message.slice(0, 16384), tone: 'error' } as ReplEntry].slice(-100),
      )
    }
  }

  const moveHistory = (direction: -1 | 1) => {
    const items = history()
    if (!items.length) return
    const current = historyIndex()
    if (current < 0 && direction === 1) return
    if (current < 0) setDraft(source())
    const next =
      direction === -1
        ? current < 0
          ? items.length - 1
          : Math.max(0, current - 1)
        : current >= items.length - 1
          ? -1
          : current + 1
    setHistoryIndex(next)
    setSource(next < 0 ? draft() : (items[next] ?? ''))
  }

  return (
    <div class="hakka-repl">
      <p class="hakka-hint hakka-repl-note">Runs only after you tap Run. Use ↑/↓ for command history.</p>
      <div class="hakka-repl-results" aria-live="polite">
        <For each={entries()}>
          {(entry) => (
            <div class="hakka-repl-entry">
              <pre class="hakka-repl-input">› {entry.input}</pre>
              <pre class={`hakka-repl-output ${entry.tone}`}>{entry.output}</pre>
            </div>
          )}
        </For>
      </div>
      <div class="hakka-repl-composer">
        <textarea
          ref={(element) => (input = element)}
          class="hakka-input hakka-input-mono hakka-repl-textarea"
          aria-label="Run JavaScript in this page"
          placeholder="document.title"
          value={source()}
          onInput={(event) => setSource(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void run()
            }
            if (event.key === 'ArrowUp' && !source().includes('\n')) {
              event.preventDefault()
              moveHistory(-1)
            }
            if (event.key === 'ArrowDown' && !source().includes('\n')) {
              event.preventDefault()
              moveHistory(1)
            }
          }}
        />
        <button class="hakka-btn-primary" onClick={() => void run()} disabled={!source().trim()}>
          Run
        </button>
      </div>
    </div>
  )
}
