import { getBodyRedactionFields, redactJsonBody } from '../utils/bodyRedaction'
import { logStore } from './LogStore'
import type { LogEntry, LogLevel } from './types'

export interface LogOptions {
  category?: string
  metadata?: Record<string, unknown>
}

let counter = 0

/**
 * Runs metadata through the body-redaction path (`redactJsonBody`) so configured
 * sensitive field names are scrubbed from structured log fields too, not just
 * network bodies. Falls back to the original metadata unchanged if no fields
 * are configured or it can't be round-tripped through JSON.
 */
function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (getBodyRedactionFields().length === 0) return metadata

  const serialized = JSON.stringify(metadata)
  const redacted = redactJsonBody(serialized)
  if (redacted == null) return metadata

  try {
    return JSON.parse(redacted) as Record<string, unknown>
  } catch {
    return metadata
  }
}

/**
 * Log a structured entry to the shared logStore. Never throws — logging must
 * never be able to crash the host app, so all failures are swallowed silently.
 */
export function log(level: LogLevel, message: string, options?: LogOptions): void {
  try {
    const metadata = options?.metadata ? redactMetadata(options.metadata) : undefined

    const entry: LogEntry = {
      id: `log_${++counter}_${Date.now()}`,
      timestamp: Date.now(),
      level,
      message,
      ...(options?.category !== undefined ? { category: options.category } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    }

    logStore.add(entry)
  } catch {
    // Never throw from log() — fail silently.
  }
}

export function logDebug(message: string, options?: LogOptions): void {
  log('debug', message, options)
}

export function logInfo(message: string, options?: LogOptions): void {
  log('info', message, options)
}

export function logWarn(message: string, options?: LogOptions): void {
  log('warn', message, options)
}

export function logError(message: string, options?: LogOptions): void {
  log('error', message, options)
}
