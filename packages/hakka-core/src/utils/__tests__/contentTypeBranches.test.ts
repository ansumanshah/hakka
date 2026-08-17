import { describe, expect, test } from 'bun:test'

import { parseContentType } from '../contentType'

// Covers parseContentType branches not already exercised in contentType.test.ts: xml, html, text, image (incl. '+xml' suffix-stripping), binary, and the unknown fallback for a real mime type.

describe('parseContentType — xml', () => {
  test('application/xml is classified as xml', () => {
    const result = parseContentType('application/xml; charset=utf-8')
    expect(result.type).toBe('xml')
    expect(result.mimeType).toBe('application/xml')
    expect(result.charset).toBe('utf-8')
    expect(result.isImage).toBe(false)
  })

  test('text/xml is also classified as xml (mimeType.includes("xml") wins before the text/ check)', () => {
    expect(parseContentType('text/xml').type).toBe('xml')
  })
})

describe('parseContentType — html', () => {
  test('text/html is classified as html', () => {
    const result = parseContentType('text/html; charset=utf-8')
    expect(result.type).toBe('html')
    expect(result.charset).toBe('utf-8')
    expect(result.isImage).toBe(false)
  })
})

describe('parseContentType — text', () => {
  test('text/plain is classified as text', () => {
    const result = parseContentType('text/plain')
    expect(result.type).toBe('text')
    expect(result.isImage).toBe(false)
  })
})

describe('parseContentType — image (multiple formats)', () => {
  test('image/png -> type image, format png', () => {
    const result = parseContentType('image/png')
    expect(result.type).toBe('image')
    expect(result.isImage).toBe(true)
    expect(result.imageFormat).toBe('png')
  })

  test('image/svg+xml -> type image, format svg (the "+xml" suffix is stripped)', () => {
    const result = parseContentType('image/svg+xml')
    expect(result.type).toBe('image')
    expect(result.isImage).toBe(true)
    expect(result.imageFormat).toBe('svg')
  })
})

describe('parseContentType — binary', () => {
  test('application/octet-stream is classified as binary', () => {
    expect(parseContentType('application/octet-stream').type).toBe('binary')
  })

  test('application/zip is classified as binary', () => {
    expect(parseContentType('application/zip').type).toBe('binary')
  })

  test('application/pdf is classified as binary', () => {
    expect(parseContentType('application/pdf').type).toBe('binary')
  })
})

describe('parseContentType — unknown (falls through every named branch)', () => {
  test('a real, non-empty mime type matching none of the known categories is "unknown"', () => {
    const result = parseContentType('application/x-protobuf')
    expect(result.type).toBe('unknown')
    expect(result.mimeType).toBe('application/x-protobuf')
    expect(result.isImage).toBe(false)
  })
})
