/**
 * SettingsViewModel — state behind `SettingsPanel.tsx`, `{ getSnapshot, subscribe, intents }`
 * contract (`contract.ts`). RN-original: `hakka-browser`'s Settings tab has a different shape
 * (no desktop-bridge toggle, no session import/export), so there's no web twin to match.
 * `Alert.alert`/`Share.share` and session export stay in `SettingsPanel.tsx` — RN side effects,
 * not state this view-model owns.
 */
import { configureBodyRedaction, deserializeSession, Hakka } from 'hakka-core'
import type { ConnectionStatus } from 'hakka-core'
import { Dimensions, Platform, PixelRatio } from 'react-native'

import { hakkaBridge } from '../../core/HakkaBridge'
import { getDefaultDeviceInfo } from '../../monitors/deviceInfo'
import type { ViewModel } from './contract'
import { createEmitter } from './emitter'

export const DEFAULT_DESKTOP_URL = 'ws://localhost:8989'
const SETTINGS_STORAGE_KEY = 'hakka:rn:settings'

export const RETENTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Forever' },
  { value: 3600, label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '1 week' },
]

interface PersistableSettings {
  maxRecords: number
  maxAge: number
  redactBodyFields: string[]
  desktopConnect: boolean
  desktopUrl: string
}

export interface InfoRow {
  label: string
  value: string
}

export interface InfoSection {
  title: string
  rows: InfoRow[]
}

function getViewportValue(): string {
  try {
    const window = Dimensions.get('window')
    const scale = typeof PixelRatio?.get === 'function' ? PixelRatio.get() : 1
    return `${Math.round(window.width)}×${Math.round(window.height)} @${scale}x`
  } catch {
    return '—'
  }
}

function getDeviceSections(): InfoSection[] {
  const device = getDefaultDeviceInfo()

  const deviceSection: InfoSection = {
    title: 'DEVICE',
    rows: [
      { label: 'Platform', value: device.platform },
      { label: 'OS Version', value: String(Platform.Version ?? '—') },
      { label: 'Device ID', value: device.deviceId },
      { label: 'Viewport', value: getViewportValue() },
      { label: 'Network', value: NetInfoModule ? 'Checking…' : 'Unknown' },
    ],
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformAnyLocal = Platform as any
  const platformConst = platformAnyLocal.constants ?? {}

  if (Platform.OS === 'ios') {
    if (platformConst.Model) deviceSection.rows.push({ label: 'Model', value: String(platformConst.Model) })
    if (platformConst.osVersion)
      deviceSection.rows.push({ label: 'iOS Version', value: String(platformConst.osVersion) })
    if (platformConst.systemName) deviceSection.rows.push({ label: 'System', value: String(platformConst.systemName) })
  } else if (Platform.OS === 'android') {
    if (platformConst.Brand) deviceSection.rows.push({ label: 'Brand', value: String(platformConst.Brand) })
    if (platformConst.Model) deviceSection.rows.push({ label: 'Model', value: String(platformConst.Model) })
    if (platformConst.Release)
      deviceSection.rows.push({ label: 'Android Release', value: String(platformConst.Release) })
    if (platformConst.SDK_INT) deviceSection.rows.push({ label: 'SDK Level', value: String(platformConst.SDK_INT) })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformAny = Platform as any
  const rnVer = platformAny.constants?.reactNativeVersion
  const runtimeSection: InfoSection = {
    title: 'RUNTIME',
    rows: [
      {
        label: 'JS Engine',
        value:
          typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== 'undefined' ? 'Hermes' : 'JSC / Other',
      },
      { label: 'Environment', value: typeof __DEV__ !== 'undefined' && __DEV__ ? 'Development' : 'Production' },
      { label: 'RN Version', value: rnVer ? `${rnVer.major}.${rnVer.minor}.${rnVer.patch}` : '—' },
    ],
  }

  const appSection = getAppSection()

  return appSection ? [deviceSection, runtimeSection, appSection] : [deviceSection, runtimeSection]
}

// react-native-device-info is optional — not a hard dependency, not in package.json.
// If the host app hasn't installed it, the APP section is simply omitted.

interface DeviceInfoShape {
  getVersion: () => string
  getBuildNumber: () => string
  getApplicationName?: () => string
}

let DeviceInfoModule: DeviceInfoShape | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DI = require('react-native-device-info')
  DeviceInfoModule = (DI.default ?? DI) as DeviceInfoShape
} catch {
  DeviceInfoModule = null
}

function getAppSection(): InfoSection | null {
  if (!DeviceInfoModule) return null
  try {
    const rows: InfoRow[] = []
    if (typeof DeviceInfoModule.getApplicationName === 'function') {
      const name = DeviceInfoModule.getApplicationName()
      if (name) rows.push({ label: 'Name', value: name })
    }
    const version = typeof DeviceInfoModule.getVersion === 'function' ? DeviceInfoModule.getVersion() : undefined
    const build = typeof DeviceInfoModule.getBuildNumber === 'function' ? DeviceInfoModule.getBuildNumber() : undefined
    if (version || build) {
      rows.push({ label: 'Version', value: version && build ? `${version} (${build})` : String(version ?? build) })
    }
    if (rows.length === 0) return null
    return { title: 'APP', rows }
  } catch {
    return null
  }
}

// @react-native-community/netinfo is optional. One-shot fetch on mount + on
// Refresh — no long-lived subscription needed for a settings row.

interface NetInfoState {
  type?: string
  isConnected?: boolean | null
}

interface NetInfoShape {
  fetch: () => Promise<NetInfoState>
}

let NetInfoModule: NetInfoShape | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const NI = require('@react-native-community/netinfo')
  NetInfoModule = (NI.default ?? NI) as NetInfoShape
} catch {
  NetInfoModule = null
}

