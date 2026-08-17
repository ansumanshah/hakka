/**
 * SettingsTab — inspector settings panel. Settings persist via `persist.ts` (key `hakka:ui`).
 */

import { isStackCaptureEnabled, setStackCapture, configureBodyRedaction, DEFAULT_CONFIG } from 'hakka-core'
import type { ConnectionStatus } from 'hakka-core'
import type { Component } from 'solid-js'
import { createSignal, onSettled, Show, For } from 'solid-js'

import { getSystemInfo } from '../adapters/deviceInfo'
import { disableConsoleMirror, enableConsoleMirror, isConsoleMirrorEnabled } from '../consoleMirror'
import { connect, disconnect, getBridgeStatus, onBridgeStatus, DEFAULT_DESKTOP_URL } from '../desktopBridge'
import { store } from '../worker'
import { IconChevronDown } from './icons'
import { loadUiState, saveUiState } from './persist'
import { PRESET_NAMES, PRESET_LABELS, normalizePreset, setPreset, setPanelOpacity, MIN_PANEL_OPACITY } from './presets'
import type { PresetName } from './presets'

// seconds; 0 = keep forever, bounded only by maxRecords
const RETENTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Forever' },
  { value: 3600, label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '1 week' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function statusLabel(s: ConnectionStatus): string {
  switch (s.state) {
    case 'connected':
      return `Connected to ${s.url}`
    case 'connecting':
      return `Connecting to ${s.url}…`
    case 'error':
      return `Error: ${s.error}`
    default:
      return 'Disconnected'
  }
}

function statusColor(s: ConnectionStatus): string {
  switch (s.state) {
    case 'connected':
      return 'var(--hakka-status-success)'
    case 'connecting':
      return 'var(--hakka-status-warning)'
    case 'error':
      return 'var(--hakka-status-error)'
    default:
      return 'var(--hakka-text-tertiary)'
  }
}

export const SettingsTab: Component = () => {
  const saved = loadUiState()

  const [logToConsole, setLogToConsoleRaw] = createSignal(saved.logToConsole)
  const [captureStack, setCaptureStackRaw] = createSignal(saved.captureStack)
  const [desktopConnect, setDesktopConnectRaw] = createSignal(saved.desktopConnect)
  const [desktopUrl, setDesktopUrlRaw] = createSignal(saved.desktopUrl || DEFAULT_DESKTOP_URL)
  const [maxRecords, setMaxRecordsRaw] = createSignal(saved.maxRecords || 500)
  const [maxAge, setMaxAgeRaw] = createSignal(saved.maxAge || 0)
  const [redactBody, setRedactBody] = createSignal((saved.redactBodyFields || []).join(', '))
  const [storeSize, setStoreSize] = createSignal<{ count: number; bytes: number } | null>(null)
  const [bridgeStatus, setBridgeStatus] = createSignal<ConnectionStatus>(getBridgeStatus())
  const [preset, setPresetRaw] = createSignal<PresetName>(normalizePreset(saved.preset))
  const [panelOpacity, setPanelOpacityRaw] = createSignal(saved.panelOpacity)

  onSettled(() => {
    // Hydrate toggles from actual runtime state (might have been set before UI loaded).
    setLogToConsoleRaw(isConsoleMirrorEnabled())
    setCaptureStackRaw(isStackCaptureEnabled())

    const unsub = onBridgeStatus((s) => setBridgeStatus(s))
    // onSettled runs later than onMount — resync in case status changed before settle.
    setBridgeStatus(getBridgeStatus())

    if (saved.desktopConnect) {
      connect(saved.desktopUrl || DEFAULT_DESKTOP_URL)
    }

    void refreshStoreSize()

    return unsub
  })

  function onPresetChange(v: string): void {
    const normalized = normalizePreset(v)
    setPresetRaw(normalized)
    setPreset(normalized) // ui/presets.ts — persists + applies to every mounted Inspector
  }

  function onPanelOpacityChange(v: number): void {
    const clamped = Math.min(1, Math.max(MIN_PANEL_OPACITY, v))
    setPanelOpacityRaw(clamped)
    setPanelOpacity(clamped)
  }

  function setMaxAge(seconds: number): void {
    setMaxAgeRaw(seconds)
    saveUiState({ maxAge: seconds })
    store().configure({ maxAge: seconds })
  }

  function applyRedactBody(): void {
    const fields = redactBody()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setRedactBody(fields.join(', '))
    saveUiState({ redactBodyFields: fields })
    configureBodyRedaction(fields)
  }

  async function refreshStoreSize(): Promise<void> {
    try {
      const snap = await store().getSnapshot()
      let bytes = 0
      for (const r of snap) bytes += (r.requestBodySize ?? 0) + (r.responseBodySize ?? 0)
      setStoreSize({ count: snap.length, bytes })
    } catch {
      setStoreSize(null)
    }
  }

  function setLogToConsole(v: boolean): void {
    setLogToConsoleRaw(v)
    saveUiState({ logToConsole: v })
    if (v) enableConsoleMirror()
    else disableConsoleMirror()
  }

  function setCaptureStack(v: boolean): void {
    setCaptureStackRaw(v)
    saveUiState({ captureStack: v })
    setStackCapture(v)
  }

  function setDesktopConnect(v: boolean): void {
    setDesktopConnectRaw(v)
    saveUiState({ desktopConnect: v })
    if (v) connect(desktopUrl())
    else disconnect()
  }

  function setDesktopUrl(v: string): void {
    setDesktopUrlRaw(v)
    saveUiState({ desktopUrl: v })
  }

  function applyUrl(): void {
    if (desktopConnect()) {
      disconnect()
      connect(desktopUrl())
    }
  }

  function setMaxRecords(v: number): void {
    const clamped = Math.max(10, Math.min(5000, v))
    setMaxRecordsRaw(clamped)
    saveUiState({ maxRecords: clamped })
    // The live ring buffer is the worker store's HakkaImpl, not the main-thread singleton —
    // configure it through the store client (same path as setMaxAge), or this is a no-op.
    store().configure({ maxRequests: clamped })
  }

  // 10px row padding predates the --hakka-space scale (between md=8/lg=12) —
  // kept exact rather than nudging every settings row's rhythm to fit a rung.
  const row =
    'display:flex;align-items:center;justify-content:space-between;padding: var(--hakka-space-ml) 0;border-bottom:1px solid var(--hakka-border)'
  const label = 'font-size:var(--hakka-font-sm);color:var(--hakka-text-secondary);font-weight:600'
  // 2px hugs the label tighter than --hakka-space-xs (4) would — deliberate.
  const hint = 'font-size:var(--hakka-font-xs);color:var(--hakka-text-tertiary);margin-top: var(--hakka-space-xxs)'

  return (
    <div class="hakka-pane">
      {/* No tab-level title — tab strip is the title (DESIGN.md); each row's own label+hint stands alone. */}

      <div style={row}>
        <div>
          <div style={label}>Theme preset</div>
          <div style={hint}>Curated color palette for the inspector panel</div>
        </div>
        <span class="hakka-select-wrap">
          <select
            class="hakka-select"
            aria-label="Theme preset"
            value={preset()}
            onChange={(e) => onPresetChange((e.target as HTMLSelectElement).value)}
          >
            <For each={PRESET_NAMES}>{(p) => <option value={p}>{PRESET_LABELS[p]}</option>}</For>
          </select>
          <span class="hakka-select-caret" aria-hidden="true">
            <IconChevronDown size={11} />
          </span>
        </span>
      </div>

      <div style={row}>
        <div>
          <div style={label}>Panel opacity</div>
          <div style={hint}>{Math.round(panelOpacity() * 100)}% — see through to the page underneath</div>
        </div>
        <input
          type="range"
          class="hakka-range"
          aria-label="Panel opacity"
          min={MIN_PANEL_OPACITY}
          max={1}
          step={0.05}
          style="width:120px"
          value={panelOpacity()}
          onInput={(e) => onPanelOpacityChange(Number((e.target as HTMLInputElement).value))}
        />
      </div>

      <div style={row}>
        <div>
          <div style={label}>Log to console</div>
          <div style={hint}>Mirror captures to DevTools console (console.table)</div>
        </div>
        <button
          aria-label="Toggle log to console"
          aria-pressed={logToConsole() ? 'true' : 'false'}
          class={`hakka-switch${logToConsole() ? ' on' : ''}`}
          onClick={() => setLogToConsole(!logToConsole())}
        >
          <div class="hakka-switch-knob" />
        </button>
      </div>

      <div style={row}>
        <div>
          <div style={label}>Capture call stack</div>
          <div style={hint}>Record which code made each request (Initiator). Slight overhead.</div>
        </div>
        <button
          aria-label="Toggle call stack capture"
          aria-pressed={captureStack() ? 'true' : 'false'}
          class={`hakka-switch${captureStack() ? ' on' : ''}`}
          onClick={() => setCaptureStack(!captureStack())}
        >
          <div class="hakka-switch-knob" />
        </button>
      </div>

      <div style="padding: var(--hakka-space-ml) 0;border-bottom:1px solid var(--hakka-border)">
        <div style={row + ';border-bottom:none;padding-bottom:var(--hakka-space-sm)'}>
          <div>
            <div style={label}>Connect to desktop</div>
            <div style={hint}>Stream captures to the Hakka desktop app</div>
          </div>
          <button
            aria-label="Toggle desktop connection"
            aria-pressed={desktopConnect() ? 'true' : 'false'}
            class={`hakka-switch${desktopConnect() ? ' on' : ''}`}
            onClick={() => setDesktopConnect(!desktopConnect())}
          >
            <div class="hakka-switch-knob" />
          </button>
        </div>

        <div
          style={`font-size:var(--hakka-font-xs);color:${statusColor(bridgeStatus())};margin-bottom:var(--hakka-space-sm)`}
        >
          {statusLabel(bridgeStatus())}
        </div>

        <div class="hakka-form-row" style="flex-wrap:nowrap">
          <input
            type="text"
            aria-label="Desktop WebSocket URL"
            class="hakka-input hakka-input-mono"
            value={desktopUrl()}
            placeholder={DEFAULT_DESKTOP_URL}
            style="flex:1"
            onInput={(e) => setDesktopUrl((e.target as HTMLInputElement).value)}
            onBlur={applyUrl}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyUrl()
            }}
          />
          <button class="hakka-btn-primary" onClick={applyUrl}>
            Apply
          </button>
        </div>
      </div>

      <div style={row}>
        <div>
          <div style={label}>Max records</div>
          <div style={hint}>Ring buffer capacity (10–5000)</div>
        </div>
        <input
          type="number"
          aria-label="Max records"
          min={10}
          max={5000}
          value={maxRecords()}
          class="hakka-input"
          style="width:72px;text-align:right"
          onChange={(e) => setMaxRecords(Number((e.target as HTMLInputElement).value))}
        />
      </div>

      <div style={row}>
        <div>
          <div style={label}>Retention</div>
          <div style={hint}>Drop captures older than this age</div>
        </div>
        <span class="hakka-select-wrap">
          <select
            class="hakka-select"
            aria-label="Retention age"
            value={maxAge()}
            onChange={(e) => setMaxAge(Number((e.target as HTMLSelectElement).value))}
          >
            <For each={RETENTION_OPTIONS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
          </select>
          <span class="hakka-select-caret" aria-hidden="true">
            <IconChevronDown size={11} />
          </span>
        </span>
      </div>

      <div style={row}>
        <div>
          <div style={label}>Store size</div>
          <div style={hint}>
            <Show when={storeSize()} fallback="—">
              {storeSize()!.count} requests · {formatBytes(storeSize()!.bytes)} of bodies
            </Show>
          </div>
        </div>
        <button class="hakka-btn" onClick={() => void refreshStoreSize()}>
          Refresh
        </button>
      </div>

      <div style="padding: var(--hakka-space-ml) 0;border-bottom:none">
        <div style={label}>Redact body fields</div>
        <div style={hint}>
          Mask these keys in captured JSON bodies (comma-separated, case-insensitive). Headers redacted at capture:{' '}
          {(DEFAULT_CONFIG.redactHeaders ?? []).join(', ')}
        </div>
        <div class="hakka-form-row" style="flex-wrap:nowrap;margin-top:var(--hakka-space-sm)">
          <input
            type="text"
            aria-label="Redact body fields"
            class="hakka-input hakka-input-mono"
            value={redactBody()}
            placeholder="password, token, ssn"
            style="flex:1"
            onInput={(e) => setRedactBody((e.target as HTMLInputElement).value)}
            onBlur={applyRedactBody}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyRedactBody()
            }}
          />
          <button class="hakka-btn-primary" onClick={applyRedactBody}>
            Apply
          </button>
        </div>
      </div>

      {/* Environment — merged Info panel: read-only system facts for bug reports. */}
      <div style="padding: var(--hakka-space-ml) 0">
        <div style={label}>Environment</div>
        <table class="hakka-kv-table" style="margin-top:var(--hakka-space-md)">
          <tbody>
            <For each={getSystemInfo()}>
              {(r) => (
                <tr>
                  <td class="hakka-kv-key">{r.label}</td>
                  <td class="hakka-kv-value hakka-input-mono" style="word-break:break-all">
                    {r.value}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  )
}
