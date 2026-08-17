/**
 * MockTab — create and manage mock response rules, stored in the MockEngine
 * singleton (main thread). MockEngine has no change listener, so every
 * mutation is followed by a refresh() that re-reads getRules().
 */

import { mockEngine } from 'hakka-core'
import type { MockRule } from 'hakka-core'
import type { Component } from 'solid-js'
import { createSignal, For, Show, onSettled } from 'solid-js'

import { IconClose } from './icons'
import { loadMocks, saveMocks, exportMocksJson, importMocksJson } from './mockPersist'
import type { PanelProps } from './panelRegistry'

type MethodOption = 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type RuleAction = 'mock' | 'redirect' | 'block'

interface FormState {
  pattern: string
  method: MethodOption
  action: RuleAction
  status: number
  body: string
  targetUrl: string
}

const METHOD_OPTIONS: MethodOption[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const ACTION_OPTIONS: { value: RuleAction; label: string }[] = [
  { value: 'mock', label: 'Mock' },
  { value: 'redirect', label: 'Redirect' },
  { value: 'block', label: 'Block' },
]

const DEFAULT_FORM: FormState = {
  pattern: '',
  method: 'ANY',
  action: 'mock',
  status: 200,
  body: '{}',
  targetUrl: '',
}

function statusClass(status: number): string {
  if (status >= 500) return 'status-error'
  if (status >= 400) return 'status-warning'
  if (status >= 300) return 'status-info'
  if (status >= 200) return 'status-success'
  return 'status-pending'
}

function methodClass(method: string | undefined): string {
  const m = method ?? 'ANY'
  const known = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  return known.includes(m) ? `method-${m}` : 'method-OTHER'
}

function isAddEnabled(f: FormState): boolean {
  if (!f.pattern.trim()) return false
  if (f.action === 'redirect' && !f.targetUrl.trim()) return false
  return true
}

function downloadJson(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const MockTab: Component<PanelProps> = () => {
  const [rules, setRules] = createSignal<MockRule[]>([])
  const [form, setForm] = createSignal<FormState>({ ...DEFAULT_FORM })
  let fileInputRef: HTMLInputElement | undefined

  function refresh(): void {
    // Copy each rule: recordHit mutates hitCount in place on the stored rule
    // object, and a same-reference object would never re-render its row.
    // oxlint-disable-next-line no-map-spread -- fresh identity is the point
    setRules(mockEngine.getRules().map((r) => ({ ...r })))
  }

  onSettled(() => {
    loadMocks()
    refresh()
    // Hits accrue from the interceptor, not from panel actions — poll like
    // every other panel so counters tick while the panel is open.
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  })

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleAdd(): void {
    const f = form()
    if (!isAddEnabled(f)) return

    const pattern = f.pattern.trim()
    const method = f.method === 'ANY' ? undefined : f.method

    if (f.action === 'mock') {
      mockEngine.addRule({
        pattern,
        method,
        mode: 'mock',
        response: { status: f.status, body: f.body },
        enabled: true,
      })
    } else if (f.action === 'redirect') {
      mockEngine.addRule({
        pattern,
        method,
        mode: 'rewrite',
        redirectTo: f.targetUrl.trim(),
        response: { status: 200, body: '' },
        enabled: true,
      })
    } else {
      // block
      mockEngine.addRule({
        pattern,
        method,
        block: true,
        response: { status: 0, body: '' },
        enabled: true,
      })
    }

    refresh()
    saveMocks()
    setForm({ ...DEFAULT_FORM })
  }

  function handleToggle(rule: MockRule): void {
    if (rule.enabled) {
      mockEngine.disableRule(rule.id)
    } else {
      mockEngine.enableRule(rule.id)
    }
    refresh()
    saveMocks()
  }

  function handleRemove(id: string): void {
    mockEngine.removeRule(id)
    refresh()
    saveMocks()
  }

  function handleClearAll(): void {
    mockEngine.clearRules()
    refresh()
    saveMocks()
  }

  function handleExport(): void {
    downloadJson(exportMocksJson(), 'hakka-mocks.json')
  }

  function handleImportFile(e: Event): void {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text !== 'string') return
      try {
        importMocksJson(text)
        saveMocks()
        refresh()
      } catch {
        // invalid JSON — silently ignore
      }
    }
    reader.readAsText(file)
    // Reset so the same file can be imported again
    input.value = ''
  }

  const addEnabled = () => isAddEnabled(form())

  return (
    <div class="hakka-pane">
      {/* No tab-level title — tab strip is the title (DESIGN.md); explanation lives in the empty state below. */}

      <div
        class="hakka-card"
        style="display:flex;flex-direction:column;gap: var(--hakka-space-ml);margin-bottom:var(--hakka-space-xl)"
      >
        <div class="hakka-section-title flush">Add Rule</div>

        <div>
          <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
            URL pattern (substring)
          </div>
          <input
            type="text"
            aria-label="URL pattern"
            placeholder="/api/users"
            value={form().pattern}
            class="hakka-input"
            style="width:100%"
            onInput={(e) => setField('pattern', (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
        </div>

        <div class="hakka-form-row" style="align-items:flex-end">
          <div style="flex:1;min-width:160px">
            <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
              Method
            </div>
            <div class="hakka-form-row">
              <For each={METHOD_OPTIONS}>
                {(m) => (
                  <button
                    aria-label={`Select method ${m}`}
                    aria-pressed={form().method === m ? 'true' : 'false'}
                    class={`hakka-chip${form().method === m ? ' active' : ''}${m !== 'ANY' ? ` method-${m}` : ''}`}
                    onClick={() => setField('method', m)}
                  >
                    {m}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div>
            <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
              Action
            </div>
            <div class="hakka-form-row">
              <For each={ACTION_OPTIONS}>
                {(opt) => (
                  <button
                    aria-label={`Select action ${opt.label}`}
                    aria-pressed={form().action === opt.value ? 'true' : 'false'}
                    class={`hakka-chip${form().action === opt.value ? ' active' : ''}`}
                    style={
                      form().action === opt.value && opt.value === 'block'
                        ? 'background:var(--hakka-status-error);color:var(--hakka-status-on);border-color:var(--hakka-status-error)'
                        : form().action === opt.value && opt.value === 'redirect'
                          ? 'background:var(--hakka-status-warning);color:var(--hakka-status-on-warm);border-color:var(--hakka-status-warning)'
                          : ''
                    }
                    onClick={() => setField('action', opt.value)}
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>

        <Show when={form().action === 'mock'}>
          <div class="hakka-form-row" style="align-items:flex-end">
            <div style="width:80px">
              <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
                Status
              </div>
              <input
                type="number"
                aria-label="Response status code"
                min={100}
                max={599}
                value={form().status}
                class="hakka-input"
                style="width:100%;text-align:right"
                onChange={(e) => {
                  const v = Number((e.target as HTMLInputElement).value)
                  if (v >= 100 && v <= 599) setField('status', v)
                }}
              />
            </div>
          </div>

          <div>
            <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
              Response body
            </div>
            <textarea
              aria-label="Response body"
              placeholder="{}"
              rows={3}
              value={form().body}
              class="hakka-input hakka-input-mono"
              style="width:100%;resize:vertical;line-height:1.5"
              onInput={(e) => setField('body', (e.target as HTMLTextAreaElement).value)}
            />
          </div>
        </Show>

        <Show when={form().action === 'redirect'}>
          <div>
            <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
              Target URL
            </div>
            <input
              type="text"
              aria-label="Redirect target URL"
              placeholder="https://staging.example.com/api/users"
              value={form().targetUrl}
              class="hakka-input"
              style="width:100%"
              onInput={(e) => setField('targetUrl', (e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
              }}
            />
          </div>
        </Show>

        <Show when={form().action === 'block'}>
          <div class="hakka-hint hakka-hint-em">
            Matching requests will be aborted with a network error before reaching the server.
          </div>
        </Show>

        <div style="display:flex;justify-content:flex-end">
          <button aria-label="Add mock rule" disabled={!addEnabled()} class="hakka-btn-primary" onClick={handleAdd}>
            Add
          </button>
        </div>
      </div>

      {/* Rules list header: section title + canonical count badge + Export/Import toolbar. */}
      <Show when={rules().length > 0}>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--hakka-space-md);gap:var(--hakka-space-sm);flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:var(--hakka-space-xs)">
            <div class="hakka-section-title flush">Active rules</div>
            <span class="hakka-count-badge outline">{rules().length}</span>
          </div>
          <div class="hakka-form-row">
            <button class="hakka-btn" style="font-size:var(--hakka-font-xs)" onClick={handleExport}>
              Export
            </button>
            <button
              class="hakka-btn"
              style="font-size:var(--hakka-font-xs)"
              onClick={() => fileInputRef?.click()}
              aria-label="Import rules from JSON file"
            >
              Import
            </button>
            <input
              ref={(el) => (fileInputRef = el)}
              type="file"
              accept="application/json"
              style="display:none"
              onChange={handleImportFile}
            />
            <button class="hakka-btn" style="font-size:var(--hakka-font-xs)" onClick={handleClearAll}>
              Clear all
            </button>
          </div>
        </div>
      </Show>

      <Show when={rules().length === 0}>
        <div style="display:flex;justify-content:flex-end;gap:var(--hakka-space-sm);margin-bottom:var(--hakka-space-md)">
          <button class="hakka-btn" style="font-size:var(--hakka-font-xs)" onClick={handleExport}>
            Export
          </button>
          <button
            class="hakka-btn"
            style="font-size:var(--hakka-font-xs)"
            onClick={() => fileInputRef?.click()}
            aria-label="Import rules from JSON file"
          >
            Import
          </button>
          <input
            ref={(el) => (fileInputRef = el)}
            type="file"
            accept="application/json"
            style="display:none"
            onChange={handleImportFile}
          />
        </div>
      </Show>

      <Show
        when={rules().length > 0}
        fallback={
          <div>
            <p class="hakka-empty-title">No mock rules. Add one above to intercept matching requests.</p>
            <p class="hakka-empty-hint" style="margin-top:var(--hakka-space-sm)">
              Mocks intercept fetch / XHR calls before they hit the network — no request is made. Rules run on the main
              thread.
            </p>
          </div>
        }
      >
        <div style="display:flex;flex-direction:column;gap:var(--hakka-space-sm)">
          <For each={rules()}>
            {(rule) => (
              <div
                class="hakka-card"
                style={`padding:var(--hakka-space-ml) var(--hakka-space-lg);opacity:${rule.enabled ? '1' : '0.55'};transition:opacity 0.15s`}
              >
                <div style="display:flex;align-items:center;gap:var(--hakka-space-md);margin-bottom:var(--hakka-space-sm)">
                  <span class={`hakka-method-badge ${methodClass(rule.method)}`}>{rule.method ?? 'ANY'}</span>
                  <span
                    class="hakka-input-mono"
                    style="flex:1;font-size:var(--hakka-font-sm);color:var(--hakka-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                    title={typeof rule.pattern === 'string' ? rule.pattern : rule.pattern.toString()}
                  >
                    {typeof rule.pattern === 'string' ? rule.pattern : rule.pattern.toString()}
                  </span>
                  <Show when={rule.block}>
                    <span
                      class="hakka-mocked-tag"
                      style="background:var(--hakka-status-error);color:var(--hakka-status-on);border-color:var(--hakka-status-error)"
                    >
                      block
                    </span>
                  </Show>
                  <Show when={!rule.block && rule.redirectTo != null}>
                    <span
                      class="hakka-mocked-tag"
                      style="background:var(--hakka-status-warning);color:var(--hakka-status-on-warm);border-color:var(--hakka-status-warning)"
                    >
                      redirect
                    </span>
                  </Show>
                  <Show when={!rule.block && rule.redirectTo == null}>
                    <span class="hakka-mocked-tag">mock</span>
                  </Show>
                  <button
                    aria-label={`Remove rule ${rule.id}`}
                    class="hakka-btn-close"
                    style="padding: 0 var(--hakka-space-xxs);flex-shrink:0"
                    onClick={() => handleRemove(rule.id)}
                    title="Remove rule"
                  >
                    <IconClose size={12} />
                  </button>
                </div>

                <div style="display:flex;align-items:center;gap: var(--hakka-space-ml)">
                  <Show when={rule.block}>
                    <span style="font-size:var(--hakka-font-xs);color:var(--hakka-status-error);font-weight:600">
                      aborted
                    </span>
                  </Show>
                  <Show when={!rule.block && rule.redirectTo != null}>
                    <span
                      class="hakka-input-mono"
                      style="font-size:var(--hakka-font-xs);color:var(--hakka-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px"
                      title={rule.redirectTo ?? ''}
                    >
                      → {rule.redirectTo}
                    </span>
                  </Show>
                  <Show when={!rule.block && rule.redirectTo == null}>
                    <span
                      class={`hakka-status ${statusClass(rule.response.status)}`}
                      style="font-size:var(--hakka-font-xs)"
                    >
                      {rule.response.status}
                    </span>
                  </Show>
                  <span class="hakka-hint">
                    {rule.hitCount} {rule.hitCount === 1 ? 'hit' : 'hits'}
                  </span>
                  <div style="flex:1" />
                  <button
                    aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    aria-pressed={rule.enabled ? 'true' : 'false'}
                    class={`hakka-switch${rule.enabled ? ' on' : ''}`}
                    onClick={() => handleToggle(rule)}
                  >
                    <div class="hakka-switch-knob" />
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
