export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  message: string
  /** subsystem tag, e.g. 'auth', 'payments' */
  category?: string
  /** structured fields (redaction-aware) */
  metadata?: Record<string, unknown>
}

export interface LogListener {
  (entry: LogEntry): void
}
