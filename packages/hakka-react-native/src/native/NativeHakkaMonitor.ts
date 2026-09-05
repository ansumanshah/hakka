import { TurboModuleRegistry, type TurboModule } from 'react-native'
import type { UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes'

interface NetworkTiming {
  dnsMs?: number
  tlsMs?: number
  connectMs?: number
  ttfbMs?: number
  downloadMs?: number
}

interface NetworkRequest {
  id: string
  url: string
  method: string
  status?: number
  startTime: number
  endTime?: number
  duration?: number
  requestHeaders?: UnsafeObject
  responseHeaders?: UnsafeObject
  requestBody?: string
  responseBody?: string
  error?: string
  timestamp: number
  size?: number
  contentType?: string
  encoding?: string
  networkProtocol?: string
  library?: string
  redirectCount?: number
  redirectChain?: string[]
  timing?: NetworkTiming
  /** Platform runtime tag: 'ios' | 'android'. Present for native-layer captures. */
  runtime?: string
  /** WebSocket message count. Present for native WS captures (source 'native_ws'). */
  wsMessageCount?: number
  /** WebSocket close code (RFC 6455). Present for native WS captures. */
  wsCloseCode?: number
}

/**
 * TurboModule Codegen spec for HakkaMonitor — the canonical JS contract RN
 * codegen validates against; platform adapters must keep the exported module
 * name aligned with `HakkaMonitor`.
 */
export interface Spec extends TurboModule {
  initialize(): Promise<void>
  isReady(): Promise<boolean>

  addLog(request: NetworkRequest): void
  getLogs(): Promise<NetworkRequest[] | string>
  clearLogs(): void
  getLogCount(): Promise<number>

  // Pause/resume — forward JS-side pause/resume to the native capture engine
  // so a native-mode RN app stops recording, not just the JS ring buffer.
  pause(): void
  resume(): void

  exportJson(): Promise<string>
  exportHar(): Promise<string>
  exportCurl(requestId: string): Promise<string>

  getPerformanceMetrics(): Promise<{
    totalRequests: number
    completedRequests?: number
    successCount?: number
    averageResponseTime: number
    successRate: number
    errorRate?: number
    errorCount: number
    p95LatencyMs?: number
    totalDataTransferred?: number
  }>
  getHealthReport(): Promise<UnsafeObject>

  setSensitiveHeaders(headers: string[]): void
  getSensitiveHeaders(): Promise<string[]>
  sanitizeLogs(): Promise<void>

  setIgnoredHosts(hosts: string[]): void
  getIgnoredHosts(): Promise<string[]>
  setIgnoredPatterns(patterns: string[]): void
  getIgnoredPatterns(): Promise<string[]>

  simulateSlowNetwork(delayMs: number): void
  blockRequests(pattern: string): void
  unblockRequests(pattern: string): void
  addMockRule(rule: UnsafeObject): void
  removeMockRule(id: string): void
  setMockRuleEnabled(id: string, enabled: boolean): void

  // Native UI — mode: 'bubble' (default), 'sheet', or 'fullscreen'
  /**
   * Synchronously reports whether the optional native UI package (HakkaUI on
   * iOS, hakka-ui on Android) is linked. Presentation success is reported by showUI.
   */
  isUIAvailable(): boolean
  showUI(mode: string): Promise<boolean>
  hideUI(): void

  /** Return the full current log snapshot — used for startup sync. */
  getSnapshot(): Promise<NetworkRequest[] | string>

  setUserId(userId: string | null): void
  setTag(key: string, value: string): void
  addBreadcrumb(name: string, attributes: UnsafeObject): void

  startTrace(name: string): Promise<string>
  setTraceAttribute(traceId: string, key: string, value: string): void
  setTraceMetric(traceId: string, key: string, value: string): void
  finishTrace(traceId: string): void

  addListener(eventName: string): void
  removeListeners(count: number): void

  setOnNewRequestListener(callback: ((request: NetworkRequest) => void) | null): void

  /** Enable native WebSocket capture (iOS 13+; no-op on Android). */
  enableNativeWebSocket(): Promise<void>
  isNativeCapturing(): Promise<boolean>

  /**
   * Requests a fresh on-demand snapshot of native device storage (SharedPreferences on
   * Android), relayed back as one `onHakkaStorage` event per store. Mirrors the JS bridge's
   * connect-time AsyncStorage/MMKV publish — called once right after the bridge connects so a
   * freshly-opened desktop peer isn't left without a Storage panel until the native Storage
   * tab happens to be opened. No-op where the optional native UI package isn't linked.
   */
  publishStorageSnapshots(): void
}

/**
 * HakkaMonitor TurboModule via codegen. Module name 'HakkaMonitor' must
 * match native registration (`HakkaMonitorModule.mm` iOS, `.kt` Android).
 */
export default TurboModuleRegistry.get<Spec>('HakkaMonitor')
