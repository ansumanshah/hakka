import { createHash } from 'node:crypto'

import {
  isPerformanceRecord,
  MAX_DIAGNOSTIC_BATCH,
  MAX_DIAGNOSTIC_FRAME_BYTES,
  MAX_DIAGNOSTIC_RECORD_BYTES,
  type PerformanceRecord,
} from 'hakka-bridge'
import { LogStore, scrubBodyForShare, type LogEntry } from 'hakka-core'

type DiagnosticChannel = 'console' | 'performance'

interface Counters {
  invalid: number
  evicted: number
}

interface DiagnosticPage<T> {
  schemaVersion: 1
  status: 'inspected'
  entries: T[]
  retained: number
  omitted: number
  evicted: number
  invalid: number
  measurementScope: 'upstream-store'
  sourceIdentity: 'unverified'
  targetCorrelation: 'unavailable'
  collectorDroppedSamples: 'unavailable'
  sampleIntervalMs: 'unavailable'
}

const metricFields = {
  'metric.frame': ['durationMs', 'refreshRateHz', 'slow', 'frozen'],
  'metric.memory': ['pssBytes', 'heapUsedBytes', 'heapMaxBytes'],
  'metric.cpu': ['processCpuPercent'],
  'metric.network_usage': ['rxBytes', 'txBytes'],
  'metric.js_thread': ['eventLoopDelayMs'],
} as const

function opaqueId(id: string): string {
  return createHash('sha256').update(id).digest('hex')
}

/** Pattern-based scrubbing of untrusted log text; never a complete secret scan. */
function scrubLogMessage(message: string): string {
  return (scrubBodyForShare(message).body ?? '')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[redacted-url]')
    .replace(/(?:[A-Z]:\\|file:\/\/|~\/|\/(?:Users|home|private|var|tmp|Volumes|etc)\/)[^\s<>"']+/gi, '[redacted-path]')
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie|session[_-]?id)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '[redacted-secret]',
    )
    .replace(/\b(?:sk|pk)-(?:live-|test-|proj-)?[a-z0-9_-]{8,}/gi, '[redacted-secret]')
    .slice(0, 512)
}

/** One bounded owner for bridge diagnostics. Only projected, scrubbed facts enter retention. */
export class DiagnosticStore {
  private readonly capacity: number
  private readonly logs: LogStore
  private readonly performance: PerformanceRecord[] = []
  private readonly counters: Record<DiagnosticChannel, Counters> = {
    console: { invalid: 0, evicted: 0 },
    performance: { invalid: 0, evicted: 0 },
  }

  constructor(capacity = 500) {
    this.capacity = Number.isSafeInteger(capacity) && capacity >= 1 && capacity <= 1000 ? capacity : 500
    this.logs = new LogStore(this.capacity)
  }

  /** Returns true for a diagnostic frame, including rejected input. Never throws. */
  ingestFrame(raw: string): boolean {
    // A bounded prefix only attributes malformed/oversized frames with a visible channel.
    const prefixChannel = raw.slice(0, 1024).match(/"type"\s*:\s*"(console|performance)"/)?.[1] as
      | DiagnosticChannel
      | undefined
    if (Buffer.byteLength(raw, 'utf8') > MAX_DIAGNOSTIC_FRAME_BYTES) {
      if (prefixChannel) this.counters[prefixChannel].invalid++
      return prefixChannel !== undefined
    }
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      if (prefixChannel) this.counters[prefixChannel].invalid++
      return prefixChannel !== undefined
    }
    if (message === null || typeof message !== 'object') return false
    const { type, payload } = message as { type?: unknown; payload?: unknown }
    if (type !== 'console' && type !== 'performance') return false
    const counters = this.counters[type]
    if (!Array.isArray(payload) || payload.length > MAX_DIAGNOSTIC_BATCH) {
      counters.invalid++
      return true
    }
    for (const value of payload) {
      let recordBytes: number
      try {
        recordBytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
      } catch {
        counters.invalid++
        continue
      }
      if (recordBytes > MAX_DIAGNOSTIC_RECORD_BYTES) {
        counters.invalid++
        continue
      }
      if (type === 'console') this.addLog(value)
      else this.addPerformance(value)
    }
    return true
  }

  private addLog(value: unknown): void {
    const counters = this.counters.console
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      counters.invalid++
      return
    }
    const record = value as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      !record.id ||
      record.id.length > 512 ||
      typeof record.timestamp !== 'number' ||
      !Number.isFinite(record.timestamp) ||
      record.timestamp < 0 ||
      !['debug', 'info', 'warn', 'error'].includes(record.level as string) ||
      typeof record.message !== 'string'
    ) {
      counters.invalid++
      return
    }
    if (this.logs.size() === this.capacity) counters.evicted++
    this.logs.add({
      id: opaqueId(record.id),
      timestamp: record.timestamp,
      level: record.level as LogEntry['level'],
      message: scrubLogMessage(record.message),
    })
  }

  private addPerformance(value: unknown): void {
    const counters = this.counters.performance
    if (!isPerformanceRecord(value)) {
      counters.invalid++
      return
    }
    const projected: Record<string, unknown> = {
      id: opaqueId(value.id),
      kind: value.kind,
      schemaVersion: 1,
      timestamp: value.timestamp,
    }
    for (const field of metricFields[value.kind]) {
      const measurement = (value as unknown as Record<string, unknown>)[field]
      if (measurement !== undefined) projected[field] = measurement
    }
    if (this.performance.length === this.capacity) {
      this.performance.shift()
      counters.evicted++
    }
    this.performance.push(projected as unknown as PerformanceRecord)
  }

  listLogs(limit = 25): DiagnosticPage<LogEntry> {
    return this.page(this.logs.getEntries(), 'console', limit)
  }

  listPerformance(limit = 25): DiagnosticPage<PerformanceRecord> {
    return this.page(this.performance, 'performance', limit)
  }

  private page<T extends object>(records: readonly T[], channel: DiagnosticChannel, limit: number): DiagnosticPage<T> {
    const count = Number.isSafeInteger(limit) && limit >= 1 && limit <= 50 ? limit : 25
    const entries = records
      .slice(-count)
      .reverse()
      .map((record) => ({ ...record }))
    return {
      schemaVersion: 1,
      status: 'inspected',
      entries,
      retained: records.length,
      omitted: records.length - entries.length,
      ...this.counters[channel],
      measurementScope: 'upstream-store',
      sourceIdentity: 'unverified',
      targetCorrelation: 'unavailable',
      collectorDroppedSamples: 'unavailable',
      sampleIntervalMs: 'unavailable',
    }
  }
}
