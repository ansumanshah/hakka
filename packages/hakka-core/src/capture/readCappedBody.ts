/**
 * Read a Response body for capture, allocating at most `maxBodySize` characters of string
 * regardless of how much larger the real body is — full algorithm in
 * docs/concepts/performance.md (identity fast-path, stream cancel-at-cap, Content-Length
 * trust rules). `response` here is always the `.clone()` branch of a tee, safe to cancel —
 * the app's own branch reads independently. Falls back to `response.text()` (always exact,
 * never truncated) when the runtime exposes no readable body stream.
 */
export interface CappedBody {
  /** The decoded body, or `null` when it exceeds `maxBodySize`. */
  preview: string | null
  /**
   * Decoded character length. Exact when `truncated` is `false`; best-known
   * (>= maxBodySize, exact only if Content-Length was usable) when `true`.
   */
  size: number
  /**
   * `true` when the cap was crossed and reading was cancelled early — the
   * signal to callers that `size` may be an estimate, not an exact length.
   */
  truncated: boolean
}

/** Fast path for an identity-encoded body ≤ maxBodySize bytes — bounded by construction (see docs/concepts/performance.md), so native `.text()` is safe and far cheaper than the manual stream loop. */
function declaredIdentityBytes(response: Response): number | null {
  const encoding = response.headers.get('content-encoding')
  if (encoding != null && encoding !== '' && encoding.toLowerCase() !== 'identity') return null
  const contentLength = response.headers.get('content-length')
  if (contentLength == null) return null
  const n = Number(contentLength)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export async function readCappedBody(response: Response, maxBodySize: number): Promise<CappedBody> {
  const declared = declaredIdentityBytes(response)
  if (declared != null && declared <= maxBodySize) {
    const text = await response.text()
    // Trust the actual decoded length over the header — a service worker or test stub can respond with a mismatched Content-Length.
    return { preview: text.length <= maxBodySize ? text : null, size: text.length, truncated: false }
  }

  const stream = response.body
  if (!stream || typeof stream.getReader !== 'function') {
    // No readable stream on this runtime (some RN fetch implementations) — no reader to cancel, so this path always reads to completion.
    const text = await response.text()
    return { preview: text.length <= maxBodySize ? text : null, size: text.length, truncated: false }
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let kept = ''
  // Stop appending to `kept` once it would exceed the cap; the stream is then cancelled
  // instead of drained, so `size` stops advancing past that point.
  let keeping = true

  try {
    for (;;) {
      // Reads are inherently sequential (chunk N before N+1) — cannot be parallelised.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      if (chunk) {
        size += chunk.length
        if (keeping) {
          if (kept.length + chunk.length <= maxBodySize) kept += chunk
          else {
            keeping = false
            kept = '' // release the partial prefix — an over-cap body is stored as null
          }
        }
      }

      if (!keeping) {
        // Over the cap — cancel rather than keep pulling chunks that would be thrown away;
        // this bounds CPU cost regardless of the real body's size.
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel().catch(() => {
          // Cancel is best-effort — a stream already erroring/closing can reject it; bail out either way.
        })
        break
      }
    }

    if (keeping) {
      // Finished within the cap — flush any trailing multi-byte remainder the streaming decoder held back.
      const tail = decoder.decode()
      if (tail) {
        size += tail.length
        kept += tail
      }
    }
  } finally {
    reader.releaseLock?.()
  }

  const truncated = !keeping
  let finalSize = size
  if (truncated) {
    // Prefer the server-declared byte count over the partial decode count, but only for an
    // unencoded body — a gzip/br response's Content-Length is compressed wire bytes, not
    // decoded text, so trusting it there could report an absurd "truncated at 100, total 40".
    // max() keeps the value a true lower bound even if a server lies about identity encoding.
    const declaredBytes = declaredIdentityBytes(response)
    if (declaredBytes != null) finalSize = Math.max(declaredBytes, size)
  }

  return { preview: truncated ? null : kept, size: finalSize, truncated }
}
