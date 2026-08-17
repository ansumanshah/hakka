import type { HealthReportRecord, NetworkRequest } from 'hakka-core'

import { formatCount, formatMs, formatPercent, readableMonitorLabel } from './format'

export type MonitorSeverity = 'idle' | 'good' | 'warning' | 'bad'

export interface MonitorHealthInput {
  readonly slowFrameRate?: number
  readonly frozenFrameCount?: number
  readonly summary?: string
  readonly tags?: Readonly<Record<string, string>>
}

export interface MonitorSummary {
  readonly totalRequests: number
  readonly completedRequests: number
  readonly successCount: number
  readonly errorCount: number
  readonly errorRate: number
  readonly successRate: number
  readonly averageResponseTime: number
  readonly p95LatencyMs: number | null
  readonly totalDataTransferred: number
  readonly slowFrameRate: number | null
  readonly frozenFrameCount: number | null
  readonly jsLagMs: number | null
  readonly jsLagP95Ms: number | null
  readonly jsLagMaxMs: number | null
  readonly jsLagSampleCount: number
  readonly overlayRenderCostMs: number | null
  readonly uiFps: number | null
  readonly jsFps: number | null
  readonly ramBytes: number | null
  readonly hermesHeapBytes: number | null
  readonly nativeHeapBytes: number | null
  readonly layoutCostMs: number | null
  readonly cpuPercent: number | null
  readonly frameDurationP95Ms: number | null
  readonly frameDurationP99Ms: number | null
  readonly jankRate: number | null
  readonly nativeHealthPollCostMs: number | null
  readonly monitorOverheadMs: number | null
  readonly droppedRecords: number
  readonly thermalState: string | null
  readonly batteryLevelPercent: number | null
  readonly batteryStatus: string | null
  readonly appVisibility: string | null
  readonly healthScore: number
  readonly networkLabel: 'ERR' | 'P95'
  readonly networkValue: string
  readonly networkSeverity: MonitorSeverity
  readonly uxLabel: 'FRZ' | 'JNK' | 'JS' | 'UX'
  readonly uxValue: string
  readonly uxSeverity: MonitorSeverity
}

interface MonitorHudMetric {
  readonly label: string
  readonly value: string
  readonly severity: MonitorSeverity
}

export interface MonitorHudModel {
  readonly requestLabel: string
  readonly requestValue: string
  readonly statusText: string
  readonly healthSeverity: MonitorSeverity
  readonly network: MonitorHudMetric
  readonly ui: MonitorHudMetric
  readonly js: MonitorHudMetric
}

export interface JsRuntimeMetrics {
  readonly currentLagMs?: number | null
  readonly p95LagMs?: number | null
  readonly maxLagMs?: number | null
  readonly sampleCount?: number
  readonly overlayRenderCostMs?: number | null
  readonly jsFps?: number | null
  readonly hermesHeapBytes?: number | null
  readonly layoutCostMs?: number | null
  readonly nativeHealthPollCostMs?: number | null
}

export interface MonitorSummaryOptions {
  readonly logs: readonly NetworkRequest[]
  readonly totalCount?: number
  readonly healthReport?: MonitorHealthInput | HealthReportRecord | null
  readonly jsLagMs?: number | null
  readonly jsRuntimeMetrics?: JsRuntimeMetrics | null
}

const JS_LAG_WARNING_THRESHOLD_MS = 80
const JS_LAG_BAD_THRESHOLD_MS = 200

export function coerceHealthReport(value: unknown): MonitorHealthInput | null {
  if (!value || typeof value !== 'object') return null

  const report = value as Record<string, unknown>
  const slowFrameRate = optionalFiniteNumber(report.slowFrameRate)
  const frozenFrameCount = optionalFiniteNumber(report.frozenFrameCount)
  const summary = typeof report.summary === 'string' ? report.summary : undefined
  const tags = coerceStringTags(report.tags)

  if (slowFrameRate === undefined && frozenFrameCount === undefined && summary === undefined && tags === undefined) {
    return null
  }

  return {
    slowFrameRate,
    frozenFrameCount,
    summary,
    tags,
  }
}

