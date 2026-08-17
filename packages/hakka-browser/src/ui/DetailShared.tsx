// Small presentational atoms shared by more than one Detail tab (Overview's
// KV table plus the Request/Response tabs' headers table both render rows
// through KVRow).
import type { Component } from 'solid-js'
import { For, Show } from 'solid-js'

interface KVRowProps {
  k: string
  v: string
}

export const KVRow: Component<KVRowProps> = (props) => (
  <tr>
    <td class="hakka-kv-key">{props.k}</td>
    <td class="hakka-kv-value">{props.v}</td>
  </tr>
)

interface HeadersTableProps {
  headers: Record<string, string> | undefined
  title: string
}

export const HeadersTable: Component<HeadersTableProps> = (props) => {
  const entries = () => Object.entries(props.headers ?? {})
  return (
    <Show when={entries().length > 0}>
      <p class="hakka-section-title">{props.title}</p>
      <table class="hakka-kv-table">
        <tbody>
          <For each={entries()}>{([k, v]) => <KVRow k={k} v={v} />}</For>
        </tbody>
      </table>
    </Show>
  )
}
