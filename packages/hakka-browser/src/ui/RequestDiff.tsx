/**
 * Request diff — side-by-side comparison of two captured requests: headers
 * (request + response) and bodies (request + response), each rendered as a
 * unified line diff. Lazy chunk, opened via the "Compare" action (multi-select
 * bulk bar or command palette) once exactly two requests are selected.
 */
import type { NetworkRequest } from 'hakka-core'
import { extractHost, parseUrl } from 'hakka-core'
import { createMemo, For, Show } from 'solid-js'
import type { Component } from 'solid-js'

interface RequestDiffProps {
  left: NetworkRequest
  right: NetworkRequest
  onClose: () => void
}

type LineOp = 'same' | 'add' | 'remove'
interface DiffLine {
  op: LineOp
  text: string
}

/**
 * Minimal LCS-based line diff — fine for header/body line counts (tens to a
 * few hundred lines), not built for huge files. Returns a unified sequence:
 * removed lines from `a` first (in place), then added lines from `b`.
 */
function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ op: 'same', text: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      result.push({ op: 'remove', text: a[i]! })
      i++
    } else {
      result.push({ op: 'add', text: b[j]! })
      j++
    }
  }
  while (i < n) {
    result.push({ op: 'remove', text: a[i]! })
    i++
  }
  while (j < m) {
    result.push({ op: 'add', text: b[j]! })
    j++
  }
  return result
}

function headersToLines(headers: Record<string, string> | undefined): string[] {
  if (!headers) return []
  return Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
}

/** Pretty-print JSON bodies so structurally-identical-but-reformatted bodies diff cleanly; falls back to raw text. */
function bodyToLines(body: string | null | undefined): string[] {
  if (!body) return []
  try {
    return JSON.stringify(JSON.parse(body), null, 2).split('\n')
  } catch {
    return body.split('\n')
  }
}

const DiffBlock: Component<{ title: string; before: string[]; after: string[] }> = (props) => {
  const lines = createMemo(() => diffLines(props.before, props.after))
  const hasChanges = createMemo(() => lines().some((l) => l.op !== 'same'))
  const isEmpty = createMemo(() => props.before.length === 0 && props.after.length === 0)

  return (
    <Show when={!isEmpty()}>
      <p class="hakka-section-title">
        {props.title}
        <Show when={!hasChanges()}>
          <span style="font-weight:400;color:var(--hakka-text-tertiary)"> — identical</span>
        </Show>
      </p>
      <pre class="hakka-diff-block">
        <For each={lines()}>
          {(line) => (
            <div class={`hakka-diff-line hakka-diff-${line.op}`}>
              <span class="hakka-diff-marker">{line.op === 'add' ? '+' : line.op === 'remove' ? '-' : ' '}</span>
              <span class="hakka-diff-text">{line.text}</span>
            </div>
          )}
        </For>
      </pre>
    </Show>
  )
}

export const RequestDiff: Component<RequestDiffProps> = (props) => {
  const leftLabel = createMemo(() => `${props.left.method.toUpperCase()} ${parseUrl(props.left.url).path || '/'}`)
  const rightLabel = createMemo(() => `${props.right.method.toUpperCase()} ${parseUrl(props.right.url).path || '/'}`)
  const hasAnyContent = createMemo(
    () =>
      headersToLines(props.left.requestHeaders).length > 0 ||
      headersToLines(props.left.responseHeaders).length > 0 ||
      Boolean(props.left.requestBody) ||
      Boolean(props.left.responseBody) ||
      headersToLines(props.right.requestHeaders).length > 0 ||
      headersToLines(props.right.responseHeaders).length > 0 ||
      Boolean(props.right.requestBody) ||
      Boolean(props.right.responseBody),
  )

  return (
    <div class="hakka-diff">
      <div class="hakka-diff-header">
        <button class="hakka-back-btn" onClick={props.onClose}>
          Close diff
        </button>
        <div class="hakka-diff-summary">
          <div class="hakka-diff-side">
            <span class="hakka-diff-side-label">A</span> {leftLabel()}
            <span class="hakka-diff-side-host"> · {extractHost(props.left.url)}</span>
          </div>
          <div class="hakka-diff-side">
            <span class="hakka-diff-side-label">B</span> {rightLabel()}
            <span class="hakka-diff-side-host"> · {extractHost(props.right.url)}</span>
          </div>
        </div>
      </div>
      <div class="hakka-tab-content">
        <DiffBlock
          title="Request Headers"
          before={headersToLines(props.left.requestHeaders)}
          after={headersToLines(props.right.requestHeaders)}
        />
        <DiffBlock
          title="Response Headers"
          before={headersToLines(props.left.responseHeaders)}
          after={headersToLines(props.right.responseHeaders)}
        />
        <DiffBlock
          title="Request Body"
          before={bodyToLines(props.left.requestBody)}
          after={bodyToLines(props.right.requestBody)}
        />
        <DiffBlock
          title="Response Body"
          before={bodyToLines(props.left.responseBody)}
          after={bodyToLines(props.right.responseBody)}
        />
        <Show when={!hasAnyContent()}>
          <div class="hakka-list-empty">
            <span class="hakka-empty-title">Nothing to compare — both requests have no headers or bodies</span>
          </div>
        </Show>
      </div>
    </div>
  )
}
