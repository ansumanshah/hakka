/**
 * HakkaBridge — streams NetworkRequest events to a desktop companion
 * via WebSocket with exponential backoff auto-reconnect.
 *
 * Compatible with the Hakka desktop app (Tauri) and any WebSocket server
 * that accepts the Hakka wire protocol.
 *
 * Includes bidirectional command handling (storage:set, storage:delete,
 * mmkv:set, mmkv:delete) and console interceptor forwarding.
 */
import { applyControlCommand, ConsoleInterceptor, Hakka, logStore, parseControlCommand } from 'hakka-core'
import type { ConnectionStatus, LogEntry, NetworkRequest, StorageSnapshot } from 'hakka-core'

import { redactStorageEntries } from '../storage/redact'

// Storage write allowlist — prefix-based: desktop can only write keys starting with 'hakka:'
const ALLOWED_KEY_PREFIX = 'hakka:'
const MAX_VALUE_BYTES = 64 * 1024

function isAllowedKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(ALLOWED_KEY_PREFIX)
}

function isAllowedValue(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_VALUE_BYTES
}

declare const __DEV__: boolean

const MIN_DELAY = 1000
const MAX_DELAY = 30000
type HakkaMessageEvent = { data?: unknown }

export type { ConnectionStatus }

/** Current WebSocket connection, or null if not connected. Used by the health reporter and other modules. */
export function getDesktopSocket(): { emit: (event: string, data: unknown) => void } | null {
  if (!hakkaBridge.isConnected) return null
  return {
    emit: (event: string, data: unknown) => {
      hakkaBridge.emit(event, data)
    },
  }
}

export class HakkaBridge {
  private ws: WebSocket | null = null
  private _url = ''
  private reconnectDelay = MIN_DELAY
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = false
  private unsubscribe: (() => void) | null = null
  private consoleUnsub: (() => void) | null = null
  private logUnsub: (() => void) | null = null
  private statusListeners = new Set<(status: ConnectionStatus) => void>()
  private _status: ConnectionStatus = { state: 'disconnected' }

  /** Connect to the desktop app WebSocket server; auto-reconnects with exponential backoff on disconnect. */
  connect(url: string): void {
    if (this._url !== url && this.ws) {
      this._teardown(false)
    }
    this._url = url
    this.shouldReconnect = true
    this.reconnectDelay = MIN_DELAY
    this._connect()
  }

  /** Disconnect and stop reconnecting. */
  disconnect(): void {
    this.shouldReconnect = false
    this._teardown(true)
  }

