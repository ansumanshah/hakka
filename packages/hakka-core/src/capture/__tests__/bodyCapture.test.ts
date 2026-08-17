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
