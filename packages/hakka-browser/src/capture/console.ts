/**
 * Browser console capture — wraps ConsoleInterceptor from hakka-core
 * with a bounded ring-buffer and consecutive-duplicate collapsing
 * (same message repeated → single entry with count).
 */
import { ConsoleInterceptor } from 'hakka-core'

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  message: string
  timestamp: number
  count: number
}

type ConsoleEntryListener = (entry: ConsoleEntry) => void

const DEFAULT_MAX = 500

let buffer: ConsoleEntry[] = []
let maxSize = DEFAULT_MAX
let listeners: Set<ConsoleEntryListener> = new Set()
let consoleTeardown: (() => void) | null = null

function emit(entry: ConsoleEntry): void {
  for (const cb of listeners) {
    try {
      cb(entry)
    } catch {
      /* never crash */
    }
  }
}

/**
 * Enable console capture with optional max buffer size.
 * Returns a teardown function that disables capture and clears state.
 */
export function enableConsoleCapture(max = DEFAULT_MAX): () => void {
  if (consoleTeardown) return consoleTeardown

  maxSize = max
  buffer = []

  ConsoleInterceptor.enable()

  const unsub = ConsoleInterceptor.onEntry((raw) => {
    const level = raw.level as ConsoleEntry['level']
    const msg = raw.message

    const last = buffer.length > 0 ? buffer[buffer.length - 1] : null
    if (last && last.level === level && last.message === msg) {
      last.count += 1
      last.timestamp = raw.timestamp
      emit(last)
      return
    }

    const entry: ConsoleEntry = { level, message: msg, timestamp: raw.timestamp, count: 1 }
    buffer.push(entry)

    if (buffer.length > maxSize) {
      buffer.shift()
    }

    emit(entry)
  })

  consoleTeardown = () => {
    unsub()
    ConsoleInterceptor.disable()
    buffer = []
    listeners.clear()
    consoleTeardown = null
  }

  return consoleTeardown
}

/** Snapshot of buffered console entries. */
export function getConsoleEntries(): ConsoleEntry[] {
  return [...buffer]
}

/** Subscribe to new console entries. Returns unsubscribe fn. */
export function onConsoleEntry(cb: ConsoleEntryListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Clear the console buffer. */
export function clearConsole(): void {
  buffer = []
}
