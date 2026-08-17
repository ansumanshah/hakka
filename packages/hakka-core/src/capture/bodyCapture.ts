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

/** Serialize an outgoing/incoming body to a capture-safe preview + size. */
export function captureBody(body: unknown): BodyCapture {
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
    try {
      const text = JSON.stringify(body)
      return { preview: text, size: text.length }
    } catch {
      return EMPTY
    }
  }
  const text = String(body)
  return { preview: text, size: text.length }
}

/** Approximate body size only (delegates to captureBody). */
export function computeBodySize(body: unknown): number {
  return captureBody(body).size
}
