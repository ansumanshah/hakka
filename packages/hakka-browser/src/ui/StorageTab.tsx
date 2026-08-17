import { createSignal, For, Show } from 'solid-js'
import type { Component } from 'solid-js'

import { readStorage, removeStorageItem, clearStorageArea, setStorageItem, setCookie } from '../adapters/storage'
import type { KV, StorageArea } from '../adapters/storage'
import { IconChevronDown, IconChevronRight, IconClose } from './icons'

const MAX_VALUE_DISPLAY = 120

function truncate(s: string): string {
  if (s.length <= MAX_VALUE_DISPLAY) return s
  return s.slice(0, MAX_VALUE_DISPLAY) + '…'
}

interface SectionProps {
  title: string
  area: StorageArea
  items: KV[]
  onRefresh: () => void
}

const StorageSection: Component<SectionProps> = (props) => {
  const [open, setOpen] = createSignal(true)

  const [newKey, setNewKey] = createSignal('')
  const [newValue, setNewValue] = createSignal('')
  // Cookie-only: path/expiry are the only other fields document.cookie lets JS
  // set. No HttpOnly control — script can't set or read it back.
  const [newPath, setNewPath] = createSignal('/')
  const [newExpires, setNewExpires] = createSignal('')

  const [editingKey, setEditingKey] = createSignal<string | null>(null)
  const [editValue, setEditValue] = createSignal('')

  const handleDelete = (key: string) => {
    removeStorageItem(props.area, key)
    props.onRefresh()
  }

  const handleClear = () => {
    clearStorageArea(props.area)
    props.onRefresh()
  }

  // Editing an existing row: cookie path can't be read back from
  // document.cookie, so this always rewrites at the default path — same
  // assumption removeStorageItem() makes for deletes.
  const writeValue = (key: string, value: string) => {
    if (props.area === 'cookies') {
      setCookie(key, value)
    } else {
      setStorageItem(props.area, key, value)
    }
  }

  const handleAdd = () => {
    const key = newKey().trim()
    if (!key) return
    if (props.area === 'cookies') {
      setCookie(key, newValue(), { path: newPath().trim() || '/', expires: newExpires() || undefined })
    } else {
      setStorageItem(props.area, key, newValue())
    }
    setNewKey('')
    setNewValue('')
    setNewExpires('')
    props.onRefresh()
  }

  const startEdit = (item: KV) => {
    setEditingKey(item.key)
    setEditValue(item.value)
  }

  const commitEdit = (key: string) => {
    if (editingKey() !== key) return
    writeValue(key, editValue())
    setEditingKey(null)
    props.onRefresh()
  }

  const cancelEdit = () => {
    setEditingKey(null)
  }

  return (
    <div style="margin-bottom:var(--hakka-space-xl)">
      <div
        style="display:flex;align-items:center;gap:var(--hakka-space-md);padding:var(--hakka-space-md) 0;cursor:pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <span style="color:var(--hakka-text-tertiary);display:inline-flex">
          {open() ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        </span>
        <span class="hakka-section-title flush">{props.title}</span>
        <span class="hakka-count-badge outline">{props.items.length}</span>
        <div style="flex:1" />
        <Show when={props.items.length > 0}>
          <button
            class="hakka-btn"
            onClick={(e) => {
              e.stopPropagation()
              handleClear()
            }}
          >
            Clear
          </button>
        </Show>
      </div>

      <Show when={open()}>
        <div class="hakka-form-row" style="padding:0 0 var(--hakka-space-md)">
          <input
            type="text"
            class="hakka-input"
            style="flex:1;min-width:0"
            placeholder="Key"
            aria-label={`New ${props.title} key`}
            value={newKey()}
            onInput={(e) => setNewKey((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
          <input
            type="text"
            class="hakka-input hakka-input-mono"
            style="flex:2;min-width:0"
            placeholder="Value"
            aria-label={`New ${props.title} value`}
            value={newValue()}
            onInput={(e) => setNewValue((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
          <Show when={props.area === 'cookies'}>
            <input
              type="text"
              class="hakka-input"
              style="width:70px;flex-shrink:0"
              placeholder="Path"
              aria-label="New cookie path"
              value={newPath()}
              onInput={(e) => setNewPath((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
              }}
            />
            <input
              type="date"
              class="hakka-input"
              style="width:130px;flex-shrink:0"
              aria-label="New cookie expiry (optional — session cookie if left blank)"
              value={newExpires()}
              onInput={(e) => setNewExpires((e.target as HTMLInputElement).value)}
            />
          </Show>
          <button
            class="hakka-btn-primary"
            style="flex-shrink:0"
            disabled={!newKey().trim()}
            aria-label={`Add ${props.title} entry`}
            onClick={handleAdd}
          >
            Add
          </button>
        </div>

        <Show
          when={props.items.length > 0}
          fallback={
            <div class="hakka-hint hakka-hint-em" style="padding:var(--hakka-space-md) 0">
              Empty
            </div>
          }
        >
          <table class="hakka-kv-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th style="width:32px" />
              </tr>
            </thead>
            <tbody>
              <For each={props.items}>
                {(item) => (
                  <tr>
                    <td class="hakka-kv-key">{item.key}</td>
                    <Show
                      when={editingKey() === item.key}
                      fallback={
                        <td
                          class="hakka-kv-value hakka-input-mono hakka-kv-value-editable"
                          title="Click to edit"
                          onClick={() => startEdit(item)}
                        >
                          {truncate(item.value)}
                        </td>
                      }
                    >
                      <td class="hakka-kv-value">
                        <input
                          type="text"
                          class="hakka-input hakka-input-mono"
                          style="width:100%"
                          aria-label={`Edit value for ${item.key}`}
                          value={editValue()}
                          onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              commitEdit(item.key)
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              cancelEdit()
                            }
                          }}
                          onBlur={() => commitEdit(item.key)}
                          ref={(el) => queueMicrotask(() => el.focus())}
                        />
                      </td>
                    </Show>
                    <td>
                      {/* 2px vertical inset (not a space rung) keeps this icon-only delete
                          button tighter than the default .hakka-btn padding. */}
                      <button
                        class="hakka-btn"
                        // ui-token-check-ignore-next-line: icon-button hit-target trim, not a spacing rung
                        style="padding:2px var(--hakka-space-sm);color:var(--hakka-status-error)"
                        title="Delete"
                        onClick={() => handleDelete(item.key)}
                      >
                        <IconClose size={11} />
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  )
}

interface StorageTabProps {
  /** When this prop toggles to true, refresh storage data. */
  active: boolean
}

export const StorageTab: Component<StorageTabProps> = (_props) => {
  const snap = readStorage()
  const [local, setLocal] = createSignal<KV[]>(snap.local)
  const [session, setSession] = createSignal<KV[]>(snap.session)
  const [cookies, setCookies] = createSignal<KV[]>(snap.cookies)

  const refresh = () => {
    const s = readStorage()
    setLocal(s.local)
    setSession(s.session)
    setCookies(s.cookies)
  }

  return (
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
      {/* No tab-level title (DESIGN.md) — each section below carries its own title + count. */}
      <div style="display:flex;align-items:center;justify-content:flex-end;padding:var(--hakka-space-md) var(--hakka-space-xl);border-bottom:1px solid var(--hakka-border);background:var(--hakka-surface);flex-shrink:0">
        <button class="hakka-btn" onClick={refresh}>
          Refresh
        </button>
      </div>

      <div style="flex:1;overflow-y:auto;padding:var(--hakka-space-xl)">
        <StorageSection title="localStorage" area="local" items={local()} onRefresh={refresh} />
        <StorageSection title="sessionStorage" area="session" items={session()} onRefresh={refresh} />
        <StorageSection title="Cookies" area="cookies" items={cookies()} onRefresh={refresh} />
      </div>
    </div>
  )
}