export function createMonitorSummary({
  logs,
  totalCount,
  healthReport,
  jsLagMs,
  jsRuntimeMetrics,
}: MonitorSummaryOptions): MonitorSummary {
  let completedRequests = 0
  let errorCount = 0
  let successCount = 0
  let totalDataTransferred = 0
  const durations: number[] = []

  for (const log of logs) {
    if (hasCompleted(log)) {
      completedRequests += 1
    }

    if (isError(log)) {
      errorCount += 1
    }

    if (isSuccess(log)) {
      successCount += 1
    }

    const duration = optionalFiniteNumber(log.duration)
    if (duration !== undefined) {
      durations.push(duration)
    }

    const bytes = optionalFiniteNumber(log.size) ?? optionalFiniteNumber(log.responseBodySize)
    if (bytes !== undefined) {
      totalDataTransferred += bytes
    }
  }

  const totalRequests = totalCount ?? logs.length
  const averageResponseTime =
    durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0
  const p95LatencyMs = percentile(durations, 0.95)
  const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0
  const successRate = totalRequests > 0 ? successCount / totalRequests : 0
  const slowFrameRate = normalizeRate(healthReport?.slowFrameRate)
  const frozenFrameCount =
    healthReport?.frozenFrameCount === undefined ? null : Math.max(0, Math.round(healthReport.frozenFrameCount))
  const normalizedJsLagMs = normalizeLag(jsRuntimeMetrics?.currentLagMs ?? jsLagMs)
  const jsLagP95Ms = normalizeLag(jsRuntimeMetrics?.p95LagMs)
  const jsLagMaxMs = normalizeLag(jsRuntimeMetrics?.maxLagMs)
  const jsLagSampleCount = normalizeCount(jsRuntimeMetrics?.sampleCount)
  const overlayRenderCostMs = normalizeLag(jsRuntimeMetrics?.overlayRenderCostMs)
  const tags = healthReport?.tags
  const uiFps = normalizeFps(firstFiniteTagNumber(tags, ['frame.fps', 'fps']))
  const jsFps = normalizeFps(jsRuntimeMetrics?.jsFps)
  const ramBytes = normalizeBytes(firstFiniteTagNumber(tags, ['memory.ramBytes', 'memory.pssBytes', 'pssBytes']))
  const hermesHeapBytes = normalizeBytes(jsRuntimeMetrics?.hermesHeapBytes)
  const nativeHeapBytes = normalizeBytes(
    firstFiniteTagNumber(tags, [
      'memory.nativeHeapBytes',
      'memory.nativeHeapAllocatedBytes',
      'memory.nativePssBytes',
      'memory.residentBytes',
    ]),
  )
  const layoutCostMs = normalizeLag(jsRuntimeMetrics?.layoutCostMs)
  const cpuPercent = normalizePercentValue(firstFiniteTagNumber(tags, ['cpu.processPercent']))
  const frameDurationP95Ms = normalizeLag(firstFiniteTagNumber(tags, ['frame.durationP95Ms', 'frameDurationP95Ms']))
  const frameDurationP99Ms = normalizeLag(firstFiniteTagNumber(tags, ['frame.durationP99Ms', 'frameDurationP99Ms']))
  const jankRate = normalizeRate(
    firstFiniteTagNumber(tags, ['frame.jankRate', 'jankFrameRate']) ?? slowFrameRate ?? undefined,
  )
  const nativeHealthPollCostMs = normalizeLag(jsRuntimeMetrics?.nativeHealthPollCostMs)
  const monitorOverheadMs = maxNullable(overlayRenderCostMs, layoutCostMs, nativeHealthPollCostMs)
  const droppedRecords = normalizeCount(firstFiniteTagNumber(tags, ['monitor.droppedRecords']))
  const thermalState = firstStringTag(tags, ['thermal.state', 'thermal.statusName'])
  const batteryLevelPercent = normalizePercentValue(firstFiniteTagNumber(tags, ['battery.levelPercent']))
  const batteryStatus = batteryStatusLabel(firstStringTag(tags, ['battery.status', 'battery.plugged']))
  const appVisibility = firstStringTag(tags, ['app.visibility'])

  const networkStatus = networkDisplay(errorCount, p95LatencyMs)
  const uxStatus = uxDisplay(slowFrameRate, frozenFrameCount, jsLagP95Ms ?? normalizedJsLagMs)

  return {
    totalRequests,
    completedRequests,
    successCount,
    errorCount,
    errorRate,
    successRate,
    averageResponseTime,
    p95LatencyMs,
    totalDataTransferred,
    slowFrameRate,
    frozenFrameCount,
    jsLagMs: normalizedJsLagMs,
    jsLagP95Ms,
    jsLagMaxMs,
    jsLagSampleCount,
    overlayRenderCostMs,
    uiFps,
    jsFps,
    ramBytes,
    hermesHeapBytes,
    nativeHeapBytes,
    layoutCostMs,
    cpuPercent,
    frameDurationP95Ms,
    frameDurationP99Ms,
    jankRate,
    nativeHealthPollCostMs,
    monitorOverheadMs,
    droppedRecords,
    thermalState,
    batteryLevelPercent,
    batteryStatus,
    appVisibility,
    healthScore: healthScore(networkStatus.severity, uxStatus.severity),
    networkLabel: networkStatus.label,
    networkValue: networkStatus.value,
    networkSeverity: networkStatus.severity,
    uxLabel: uxStatus.label,
    uxValue: uxStatus.value,
    uxSeverity: uxStatus.severity,
  }
}

