/**
 * Console interceptor — captures console.log/warn/error/info/debug and
 * forwards them to registered listeners so they can be relayed to the
 * Hakka desktop devtools.
 */

import type { CaptureSource, CaptureSourceContext } from '../contract/captureSource'

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

interface ConsoleEntry {
  level: ConsoleLevel
  message: string
  timestamp: number
  args?: unknown[]
}

type ConsoleListener = (entry: ConsoleEntry) => void

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']

/**
 * Length caps for the serialized `message` field, so one huge `console.log(giantObj)` can't
 * balloon a captured entry. Caps apply only to `message`; the raw `args` array is untouched.
 */
const MAX_ARG_LENGTH = 8 * 1024 // 8KB per stringified argument
const MAX_MESSAGE_LENGTH = 8 * 1024 // 8KB for the joined message

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…(truncated)` : text
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return truncate(arg, MAX_ARG_LENGTH)
  try {
    return truncate(JSON.stringify(arg), MAX_ARG_LENGTH)
  } catch {
    return truncate(String(arg), MAX_ARG_LENGTH)
  }
}

function buildMessage(args: unknown[]): string {
  return truncate(args.map(stringifyArg).join(' '), MAX_MESSAGE_LENGTH)
}

class ConsoleInterceptorImpl {
  private originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {}
  private listeners: Set<ConsoleListener> = new Set()
  private enabled = false

  /** Start intercepting console methods. Safe to call multiple times. */
  enable(): void {
    if (this.enabled) return
    this.enabled = true

    for (const level of LEVELS) {
      // eslint-disable-next-line no-console
      const orig = (console[level] as (...args: unknown[]) => void).bind(console)
      this.originals[level] = orig

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this
      // eslint-disable-next-line no-console
      ;(console[level] as (...args: unknown[]) => void) = function (...args: unknown[]) {
        orig(...args)
        // Hot-path short-circuit: skip building the serialized entry when nobody is listening
        // — e.g. capture wired up before the overlay/panel mounts.
        if (self.listeners.size === 0) return
        const entry: ConsoleEntry = {
          level,
          message: buildMessage(args),
          timestamp: Date.now(),
          args: [...args],
        }
        for (const listener of self.listeners) {
          try {
            listener(entry)
          } catch {
            /* never crash the app */
          }
        }
      }
    }
  }

  /** Stop intercepting and restore original console methods. */
  disable(): void {
    if (!this.enabled) return
    this.enabled = false

    for (const level of LEVELS) {
      if (this.originals[level]) {
        // eslint-disable-next-line no-console
        ;(console[level] as (...args: unknown[]) => void) = this.originals[level]!
      }
    }
    this.originals = {}
  }

  /** Subscribe to console entries. Returns unsubscribe fn. */
  onEntry(listener: ConsoleListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get isEnabled(): boolean {
    return this.enabled
  }
}

export const ConsoleInterceptor = new ConsoleInterceptorImpl()

/**
 * `CaptureSource` (ADR 0006) wrapper around `ConsoleInterceptor`. ADR 0006's mapping table
 * (row 4) calls this mechanism "Awkward": a `ConsoleEntry` is shaped like a `BreadcrumbRecord`
 * (`model/contract.ts`'s `ContractRecord` union), not a `NetworkRequest` or `FrameworkSpan`, and
 * `CaptureSourceContext` deliberately has no generic `emitRecord?()` slot for it — out of scope
 * for this contract slice (see the ADR row's "Fit" note). There is therefore no honest value to
 * hand `ctx.ingest`/`ctx.emitSpan` for a console entry, so this wrapper never calls either: it
 * is lifecycle-only, mirroring `ConsoleInterceptor.enable()`/`disable()`'s own idempotent
 * start/stop through the CaptureSource shape, same as `createWebSocketCaptureSource`/
 * `createOtelSpanCaptureSource` wrap their respective enable functions unchanged. Because of
 * this, `checkCaptureSourceConformance` against this source necessarily fails every check that
 * asserts an emission count (see `consoleCaptureSource.test.ts`, which documents exactly which
 * checks that is and why) — that is the honest result of row 4's "Emits via: Neither", not a
 * defect in this wrapper.
 */
export function createConsoleCaptureSource(): CaptureSource {
  let started = false

  return {
    id: 'hakka.console',
    runtime: 'client',
    transport: 'console',
    correlation: 'none',
    start(_ctx: CaptureSourceContext) {
      if (started) return // already started — idempotent per the CaptureSource contract
      started = true
      ConsoleInterceptor.enable()
    },
    stop() {
      if (!started) return // never started, or already stopped — idempotent per the contract
      started = false
      ConsoleInterceptor.disable()
    },
  }
}
