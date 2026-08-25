import { describe, expect, test } from 'bun:test'

import { captureBody, computeBodySize } from '../bodyCapture'

describe('captureBody — no corruption of non-string bodies', () => {
  test('null / undefined → empty', () => {
    expect(captureBody(null)).toEqual({ preview: null, size: 0 })
    expect(captureBody(undefined)).toEqual({ preview: null, size: 0 })
  })

  test('string passes through with char length', () => {
    expect(captureBody('hello')).toEqual({ preview: 'hello', size: 5 })
  })

  test('URLSearchParams → query string', () => {
    const c = captureBody(new URLSearchParams({ a: '1', b: '2' }))
    expect(c.preview).toBe('a=1&b=2')
  })

  test('Blob → descriptor with real byte size and type', () => {
    const c = captureBody(new Blob(['abcde'], { type: 'text/plain' }))
    expect(c.size).toBe(5)
    expect(c.preview).toContain('blob: 5 bytes')
    expect(c.preview).toContain('text/plain')
  })

  test('ArrayBuffer → descriptor, not [object ArrayBuffer]', () => {
    const c = captureBody(new Uint8Array([1, 2, 3]).buffer)
    expect(c).toEqual({ preview: '(arraybuffer: 3 bytes)', size: 3 })
  })

  test('TypedArray → named descriptor with byteLength', () => {
    const c = captureBody(new Uint8Array([1, 2, 3]))
    expect(c.size).toBe(3)
    expect(c.preview).toContain('Uint8Array: 3 bytes')
  })

  test('FormData → key list, never [object FormData]', () => {
    const fd = new FormData()
    fd.append('name', 'ada')
    fd.append('file', 'x')
    const c = captureBody(fd)
    expect(c.preview).toContain('formdata:')
    expect(c.preview).toContain('name')
    expect(c.preview).not.toContain('[object')
  })

  test('ReadableStream → never consumed (null preview)', () => {
    expect(captureBody(new ReadableStream())).toEqual({ preview: null, size: 0 })
  })

  test('plain object → JSON', () => {
    expect(captureBody({ a: 1 }).preview).toBe('{"a":1}')
  })

  test('computeBodySize delegates to captureBody', () => {
    expect(computeBodySize('abcd')).toBe(4)
    expect(computeBodySize(new Uint8Array([1, 2, 3, 4]).buffer)).toBe(4)
  })
})

describe('captureBody — maxBodySize short-circuits object serialization', () => {
  test('an object body under maxBodySize is still returned with an exact preview + size', () => {
    const c = captureBody({ a: 1, b: 'hello' }, 1000)
    expect(c.preview).toBe('{"a":1,"b":"hello"}')
    expect(c.size).toBe(c.preview!.length)
  })

  test('an object body over maxBodySize is dropped (preview null) without a full stringify', () => {
    const big = { data: 'x'.repeat(10_000) }
    const c = captureBody(big, 100)
    expect(c.preview).toBeNull()
    // The bailed-out size is a lower bound (string-value lengths only), not the exact
    // serialized size — but it must still clearly exceed the cap the caller checks against.
    expect(c.size).toBeGreaterThan(100)
  })

  test('no maxBodySize argument behaves exactly as before (unbounded)', () => {
    const c = captureBody({ a: 1 })
    expect(c.preview).toBe('{"a":1}')
    expect(c.size).toBe(7)
  })

  test('a circular object still falls back to empty, not a crash', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    expect(captureBody(circular, 1000)).toEqual({ preview: null, size: 0 })
  })
})