function monitorStatusText(summary: MonitorSummary): string {
  if (summary.networkSeverity === 'bad' || summary.networkSeverity === 'warning') {
    return `${readableMonitorLabel(summary.networkLabel)} ${summary.networkValue}`
  }
  if (summary.uxSeverity === 'bad' || summary.uxSeverity === 'warning') {
    return `${readableMonitorLabel(summary.uxLabel)} ${summary.uxValue}`
  }
  return summary.totalRequests > 0 ? 'Capturing' : 'Idle'
}

export function createMonitorHudModel(summary: MonitorSummary): MonitorHudModel {
  return {
    requestLabel: 'REQ',
    requestValue: formatCount(summary.totalRequests),
    statusText: monitorStatusText(summary),
    healthSeverity: healthSeverity(summary.healthScore),
    network: {
      label: summary.networkLabel,
      value: summary.networkValue,
      severity: summary.networkSeverity,
    },
    ui: fpsHudMetric('UI', summary.uiFps),
    js: fpsHudMetric('JS', summary.jsFps),
  }
}

function hasCompleted(log: NetworkRequest): boolean {
  return Boolean((log.status && log.status > 0) || log.error || log.endTime)
}

function isSuccess(log: NetworkRequest): boolean {
  return Boolean(log.status && log.status >= 200 && log.status < 400)
}

function isError(log: NetworkRequest): boolean {
  return Boolean(log.error || (log.status && log.status >= 400))
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function normalizeLag(value: number | null | undefined): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function normalizeFps(value: number | null | undefined): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function normalizeBytes(value: number | null | undefined): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function normalizePercentValue(value: number | null | undefined): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function normalizeCount(value: number | null | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

function coerceStringTags(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const tags: Record<string, string> = {}
  for (const [key, tagValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof tagValue === 'string') tags[key] = tagValue
    else if (typeof tagValue === 'number' && Number.isFinite(tagValue)) tags[key] = String(tagValue)
  }
  return Object.keys(tags).length > 0 ? tags : undefined
}

function firstFiniteTagNumber(
  tags: Readonly<Record<string, string>> | undefined,
  keys: readonly string[],
): number | null {
  if (!tags) return null
  for (const key of keys) {
    const raw = tags[key]
    if (raw === undefined) continue
    const value = Number(raw)
    if (Number.isFinite(value)) return value
  }
  return null
}

function firstStringTag(tags: Readonly<Record<string, string>> | undefined, keys: readonly string[]): string | null {
  if (!tags) return null
  for (const key of keys) {
    const value = tags[key]
    if (value !== undefined && value.length > 0) return value
  }
  return null
}

function maxNullable(...values: Array<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null
}

function batteryStatusLabel(value: string | null): string | null {
  switch (value) {
    case '1':
      return 'Unknown'
    case '2':
      return 'Charging'
    case '3':
      return 'Discharging'
    case '4':
      return 'Unplugged'
    case '5':
      return 'Full'
    default:
      return value
  }
}

function percentile(values: readonly number[], rank: number): number | null {
  if (values.length === 0) return null
  const sorted = sortImmutable(values, (a, b) => a - b)
  const index = Math.ceil(sorted.length * rank) - 1
  return Math.round(sorted[Math.max(0, Math.min(sorted.length - 1, index))])
}

function sortImmutable<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  const valuesWithToSorted = values as {
    toSorted?: (compareFn: ((left: T, right: T) => number) | undefined) => T[]
  }

  if (typeof valuesWithToSorted.toSorted === 'function') {
    return valuesWithToSorted.toSorted(compare)
  }

  return values.slice().sort(compare)
}

function normalizeRate(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(1, value))
}

