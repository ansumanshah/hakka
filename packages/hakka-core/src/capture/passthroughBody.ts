import type { CappedBody } from './readCappedBody'

/**
 * Capture a response body WITHOUT `Response.clone()`.
 *
 * `clone()` tees the body stream, and reading the tee'd branch costs roughly a
 * millisecond of main-thread time per response in Chromium. Here the original body
 * is piped through a pass-through `TransformStream` instead: the caller receives a
 * replacement `Response` backed by the transformed stream, and the transform decodes
 * a capped prefix as the bytes flow by. The readable side has an unbounded queue, so
 * the body is pumped to completion (and captured) even if the app never reads it,
 * the same buffering a tee already implies.
 *
 * Returns `null` when the runtime can't do this safely (no `TransformStream`, no
 * body stream, body already used, or a `Response` that can't be rebuilt). The
 * caller then falls back to the clone-based `readCappedBody` path.
 */
export function capturePassthroughBody(
  response: Response,
  maxBodySize: number,
  onDone: (body: CappedBody) => void,
): Response | null {
  if (typeof TransformStream === 'undefined' || typeof CountQueuingStrategy === 'undefined') return null
  const source = response.body
  if (!source || response.bodyUsed || typeof source.pipeThrough !== 'function') return null
  // Rebuilding must not throw after the source is piped (the app would lose its body): bail out up front on statuses a constructed Response rejects.
  const { status } = response
  if (status < 200 || status > 599 || status === 204 || status === 205 || status === 304) return null

  const identityBytes = declaredIdentityBytes(response)
  const decoder = new TextDecoder()
  let kept = ''
  let size = 0
  let bytes = 0
  let keeping = true
  let settled = false

  const settle = (body: CappedBody) => {
    if (settled) return
    settled = true
    try {
      onDone(body)
    } catch {
      // Capture must never break the app's body stream.
    }
  }

  const finish = () => {
    if (keeping) {
      const tail = decoder.decode()
      if (tail) {
        size += tail.length
        kept += tail
      }
      settle({ preview: kept, size, truncated: false })
    } else {
      // Over the cap: the preview is dropped, size is the best-known lower bound.
      settle({ preview: null, size: identityBytes != null ? Math.max(identityBytes, bytes) : bytes, truncated: true })
    }
  }

  let replacement: Response
  try {
    const transform = new TransformStream<Uint8Array, Uint8Array>(
      {
        transform(chunk, controller) {
          controller.enqueue(chunk)
          try {
            bytes += chunk.byteLength
            if (!keeping) return
            const text = decoder.decode(chunk, { stream: true })
            size += text.length
            if (kept.length + text.length <= maxBodySize) kept += text
            else {
              keeping = false
              kept = ''
            }
          } catch {
            keeping = false
            kept = ''
          }
        },
        flush: finish,
      },
      undefined,
      new CountQueuingStrategy({ highWaterMark: Infinity }),
    )
    replacement = new Response(source.pipeThrough(transform), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
    // `url`, `redirected` and `type` are read-only on a constructed Response; shadow them so the app sees the real values.
    for (const key of ['url', 'redirected', 'type'] as const) {
      Object.defineProperty(replacement, key, { value: response[key], configurable: true })
    }
  } catch {
    return null
  }
  return replacement
}

function declaredIdentityBytes(response: Response): number | null {
  const encoding = response.headers.get('content-encoding')
  if (encoding != null && encoding !== '' && encoding.toLowerCase() !== 'identity') return null
  const contentLength = response.headers.get('content-length')
  if (contentLength == null) return null
  const n = Number(contentLength)
  return Number.isFinite(n) && n >= 0 ? n : null
}