function formatNetworkStatus(state: NetInfoState): string {
  const typeLabel = state.type ? state.type.charAt(0).toUpperCase() + state.type.slice(1) : 'Unknown'
  const connected = state.isConnected == null ? 'unknown' : state.isConnected ? 'connected' : 'disconnected'
  return `${typeLabel} · ${connected}`
}

async function getNetworkStatus(): Promise<string> {
  if (!NetInfoModule) return 'Unknown'
  try {
    const state = await NetInfoModule.fetch()
    return formatNetworkStatus(state)
  } catch {
    return 'Unknown'
  }
}

let AsyncStorageModule: {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
} | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AS = require('@react-native-async-storage/async-storage')
  AsyncStorageModule = AS.default ?? AS
} catch {
  AsyncStorageModule = null
}

const defaultSettings: PersistableSettings = {
  maxRecords: 500,
  maxAge: 0,
  redactBodyFields: [],
  desktopConnect: false,
  desktopUrl: DEFAULT_DESKTOP_URL,
}

// In-memory cache so settings survive re-renders without async overhead
let cachedSettings: PersistableSettings = { ...defaultSettings }

async function loadSettings(): Promise<PersistableSettings> {
  if (!AsyncStorageModule) return cachedSettings
  try {
    const raw = await AsyncStorageModule.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return cachedSettings
    const parsed = JSON.parse(raw) as Partial<PersistableSettings>
    cachedSettings = { ...defaultSettings, ...parsed }
    return cachedSettings
  } catch {
    return cachedSettings
  }
}

async function saveSettings(partial: Partial<PersistableSettings>): Promise<void> {
  cachedSettings = { ...cachedSettings, ...partial }
  if (!AsyncStorageModule) return
  try {
    await AsyncStorageModule.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(cachedSettings))
  } catch {
    // Non-fatal — settings applied in-memory regardless
  }
}

export interface SettingsState {
  maxRecords: number
  maxAge: number
  redactBody: string
  desktopConnect: boolean
  desktopUrl: string
  bridgeStatus: ConnectionStatus
  loaded: boolean
  envSections: InfoSection[]
  importVisible: boolean
  importText: string
  importStatus: 'idle' | 'error'
}

// String-literal discriminant, not boolean: under this repo's `strict: false`
// tsconfig, `{ ok: true } | { ok: false }` doesn't narrow in `if (result.ok)`.
export type ImportSessionResult = { status: 'ok'; count: number } | { status: 'error'; error: string }

export interface SettingsIntents {
  /** Live-updates as the user types; `parseInt(v, 10) || maxRecords` — a falsy parse (including 0) reverts to the last committed value. */
  setMaxRecordsDraft(raw: string): void
  /** Clamp to [10, 5000], apply to `Hakka.configure`, and persist — fired on blur/submit. */
  commitMaxRecords(): void
  /** No draft phase — retention is a fixed chip list, applied immediately. */
  setMaxAge(seconds: number): void
  setRedactBodyDraft(raw: string): void
  commitRedactBody(): void
  setDesktopUrlDraft(url: string): void
  commitDesktopUrl(): void
  setDesktopConnect(value: boolean): void
  refreshEnvironment(): void
  openImportSession(): void
  closeImportSession(): void
  setImportText(value: string): void
  /** Parse `importText` as a `.hakka` session and ingest it. Returns the outcome so `SettingsPanel.tsx` can `Alert.alert` without this view-model importing RN's Alert API. */
  importSession(): ImportSessionResult
}

export type SettingsViewModel = ViewModel<SettingsState, SettingsIntents> & {
  /** Tear down the bridge status subscription. Call on unmount. */
  destroy(): void
}