function networkDisplay(
  errorCount: number,
  p95LatencyMs: number | null,
): {
  label: MonitorSummary['networkLabel']
  value: string
  severity: MonitorSeverity
} {
  if (errorCount > 0) {
    return {
      label: 'ERR',
      value: formatCount(errorCount),
      severity: errorCount >= 5 ? 'bad' : 'warning',
    }
  }

  if (p95LatencyMs === null) {
    return { label: 'P95', value: '--', severity: 'idle' }
  }

  return {
    label: 'P95',
    value: formatMs(p95LatencyMs),
    severity: p95LatencyMs <= 350 ? 'good' : p95LatencyMs <= 1000 ? 'warning' : 'bad',
  }
}

function uxDisplay(
  slowFrameRate: number | null,
  frozenFrameCount: number | null,
  jsLagMs: number | null,
): {
  label: MonitorSummary['uxLabel']
  value: string
  severity: MonitorSeverity
} {
  if (frozenFrameCount !== null && frozenFrameCount > 0) {
    return {
      label: 'FRZ',
      value: formatCount(frozenFrameCount),
      severity: frozenFrameCount >= 3 ? 'bad' : 'warning',
    }
  }

  if (slowFrameRate !== null && slowFrameRate > 0.05) {
    return {
      label: 'JNK',
      value: formatPercent(slowFrameRate),
      severity: slowFrameRate > 0.15 ? 'bad' : 'warning',
    }
  }

  if (jsLagMs !== null && jsLagMs >= JS_LAG_WARNING_THRESHOLD_MS) {
    return {
      label: 'JS',
      value: formatMs(jsLagMs),
      severity: jsLagMs >= JS_LAG_BAD_THRESHOLD_MS ? 'bad' : 'warning',
    }
  }

  if (slowFrameRate !== null || frozenFrameCount !== null) {
    return { label: 'UX', value: 'OK', severity: 'good' }
  }

  if (jsLagMs !== null) {
    return { label: 'JS', value: formatMs(jsLagMs), severity: 'good' }
  }

  return { label: 'UX', value: '--', severity: 'idle' }
}

function healthScore(networkSeverity: MonitorSeverity, uxSeverity: MonitorSeverity): number {
  const penalty = severityPenalty(networkSeverity) + severityPenalty(uxSeverity)
  return Math.max(0, 100 - penalty)
}

function healthSeverity(score: number): MonitorSeverity {
  if (score >= 90) return 'good'
  if (score >= 70) return 'warning'
  return 'bad'
}

function fpsHudMetric(label: 'UI' | 'JS', fps: number | null): MonitorHudMetric {
  if (fps === null) return { label, value: '--', severity: 'idle' }
  return {
    label,
    value: String(Math.round(fps)),
    severity: fps >= 55 ? 'good' : fps >= 45 ? 'warning' : 'bad',
  }
}

function severityPenalty(severity: MonitorSeverity): number {
  switch (severity) {
    case 'bad':
      return 35
    case 'warning':
      return 15
    case 'idle':
      return 5
    case 'good':
      return 0
  }
}