  /** Subscribe to connection status changes. Returns unsubscribe fn. */
  onStatus(cb: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb)
    cb(this._status)
    return () => this.statusListeners.delete(cb)
  }

  getStatus(): ConnectionStatus {
    return this._status
  }

  get isConnected(): boolean {
    return this._status.state === 'connected'
  }

  /**
   * Emit a canonical `{ type, payload }` frame over the bridge. The sanctioned
   * surface for monitors and plugins — the frame shape is enforced here, so
   * arbitrary raw sends are impossible through the public API.
   */
  emit(type: string, payload: unknown): void {
    this._send({ type, payload })
  }

  /**
   * Send one or more structured log entries as a canonical `{type:'console', payload}`
   * frame — matches `BridgeConsoleMessage` in `packages/hakka-bridge/src/protocol.ts`.
   * `payload` is always an array on the wire, even for a single entry. Fire-and-forget
   * like `sendStorage` below — no offline queue, dropped silently while disconnected
   * (same "live stream, no offline queue" contract as `hakka-node`'s `sendConsole`).
   */
  sendConsole(entries: LogEntry[]): void {
    if (entries.length === 0) return
    this._send({ type: 'console', payload: entries })
  }

  /**
   * Send a named storage snapshot as a canonical `{type:'storage', payload}` frame —
   * matches `BridgeStorageMessage`. Snapshot-replace semantics: a later frame for the
   * same `store` fully replaces this one on the receiving end, never a diff — see
   * `StorageSnapshot`'s doc comment in `hakka-core`. Fire-and-forget like `sendConsole`:
   * a snapshot missed while disconnected is superseded by the next one anyway.
   */
  sendStorage(snapshot: StorageSnapshot): void {
    this._send({ type: 'storage', payload: snapshot })
  }

  /**
   * Publishes one storage snapshot per installed backend (AsyncStorage / MMKV) right
   * after connecting, so a freshly-opened desktop peer isn't left with no Storage panel
   * data until the app's Storage tab happens to be opened and refreshed. Optional deps
   * are resolved inline (matching `_handleMessage`'s `storage:set`/`mmkv:set` handling
   * below) so this module never hard-depends on either package. Best-effort: any
   * failure (module absent, read error) is swallowed — this must never throw from
   * inside a socket event handler.
   */
  private _publishStorageSnapshotsOnConnect(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AS = require('@react-native-async-storage/async-storage')
      const storage = (AS.default ?? AS) as {
        getAllKeys: () => Promise<readonly string[]>
        multiGet: (keys: readonly string[]) => Promise<Array<readonly [string, string | null]>>
      }
      storage
        .getAllKeys()
        .then((keys) => storage.multiGet(keys))
        .then((pairs) => {
          const entries: Record<string, string> = {}
          for (const [key, value] of pairs) entries[key] = value ?? ''
          this.sendStorage({ store: 'asyncStorage', timestamp: Date.now(), entries: redactStorageEntries(entries) })
        })
        .catch(() => {
          // Best-effort — never throw from a connect handler.
        })
    } catch {
      // AsyncStorage not installed
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mmkvMod = require('react-native-mmkv')
      const mmkvLib = mmkvMod.default ?? mmkvMod
      if (mmkvLib.MMKV) {
        const storage = new mmkvLib.MMKV() as {
          getAllKeys: () => string[]
          getString: (key: string) => string | undefined
        }
        const entries: Record<string, string> = {}
        for (const key of storage.getAllKeys()) entries[key] = storage.getString(key) ?? ''
        this.sendStorage({ store: 'mmkv', timestamp: Date.now(), entries: redactStorageEntries(entries) })
      }
    } catch {
      // MMKV not installed
    }
  }

  private _connect(): void {
    if (this.ws) {
      return
    }

    this._setStatus({ state: 'connecting', url: this._url })

    if (!this.consoleUnsub) {
      ConsoleInterceptor.enable()
      this.consoleUnsub = ConsoleInterceptor.onEntry((entry) => {
        this._send({ type: 'console:log', payload: entry })
      })
    }

    // Structured log entries (the Logs tab's "Structured" segment — same `logStore`/
    // `LogEntry` model iOS's `HakkaInterceptor.log()` streams from) forward as canonical
    // `{type:'console', payload: LogEntry[]}` frames, one entry per call — matches iOS's
    // per-`log()`-call `sendConsole([entry])`. Distinct from `consoleUnsub` above, which
    // forwards raw `console.*` capture under the legacy `console:log` type.
    if (!this.logUnsub) {
      this.logUnsub = logStore.subscribe((entry) => {
        this.sendConsole([entry])
      })
    }

    try {
      const ws = new WebSocket(this._url)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectDelay = MIN_DELAY
        this._setStatus({ state: 'connected', url: this._url, since: Date.now() })

        // Flush the existing backlog as individual request frames. The bridge hub + MCP
        // accept only `{ type: 'request', payload }` (see packages/hakka-bridge protocol) — there
        // is no 'batch' frame, so a batch send is silently dropped.
        for (const log of Hakka.getLogs()) {
          this._send({ type: 'request', payload: log })
        }

        this.unsubscribe = Hakka.onRequest((request: NetworkRequest) => {
          this._send({ type: 'request', payload: request })
        })

        // A freshly-connected desktop peer has no storage snapshot yet — publish one
        // immediately for every installed backend, in addition to the Storage tab's
        // own publish-on-refresh (`StorageViewer.tsx`). Optional deps, resolved inline
        // (matching `_handleMessage`'s existing `storage:set`/`mmkv:set` pattern) so
        // this module never hard-depends on either package.
        this._publishStorageSnapshotsOnConnect()
      }

      ws.onmessage = (event: HakkaMessageEvent) => {
        this._handleMessage(event)
      }

      ws.onclose = () => {
        this.ws = null
        this.unsubscribe?.()
        this.unsubscribe = null

        if (this.shouldReconnect) {
          this._setStatus({ state: 'error', url: this._url, error: 'Connection closed' })
          this._scheduleReconnect()
        } else {
          this._setStatus({ state: 'disconnected' })
        }
      }

      ws.onerror = () => {
        // onclose fires after onerror, so just log here
        if (this.shouldReconnect) {
          this._setStatus({ state: 'error', url: this._url, error: 'WebSocket error' })
        }
      }
    } catch (err) {
      this.ws = null
      if (this.shouldReconnect) {
        this._setStatus({
          state: 'error',
          url: this._url,
          error: err instanceof Error ? err.message : 'Failed to connect',
        })
        this._scheduleReconnect()
      }
    }
  }

  /** Handle bidirectional commands from the desktop app. */
  private _handleMessage(event: HakkaMessageEvent): void {
    try {
      const raw = event.data
      const msg =
        typeof raw === 'string'
          ? (JSON.parse(raw) as { type: string; payload?: unknown })
          : (raw as { type: string; payload?: unknown })
      if (!msg || typeof msg.type !== 'string') return
      const payload = msg.payload as Record<string, unknown> | undefined
      if (!payload) return

      if (msg.type === 'control') {
        // Remote control command (e.g. hakka mcp create_mock relayed by the
        // bridge hub). parseControlCommand validates strictly and never throws;
        // applyControlCommand is fail-open against the engine singletons.
        const cmd = parseControlCommand(payload)
        if (cmd) applyControlCommand(cmd)
        return
      }

      if (msg.type === 'storage:set') {
        if (!isAllowedKey(payload.key) || !isAllowedValue(payload.value)) return
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const AS = require('@react-native-async-storage/async-storage')
          const storage = (AS.default ?? AS) as { setItem: (k: string, v: string) => Promise<void> }
          storage.setItem(payload.key, payload.value).catch(() => {
            if (typeof __DEV__ !== 'undefined' && __DEV__)
              console.warn('[Hakka Bridge] storage:set failed for key:', payload.key)
          })
        } catch {
          // AsyncStorage not installed
        }
      } else if (msg.type === 'storage:delete') {
        if (!isAllowedKey(payload.key)) return
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const AS = require('@react-native-async-storage/async-storage')
          const storage = (AS.default ?? AS) as { removeItem: (k: string) => Promise<void> }
          storage.removeItem(payload.key).catch(() => {
            if (typeof __DEV__ !== 'undefined' && __DEV__)
              console.warn('[Hakka Bridge] storage:delete failed for key:', payload.key)
          })
        } catch {
          // AsyncStorage not installed
        }
      } else if (msg.type === 'mmkv:set') {
        if (!isAllowedKey(payload.key) || !isAllowedValue(payload.value)) return
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mmkvMod = require('react-native-mmkv')
          const mmkvLib = mmkvMod.default ?? mmkvMod
          if (mmkvLib.MMKV) {
            const storage = new mmkvLib.MMKV()
            storage.set(payload.key, payload.value)
          }
        } catch {
          // MMKV not installed
        }
      } else if (msg.type === 'mmkv:delete') {
        if (!isAllowedKey(payload.key)) return
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mmkvMod = require('react-native-mmkv')
          const mmkvLib = mmkvMod.default ?? mmkvMod
          if (mmkvLib.MMKV) {
            const storage = new mmkvLib.MMKV()
            storage.delete(payload.key)
          }
        } catch {
          // MMKV not installed
        }
      }
    } catch {
      // Ignore non-JSON messages
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect) {
        this._connect()
      }
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_DELAY)
  }

  private _teardown(updateStatus: boolean): void {
    this.shouldReconnect = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.unsubscribe?.()
    this.unsubscribe = null

    this.consoleUnsub?.()
    this.consoleUnsub = null

    this.logUnsub?.()
    this.logUnsub = null

    if (this.ws) {
      this.ws.onclose = null // prevent _scheduleReconnect on manual close
      this.ws.close()
      this.ws = null
    }

    if (updateStatus) {
      this._setStatus({ state: 'disconnected' })
    }
  }

  private _send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload))
      } catch {
        // Ignore send errors — socket will fire onerror/onclose
      }
    }
  }

  private _setStatus(status: ConnectionStatus): void {
    this._status = status
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }
}

/** Singleton bridge instance. Connect once at app start. */
export const hakkaBridge = new HakkaBridge()