export function createSettingsViewModel(): SettingsViewModel {
  const emitter = createEmitter()

  // Snapshot identity must stay stable between mutations — see
  // StatsViewModel.ts's note on useSyncExternalStore's identity comparison.
  let snapshot: SettingsState | null = null
  const commit = () => {
    snapshot = null
    emitter.notify()
  }

  let maxRecords = cachedSettings.maxRecords
  let maxAge = cachedSettings.maxAge
  let redactBody = cachedSettings.redactBodyFields.join(', ')
  let desktopConnect = cachedSettings.desktopConnect
  let desktopUrl = cachedSettings.desktopUrl || DEFAULT_DESKTOP_URL
  let bridgeStatus: ConnectionStatus = hakkaBridge.getStatus()
  let loaded = false
  let envSections: InfoSection[] = getDeviceSections()
  let importVisible = false
  let importText = ''
  let importStatus: 'idle' | 'error' = 'idle'

  function applyNetworkStatus(network: string): void {
    envSections = envSections.map((section) =>
      section.title === 'DEVICE'
        ? {
            ...section,
            rows: [...section.rows.filter((r) => r.label !== 'Network'), { label: 'Network', value: network }],
          }
        : section,
    )
    commit()
  }

  void loadSettings().then((s) => {
    maxRecords = s.maxRecords
    maxAge = s.maxAge
    redactBody = s.redactBodyFields.join(', ')
    desktopConnect = s.desktopConnect
    desktopUrl = s.desktopUrl || DEFAULT_DESKTOP_URL
    if (s.desktopConnect) {
      hakkaBridge.connect(s.desktopUrl || DEFAULT_DESKTOP_URL)
    }
    loaded = true
    commit()
  })

  void getNetworkStatus().then(applyNetworkStatus)

  const unsubBridge = hakkaBridge.onStatus((s) => {
    bridgeStatus = s
    commit()
  })

  const intents: SettingsIntents = {
    setMaxRecordsDraft(raw) {
      const parsed = parseInt(raw, 10)
      maxRecords = parsed || maxRecords
      commit()
    },
    commitMaxRecords() {
      const n = parseInt(String(maxRecords), 10)
      const clamped = Number.isFinite(n) ? Math.max(10, Math.min(5000, n)) : cachedSettings.maxRecords
      maxRecords = clamped
      Hakka.configure({ maxRequests: clamped })
      void saveSettings({ maxRecords: clamped })
      commit()
    },
    setMaxAge(seconds) {
      maxAge = seconds
      Hakka.configure({ maxAge: seconds > 0 ? seconds : undefined })
      void saveSettings({ maxAge: seconds })
      commit()
    },
    setRedactBodyDraft(raw) {
      redactBody = raw
      commit()
    },
    commitRedactBody() {
      const fields = redactBody
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      redactBody = fields.join(', ')
      configureBodyRedaction(fields)
      void saveSettings({ redactBodyFields: fields })
      commit()
    },
    setDesktopUrlDraft(url) {
      desktopUrl = url
      commit()
    },
    commitDesktopUrl() {
      void saveSettings({ desktopUrl })
      if (desktopConnect) {
        hakkaBridge.disconnect()
        hakkaBridge.connect(desktopUrl)
      }
      commit()
    },
    setDesktopConnect(value) {
      desktopConnect = value
      void saveSettings({ desktopConnect: value })
      if (value) {
        hakkaBridge.connect(desktopUrl)
      } else {
        hakkaBridge.disconnect()
      }
      commit()
    },
    refreshEnvironment() {
      envSections = getDeviceSections()
      commit()
      void getNetworkStatus().then(applyNetworkStatus)
    },
    openImportSession() {
      importText = ''
      importStatus = 'idle'
      importVisible = true
      commit()
    },
    closeImportSession() {
      importVisible = false
      commit()
    },
    setImportText(value) {
      importText = value
      importStatus = 'idle'
      commit()
    },
    importSession() {
      try {
        const { requests } = deserializeSession(importText)
        for (const request of requests) Hakka.ingest(request)
        importVisible = false
        commit()
        return { status: 'ok', count: requests.length }
      } catch (e: unknown) {
        importStatus = 'error'
        commit()
        const reason = e instanceof Error ? e.message : String(e)
        return { status: 'error', error: reason }
      }
    },
  }

  return {
    getSnapshot: (): SettingsState =>
      (snapshot ??= {
        maxRecords,
        maxAge,
        redactBody,
        desktopConnect,
        desktopUrl,
        bridgeStatus,
        loaded,
        envSections,
        importVisible,
        importText,
        importStatus,
      }),
    subscribe: emitter.subscribe,
    intents,
    destroy() {
      unsubBridge()
    },
  }
}
