/**
 * Incrementally capture an SSE (`text/event-stream`) response body — see
 * docs/concepts/performance.md for the full algorithm and emit cadence. Diverges from
 * readCappedBody: an over-cap capture KEEPS the up-to-cap prefix instead of nulling it out,
 * since a live token stream's partial transcript is still useful. Fails open throughout — a
 * throwing `onUpdate` or a reader error never breaks the caller's own untouched stream.
 */

const SSE_EMIT_INTERVAL_MS = 250
/** ~8KB of DECODED text (chars, not wire bytes) — SSE payloads are overwhelmingly ASCII, so the two roughly coincide in practice. */
const SSE_EMIT_CHAR_THRESHOLD = 8 * 1024

export interface SseCaptureUpdate {
  /** Text captured so far. Bounded to `maxBodySize` — stops growing at the cap by design (see file header). */
  text: string
  /** Decoded character count seen so far. Exact until the cap is crossed; best-known (>= maxBodySize) once `truncated` is true, same "decoded-so-far" semantics as readCappedBody. */
  size: number
  /** `true` once `maxBodySize` was crossed and the clone's reader was cancelled. */
  truncated: boolean
  /** `true` only on the terminal emit (stream closed, errored, or hit the cap) — exactly one update per capture has `done: true`. */
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

  // Appends `newText` up to the remaining cap room; once room hits zero marks `truncated` and stops appending.
  const appendCapped = (newText: string): void => {
    if (truncated || !newText) return
    const room = maxBodySize - text.length
    if (newText.length <= room) {
      text += newText
    } else {
      if (room > 0) text += newText.slice(0, room)
      truncated = true
    }
  }

  const emit = (done: boolean): void => {
    try {
      onUpdate({ text, size, truncated, done })
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
        appendCapped(chunk)
      }

      if (truncated) {
        // Cap crossed — cancel rather than keep pulling chunks we'd throw away; this bounds
        // an infinite stream (a token stream that never closes) to constant memory/CPU.
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

    if (!truncated) {
      // Stream ended within the cap — flush any trailing multi-byte remainder the streaming decoder held back.
      const tail = decoder.decode()
      if (tail) {
        size += tail.length
        appendCapped(tail)
      }
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
