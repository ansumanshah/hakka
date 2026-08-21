/**
 * Incrementally capture an SSE (`text/event-stream`) response body — see
 * docs/concepts/performance.md for the full algorithm and emit cadence. Diverges from
 * readCappedBody: an over-cap capture KEEPS the up-to-cap prefix instead of nulling it out,
 * since a live token stream's partial transcript is still useful — and, crucially, it also
 * keeps a bounded TAIL of the stream's final events. LLM APIs deliver token accounting in
 * their LAST events (usage/`message_delta`), so a capture that stopped dead at the cap
 * structurally could never see them on long streams. Fails open throughout — a throwing
 * `onUpdate` or a reader error never breaks the caller's own untouched stream.
 */

const SSE_EMIT_INTERVAL_MS = 250
/** ~8KB of DECODED text (chars, not wire bytes) — SSE payloads are overwhelmingly ASCII, so the two roughly coincide in practice. */
const SSE_EMIT_CHAR_THRESHOLD = 8 * 1024
/** Rolling tail window kept once the cap is crossed — the final events survive here however long the stream runs. */
const SSE_TAIL_CHARS = 8 * 1024
/**
 * Hard ceiling on decoded chars past the cap before the reader is cancelled. Keeps a
 * never-ending stream (heartbeats, a runaway producer) bounded in CPU and update count,
 * the same discipline readCappedBody's cancel-at-cap provides — just deferred so real
 * streams that DO end can hand over their terminal events first.
 */
const SSE_TAIL_DRAIN_LIMIT = 4 * 1024 * 1024

/** SSE records are delimited by a blank line — the boundary `joinedText` trims prefix/tail to. */
const EVENT_BOUNDARY = '\n\n'

export interface SseCaptureUpdate {
  /**
   * Text captured so far. Under the cap this grows up to `maxBodySize`; once `truncated`
   * it is the up-to-cap prefix (trimmed to its last complete event) joined to a bounded
   * tail of the stream's final events — `maxBodySize + SSE_TAIL_CHARS` is the ceiling.
   */
  text: string
  /** Decoded character count seen so far. Exact while the stream is read; a >= lower bound only once the drain ceiling cancels it. */
  size: number
  /** `true` once `maxBodySize` was crossed — the middle of the body was dropped even though head and tail are kept. */
  truncated: boolean
  /** `true` only on the terminal emit (stream closed, errored, or hit the drain ceiling) — exactly one update per capture has `done: true`. */
  done: boolean
}

/** Read `response`'s body stream incrementally, invoking `onUpdate` on the cadence described in docs/concepts/performance.md. `response` MUST be a `.clone()` so the app's own stream is untouched. */
export async function captureSseBody(
  response: Response,
  maxBodySize: number,
  onUpdate: (update: SseCaptureUpdate) => void,
): Promise<void> {
  const stream = response.body
  if (!stream || typeof stream.getReader !== 'function') {
    // No readable stream on this runtime — unlike readCappedBody, falling back to
    // response.text() here would resurrect the "await forever" bug this file exists to avoid.
    // Skip incremental capture entirely; the caller's headers-received record stands in.
    return
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  let truncated = false
  let lastEmitAt = Date.now()
  let charsSinceEmit = 0
  // Tail-mode state — inactive until the cap is crossed.
  let tail = ''
  let drainedPastCap = 0

  // Appends `newText` to the capped prefix until the cap is crossed, then to the rolling
  // tail window instead. Crossing mid-chunk seeds the tail with the chunk's overflow, so
  // no decoded text is ever dropped on the boundary itself.
  const appendChunk = (newText: string): void => {
    if (!newText) return
    if (!truncated) {
      const room = maxBodySize - text.length
      if (newText.length <= room) {
        text += newText
        return
      }
      if (room > 0) text += newText.slice(0, room)
      truncated = true
      const overflow = newText.slice(Math.max(room, 0))
      tail = overflow.length > SSE_TAIL_CHARS ? overflow.slice(-SSE_TAIL_CHARS) : overflow
      drainedPastCap += overflow.length
      return
    }
    tail += newText
    if (tail.length > SSE_TAIL_CHARS) tail = tail.slice(-SSE_TAIL_CHARS)
    drainedPastCap += newText.length
  }

  // Prefix and tail each trimmed to whole-event boundaries (blank-line delimited) and
  // rejoined, so the junction never merges half of one event with half of another. When
  // neither side has a boundary (a stream whose events are individually larger than the
  // windows), the raw concatenation stands — degenerate, but honest.
  const joinedText = (): string => {
    if (!truncated) return text
    const prefixEnd = text.lastIndexOf(EVENT_BOUNDARY)
    const cleanPrefix = prefixEnd === -1 ? text : text.slice(0, prefixEnd)
    const tailStart = tail.indexOf(EVENT_BOUNDARY)
    const cleanTail = tailStart === -1 ? tail : tail.slice(tailStart + EVENT_BOUNDARY.length)
    if (!cleanTail) return cleanPrefix
    if (prefixEnd === -1 && tailStart === -1) return text + tail
    return cleanPrefix + EVENT_BOUNDARY + cleanTail
  }

  const emit = (done: boolean): void => {
    try {
      onUpdate({ text: joinedText(), size, truncated, done })
    } catch {
      // A throwing consumer must not break the (detached) read loop.
    }
    lastEmitAt = Date.now()
    charsSinceEmit = 0
  }

  try {
    for (;;) {
      // Reads are inherently sequential (chunk N before N+1) — cannot be parallelised.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      if (chunk) {
        size += chunk.length
        charsSinceEmit += chunk.length
        appendChunk(chunk)
      }

      if (drainedPastCap > SSE_TAIL_DRAIN_LIMIT) {
        // Past the cap AND past the drain ceiling — a stream that shows no sign of
        // ending. Cancel rather than burn CPU on it forever; the prefix + tail captured
        // so far is everything this capture will ever report.
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel().catch(() => {
          // Best-effort — a stream that's already erroring/closing can reject it.
        })
        break
      }

      if (chunk && (charsSinceEmit >= SSE_EMIT_CHAR_THRESHOLD || Date.now() - lastEmitAt >= SSE_EMIT_INTERVAL_MS)) {
        emit(false)
      }
    }

    // Stream ended — flush any trailing multi-byte remainder the streaming decoder held
    // back. Applies in tail mode too: the remainder may be the usage event's last bytes.
    const tailRemainder = decoder.decode()
    if (tailRemainder) {
      size += tailRemainder.length
      appendChunk(tailRemainder)
    }
  } catch {
    // reader.read() itself threw (mid-stream network error/abort) — end the loop silently;
    // the app's own independent stream branch is untouched.
  } finally {
    reader.releaseLock?.()
  }

  // Terminal emit — always fires exactly once, whichever way the stream ended; the caller's only guarantee of a definitive "final" update.
  emit(true)
}
