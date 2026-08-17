/**
 * BreakpointsTab — manage request breakpoints and edit paused requests.
 *
 * Breakpoints pause matching fetch / XHR requests on the main thread before
 * they're sent. The interceptor awaits resolution; this panel resolves each
 * pause via resume() (forward, with optional edits) or abort() (fail).
 *
 * No proxy, no certificate — everything runs in-process.
 */

import { breakpointEngine } from 'hakka-core'
import type { Breakpoint, BreakpointPhase, PausedEntry, PausedRequest, PausedResponse } from 'hakka-core'
import type { Component } from 'solid-js'
import { createSignal, For, Show, onSettled } from 'solid-js'

import { IconClose, IconPause } from './icons'
import type { PanelProps } from './panelRegistry'

type MethodOption = 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const METHOD_OPTIONS: MethodOption[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const PHASE_OPTIONS: BreakpointPhase[] = ['request', 'response', 'both']

function methodClass(method: string | undefined): string {
  const m = method ?? 'ANY'
  const known: string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  return known.includes(m) ? `method-${m}` : 'method-OTHER'
}

/** Render a headers map as editable `key: value` lines. */
function headersToText(h: Record<string, string>): string {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

/** Parse `key: value` lines back into a headers map (blank / colon-less lines skipped). */
function textToHeaders(t: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of t.split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const k = line.slice(0, i).trim()
    if (!k) continue
    out[k] = line.slice(i + 1).trim()
  }
  return out
}

// ── PausedCard — isolated edit state per paused entry ─────────────────────────

interface PausedCardProps {
  entry: PausedEntry
  onResume: (id: string, edits: Partial<PausedRequest> | Partial<PausedResponse>) => void
  onAbort: (id: string) => void
}

// ── shared card style fragments (unique to paused-request cards: the warning
//    border isn't part of the shared .hakka-card vocabulary) ─────────────────
// NOTE: the rules-list card padding is var(--hakka-space-ml) (10px, its own
// rung), and the close button's 2px inset is var(--hakka-space-xxs) — both
// on the token scale, not one-off literals.
const cardWrap =
  'border-color:var(--hakka-status-warning);display:flex;flex-direction:column;gap: var(--hakka-space-ml)'

// Resume / Abort buttons — shared by request- and response-phase cards.
const CardActions: Component<{ onResume: () => void; onAbort: () => void }> = (props) => (
  <div style="display:flex;gap:var(--hakka-space-md);justify-content:flex-end">
    <button
      aria-label="Abort paused request"
      class="hakka-btn-primary"
      style="background:var(--hakka-status-error)"
      onClick={() => props.onAbort()}
    >
      Abort
    </button>
    <button
      aria-label="Resume paused request"
      class="hakka-btn-primary"
      style="background:var(--hakka-status-success)"
      onClick={() => props.onResume()}
    >
      Resume
    </button>
  </div>
)

const PausedCard: Component<PausedCardProps> = (props) => {
  const entry = props.entry

  if (entry.phase === 'response') {
    const [editStatus, setEditStatus] = createSignal<string>(String(entry.response.status))
    const [editHeaders, setEditHeaders] = createSignal<string>(headersToText(entry.response.headers))
    const [editBody, setEditBody] = createSignal<string>(entry.response.body)

    const resume = (): void =>
      props.onResume(entry.id, {
        status: Number(editStatus()) || entry.response.status,
        headers: textToHeaders(editHeaders()),
        body: editBody(),
      })

    return (
      <div class="hakka-card" style={cardWrap}>
        <div style="display:flex;align-items:center;gap:var(--hakka-space-md)">
          <span class="hakka-mocked-tag" style="font-size:var(--hakka-font-xs);flex-shrink:0">
            RES
          </span>
          <input
            type="text"
            inputmode="numeric"
            aria-label="Edit paused status"
            value={editStatus()}
            class="hakka-input"
            style="width:100%"
            onInput={(e) => setEditStatus((e.target as HTMLInputElement).value)}
          />
        </div>

        <div>
          <div class="hakka-section-title">Response headers</div>
          <textarea
            aria-label="Edit paused response headers"
            rows={3}
            value={editHeaders()}
            placeholder="(none)"
            class="hakka-input hakka-input-mono"
            style="width:100%;resize:vertical;line-height:1.5"
            onInput={(e) => setEditHeaders((e.target as HTMLTextAreaElement).value)}
          />
        </div>

        <div>
          <div class="hakka-section-title">Response body</div>
          <textarea
            aria-label="Edit paused response body"
            rows={4}
            value={editBody()}
            placeholder="(empty)"
            class="hakka-input hakka-input-mono"
            style="width:100%;resize:vertical;line-height:1.5"
            onInput={(e) => setEditBody((e.target as HTMLTextAreaElement).value)}
          />
        </div>

        <div class="hakka-hint hakka-hint-em" style="font-size:var(--hakka-font-xs)">
          Edits to status, headers, and body are applied to the response the caller receives on Resume.
        </div>

        <CardActions onResume={resume} onAbort={() => props.onAbort(entry.id)} />
      </div>
    )
  }

  const [editUrl, setEditUrl] = createSignal<string>(entry.request.url)
  const [editBody, setEditBody] = createSignal<string>(entry.request.body ?? '')

  const headerEntries = (): Array<[string, string]> => Object.entries(entry.request.headers)

  const resume = (): void => props.onResume(entry.id, { url: editUrl(), body: editBody() || null })

  return (
    <div class="hakka-card" style={cardWrap}>
      <div style="display:flex;align-items:center;gap:var(--hakka-space-md)">
        <span
          class={`hakka-method-badge ${methodClass(entry.request.method)}`}
          style="font-size:var(--hakka-font-xs);min-width:42px;flex-shrink:0"
        >
          {entry.request.method}
        </span>
        <input
          type="text"
          aria-label="Edit paused URL"
          value={editUrl()}
          class="hakka-input"
          style="width:100%"
          onInput={(e) => setEditUrl((e.target as HTMLInputElement).value)}
        />
      </div>

      <Show when={headerEntries().length > 0}>
        <div>
          <div class="hakka-section-title">Headers (read-only)</div>
          <div
            class="hakka-input-mono"
            style="background:var(--hakka-surface-raised);border:1px solid var(--hakka-border);border-radius:var(--hakka-radius-sm);padding:var(--hakka-space-sm) var(--hakka-space-md);max-height:80px;overflow-y:auto;font-size:var(--hakka-font-xs);display:flex;flex-direction:column;gap: var(--hakka-space-xxs)"
          >
            <For each={headerEntries()}>
              {([k, v]) => (
                <div style="display:flex;gap:var(--hakka-space-sm);min-width:0">
                  <span style="color:var(--hakka-text-secondary);flex-shrink:0;white-space:nowrap">{k}:</span>
                  <span
                    style="color:var(--hakka-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                    title={v}
                  >
                    {v}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div>
        <div class="hakka-section-title">Body</div>
        <textarea
          aria-label="Edit paused body"
          rows={3}
          value={editBody()}
          placeholder="(empty)"
          class="hakka-input hakka-input-mono"
          style="width:100%;resize:vertical;line-height:1.5"
          onInput={(e) => setEditBody((e.target as HTMLTextAreaElement).value)}
        />
      </div>

      <div class="hakka-hint hakka-hint-em" style="font-size:var(--hakka-font-xs)">
        Edits to URL and body are applied to the outgoing request on Resume.
      </div>

      <CardActions onResume={resume} onAbort={() => props.onAbort(entry.id)} />
    </div>
  )
}

export const BreakpointsTab: Component<PanelProps> = () => {
  const [rules, setRules] = createSignal<Breakpoint[]>([])
  const [paused, setPaused] = createSignal<PausedEntry[]>([])

  // Add-rule form state
  const [pattern, setPattern] = createSignal<string>('')
  const [method, setMethod] = createSignal<MethodOption>('ANY')
  const [phase, setPhase] = createSignal<BreakpointPhase>('request')

  function refresh(): void {
    // Copy each breakpoint: the engine mutates `enabled` in place, and a
    // same-reference object would never re-render its row (remote toggles
    // via the control channel would freeze the switch).
    // oxlint-disable-next-line no-map-spread -- fresh identity is the point
    setRules(breakpointEngine.getBreakpoints().map((b) => ({ ...b })))
    setPaused(breakpointEngine.getPaused())
  }

  onSettled(() => {
    const off = breakpointEngine.subscribe(refresh)
    // onSettled runs later than 1.x onMount — resync in case a breakpoint
    // fired between first render and settle.
    refresh()
    return off
  })

  function handleAdd(): void {
    const p = pattern().trim()
    if (!p) return
    const m = method()
    breakpointEngine.addBreakpoint({
      pattern: p,
      method: m === 'ANY' ? undefined : m,
      on: phase(),
      enabled: true,
    })
    refresh()
    setPattern('')
    setMethod('ANY')
    setPhase('request')
  }

  function handleToggle(rule: Breakpoint): void {
    breakpointEngine.setEnabled(rule.id, !rule.enabled)
    refresh()
  }

  function handleRemove(id: string): void {
    breakpointEngine.removeBreakpoint(id)
    refresh()
  }

  function handleClearAll(): void {
    breakpointEngine.clearBreakpoints()
    refresh()
  }

  function handleResume(pauseId: string, edits: Partial<PausedRequest> | Partial<PausedResponse>): void {
    breakpointEngine.resume(pauseId, edits)
    refresh()
  }

  function handleAbort(pauseId: string): void {
    breakpointEngine.abort(pauseId)
    refresh()
  }

  const addEnabled = (): boolean => pattern().trim().length > 0

  return (
    <div class="hakka-pane">
      <Show when={paused().length > 0}>
        {/* 20px doesn't sit on a space rung (nearest is xl=16) — kept exact, this
            section needs more separation from Breakpoints below than xl gives. */}
        <div style="margin-bottom: var(--hakka-space-xxl)">
          <div style="font-size:var(--hakka-font-md);font-weight:600;color:var(--hakka-status-warning);margin-bottom:var(--hakka-space-xs);display:flex;align-items:center;gap:var(--hakka-space-sm)">
            <IconPause size={12} />
            <span>Paused ({paused().length})</span>
          </div>
          <div class="hakka-hint" style="margin-bottom: var(--hakka-space-ml)">
            Requests are held until you Resume or Abort. Edit URL or body before resuming.
          </div>
          <div style="display:flex;flex-direction:column;gap: var(--hakka-space-ml)">
            <For each={paused()}>
              {(entry) => <PausedCard entry={entry} onResume={handleResume} onAbort={handleAbort} />}
            </For>
          </div>
        </div>
      </Show>

      {/* No tab-level title/desc — the tab strip is the title (DESIGN.md
          "Panel section anatomy"); explanation lives in the empty state below. */}

      <div
        class="hakka-card"
        style="display:flex;flex-direction:column;gap: var(--hakka-space-ml);margin-bottom:var(--hakka-space-xl)"
      >
        <div class="hakka-section-title flush">Add Breakpoint</div>

        <div>
          <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
            URL pattern (substring)
          </div>
          <input
            type="text"
            aria-label="Breakpoint URL pattern"
            placeholder="/api/checkout"
            value={pattern()}
            class="hakka-input"
            style="width:100%"
            onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
        </div>

        <div>
          <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
            Method
          </div>
          <div class="hakka-form-row">
            <For each={METHOD_OPTIONS}>
              {(m) => (
                <button
                  aria-label={`Select method ${m}`}
                  aria-pressed={method() === m ? 'true' : 'false'}
                  class={`hakka-chip${method() === m ? ' active' : ''}${m !== 'ANY' ? ` method-${m}` : ''}`}
                  onClick={() => setMethod(m)}
                >
                  {m}
                </button>
              )}
            </For>
          </div>
        </div>

        <div>
          <div class="hakka-hint" style="margin-bottom:var(--hakka-space-xs)">
            Pause on
          </div>
          <div class="hakka-form-row">
            <For each={PHASE_OPTIONS}>
              {(p) => (
                <button
                  aria-label={`Select phase ${p}`}
                  aria-pressed={phase() === p ? 'true' : 'false'}
                  class={`hakka-chip${phase() === p ? ' active' : ''}`}
                  onClick={() => setPhase(p)}
                >
                  {p}
                </button>
              )}
            </For>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button aria-label="Add breakpoint" disabled={!addEnabled()} class="hakka-btn-primary" onClick={handleAdd}>
            Add
          </button>
        </div>
      </div>

      {/* Rules list — section title + canonical count badge, DESIGN.md
          "Panel section anatomy" */}
      <Show when={rules().length > 0}>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--hakka-space-md);gap:var(--hakka-space-sm)">
          <div style="display:flex;align-items:center;gap:var(--hakka-space-xs)">
            <div class="hakka-section-title flush">Active breakpoints</div>
            <span class="hakka-count-badge outline">{rules().length}</span>
          </div>
          <button class="hakka-btn" style="font-size:var(--hakka-font-xs)" onClick={handleClearAll}>
            Clear all
          </button>
        </div>
      </Show>

      <Show
        when={rules().length > 0}
        fallback={
          <div>
            <p class="hakka-empty-title">No breakpoints. Add one above to pause matching requests.</p>
            <p class="hakka-empty-hint" style="margin-top:var(--hakka-space-sm)">
              Breakpoints pause fetch / XHR calls before they reach the network. You can then inspect the request, edit
              the URL or body, and either Resume (forwarding your edits) or Abort (failing the request). Everything runs
              in-process — no proxy or certificate needed.
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
                    title={rule.pattern}
                  >
                    {rule.pattern}
                  </span>
                  <span class="hakka-mocked-tag">bp</span>
                  <button
                    aria-label={`Remove breakpoint ${rule.id}`}
                    class="hakka-btn-close"
                    style="padding: 0 var(--hakka-space-xxs);flex-shrink:0"
                    onClick={() => handleRemove(rule.id)}
                    title="Remove breakpoint"
                  >
                    <IconClose size={12} />
                  </button>
                </div>

                <div style="display:flex;align-items:center;gap: var(--hakka-space-ml)">
                  <span class="hakka-hint">pauses on {rule.on}</span>
                  <div style="flex:1" />
                  <button
                    aria-label={rule.enabled ? 'Disable breakpoint' : 'Enable breakpoint'}
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
