/**
 * Opt-in request-initiator capture — the "which code made this call" stack.
 * Capturing `new Error().stack` unwinds the stack, so it's OFF by default (zero overhead).
 * Turn it on with `setStackCapture(true)`; interceptors call `captureInitiator()`
 * synchronously at the call site, so the frames are the app's — Hakka's own are stripped after.
 */
let enabled = false

export function setStackCapture(on: boolean): void {
  enabled = on
}

export function isStackCaptureEnabled(): boolean {
  return enabled
}

// Frames belonging to Hakka's capture internals — dropped from the initiator so only the
// app's call site remains. Matches both source paths and bundled (minified) names. The
// package-name alternative is anchored to `node_modules/` on purpose — unanchored, it would
// match any path merely *containing* the string (e.g. a consumer's own `hakka-core-demo`
// folder) and strip every app frame, leaving `initiator: undefined`.
const HAKKA_FRAME =
  /capture[/\\](fetch|xhr|websocket|stackTrace)|captureInitiator|enableFetchInterceptor|enableXHRInterceptor|node_modules[/\\]hakka-(core|browser|node)/i

/** Max app-frame count in the returned initiator (see `captureInitiator`). */
const MAX_INITIATOR_FRAMES = 12

/**
 * V8-family engines (Node, Chrome, some Hermes builds) cap `Error().stack` to
 * `Error.stackTraceLimit` frames (default 10) — fewer than the frames Hakka's own wrapper
 * burns before the app's call site even starts. Bump the limit while capturing so the "up to
 * 12 app frames" contract survives Hakka's own frames, then restore immediately. Opt-in only.
 */
const STACK_TRACE_LIMIT_OVERRIDE = 25

/**
 * Capture the cleaned initiator stack, or `undefined` when disabled / unavailable.
 * Returns up to 12 app frames as a newline-joined string.
 */
export function captureInitiator(): string | undefined {
  if (!enabled) return undefined

  const errorCtor = Error as unknown as { stackTraceLimit?: number }
  const supportsStackTraceLimit = typeof errorCtor.stackTraceLimit === 'number'
  const previousLimit = errorCtor.stackTraceLimit
  if (supportsStackTraceLimit) {
    errorCtor.stackTraceLimit = STACK_TRACE_LIMIT_OVERRIDE
  }

  let rawStack: string | undefined
  try {
    rawStack = new Error().stack
  } finally {
    if (supportsStackTraceLimit) {
      errorCtor.stackTraceLimit = previousLimit
    }
  }

  if (!rawStack) return undefined

  const frames: string[] = []
  // Skip the leading "Error" line; keep app frames, drop Hakka internals.
  for (const line of rawStack.split('\n').slice(1)) {
    const trimmed = line.trim()
    if (!trimmed || HAKKA_FRAME.test(trimmed)) continue
    frames.push(trimmed.replace(/^at\s+/, ''))
    if (frames.length >= MAX_INITIATOR_FRAMES) break
  }
  return frames.length > 0 ? frames.join('\n') : undefined
}
