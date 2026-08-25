/**
 * Capture a request/response body as a string preview + size, WITHOUT consuming
 * or corrupting non-string body types. `String(body)` turns a FormData / Blob /
 * ArrayBuffer / TypedArray into a useless `[object FormData]` and reports a wrong
 * size; a ReadableStream must never be read here or the real request breaks.
 */

export interface BodyCapture {
  /** A string preview for the inspector, or null when the body can't be previewed (e.g. a stream). */
  preview: string | null
  /** Byte size for binary bodies; character length for text bodies (a fast approximation). */
  size: number
}

const EMPTY: BodyCapture = { preview: null, size: 0 }

function hasType<T>(name: string, value: unknown): value is T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = (globalThis as any)[name]
  return typeof ctor === 'function' && value instanceof ctor
}

/** Thrown from inside `JSON.stringify`'s replacer to unwind serialization early — see `stringifyObjectBody`. */
const OVER_MAX_BODY_SIZE = Symbol('over-max-body-size')

/**
 * `JSON.stringify` an object body, bailing out early once the output is already guaranteed to
 * exceed `maxBodySize` instead of paying for the full serialization of a preview the caller is
 * about to discard anyway (the caller keeps `preview` only when `size <= maxBodySize`). The
 * replacer is invoked in the same depth-first order `JSON.stringify` writes output in, so
 * throwing from it aborts serialization at that point.
 *
 * The running total only counts string VALUE lengths (not keys, quotes, or structural
 * punctuation), so it's a strict lower bound of the true serialized size — the bail-out only
 * ever fires once truly over the cap, never falsely early. On bail-out, `size` is that lower
 * bound, not an exact count — acceptable because a body over the cap never has its size shown
 * precisely to begin with (callers already null out the preview at that point).
 */
function stringifyObjectBody(body: object, maxBodySize: number): BodyCapture {
  let runningSize = 0
  try {
    const text = JSON.stringify(body, (_key, value) => {
      if (typeof value === 'string') runningSize += value.length
      if (runningSize > maxBodySize) throw OVER_MAX_BODY_SIZE
      return value
    })
    return { preview: text, size: text.length }
  } catch (e) {
    if (e === OVER_MAX_BODY_SIZE) return { preview: null, size: runningSize }
    return EMPTY
  }
}

/** Serialize an outgoing/incoming body to a capture-safe preview + size. */
export function captureBody(body: unknown, maxBodySize: number = Number.POSITIVE_INFINITY): BodyCapture {
  if (body == null) return EMPTY
  if (typeof body === 'string') return { preview: body, size: body.length }

  if (hasType<URLSearchParams>('URLSearchParams', body)) {
    const text = (body as URLSearchParams).toString()
    return { preview: text, size: text.length }
  }
  if (hasType<Blob>('Blob', body)) {
    const blob = body as Blob
    return { preview: `(blob: ${blob.size} bytes${blob.type ? `, ${blob.type}` : ''})`, size: blob.size }
  }
  if (body instanceof ArrayBuffer) {
    return { preview: `(arraybuffer: ${body.byteLength} bytes)`, size: body.byteLength }
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    const name = view.constructor?.name ?? 'arraybufferview'
    return { preview: `(${name}: ${view.byteLength} bytes)`, size: view.byteLength }
  }
  if (hasType<FormData>('FormData', body)) {
    // Set dedups in O(1) per key instead of an O(m) `includes` scan per entry — O(m²) for m fields.
    const keys = new Set<string>()
    ;(body as FormData).forEach((_value, key) => {
      keys.add(key)
    })
    return { preview: `(formdata: ${[...keys].join(', ')})`, size: 0 }
  }
  if (hasType<ReadableStream>('ReadableStream', body)) {
    return EMPTY // do not consume the stream
  }
  if (typeof body === 'object') {
    return stringifyObjectBody(body, maxBodySize)
  }
  const text = String(body)
  return { preview: text, size: text.length }
}

/** Approximate body size only (delegates to captureBody). */
export function computeBodySize(body: unknown): number {
  return captureBody(body).size
}
