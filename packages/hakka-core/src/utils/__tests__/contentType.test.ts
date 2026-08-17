import { describe, expect, test } from 'bun:test'

import { getImageFormat, getImageSource, isBase64Image, isImageResponse, parseContentType } from '../contentType'

describe('parseContentType', () => {
  test('detects JSON with charset param', () => {
    const result = parseContentType('application/json; charset=utf-8')
    expect(result.type).toBe('json')
    expect(result.charset).toBe('utf-8')
    expect(result.isImage).toBe(false)
  })

  test('handles undefined', () => {
    const result = parseContentType(undefined)
    expect(result.type).toBe('unknown')
    expect(result.isImage).toBe(false)
    expect(result.mimeType).toBe('application/octet-stream')
  })
})

describe('isImageResponse — case-insensitive header lookup', () => {
  test('detects lowercase content-type', () => {
    expect(isImageResponse({ 'content-type': 'image/png' })).toBe(true)
  })

  test('detects title-case Content-Type', () => {
    expect(isImageResponse({ 'Content-Type': 'image/jpeg' })).toBe(true)
  })

  test('detects all-caps CONTENT-TYPE', () => {
    expect(isImageResponse({ 'CONTENT-TYPE': 'image/webp' })).toBe(true)
  })

  test('detects mixed-case CONTENT-type', () => {
    expect(isImageResponse({ 'CONTENT-type': 'image/png' })).toBe(true)
  })

  test('returns false for non-image content-type', () => {
    expect(isImageResponse({ 'Content-Type': 'application/json' })).toBe(false)
  })

  test('returns false when no headers', () => {
    expect(isImageResponse(undefined)).toBe(false)
  })

  test('returns false when content-type header absent', () => {
    expect(isImageResponse({ accept: '*/*' })).toBe(false)
  })
})

describe('getImageFormat — case-insensitive header lookup', () => {
  test('returns format from lowercase content-type', () => {
    expect(getImageFormat('https://x.com/img', { 'content-type': 'image/webp' })).toBe('webp')
  })

  test('returns format from mixed-case content-Type', () => {
    expect(getImageFormat('https://x.com/img', { 'content-Type': 'image/webp' })).toBe('webp')
  })

  test('falls back to URL extension when no content-type header', () => {
    expect(getImageFormat('https://x.com/photo.jpg')).toBe('jpg')
    expect(getImageFormat('https://x.com/icon.svg?v=1')).toBe('svg')
  })

  test('returns null when neither header nor URL extension matches', () => {
    expect(getImageFormat('https://x.com/api/data', { 'content-type': 'application/json' })).toBeNull()
  })
})

describe('isBase64Image', () => {
  test('returns false for undefined', () => {
    expect(isBase64Image(undefined)).toBe(false)
  })

  test('returns false for short strings', () => {
    expect(isBase64Image('abc')).toBe(false)
    expect(isBase64Image('iVBORw0KGgo=')).toBe(false)
  })

  test('returns true for data URI prefix', () => {
    expect(isBase64Image('data:image/png;base64,' + 'A'.repeat(100))).toBe(true)
  })

  test('returns true for long valid base64 string', () => {
    // 120 base64 chars — long enough to pass the pattern check
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const longB64 = b64.replace(/=/g, '') + 'A'.repeat(80)
    expect(isBase64Image(longB64)).toBe(true)
  })

  test('returns false for non-base64 content', () => {
    expect(isBase64Image('<html>' + 'x'.repeat(200))).toBe(false)
  })
})

describe('getImageSource', () => {
  test('returns data URI directly when body starts with data:image/', () => {
    const dataUri = 'data:image/png;base64,abc123'
    expect(getImageSource('https://x.com/img', dataUri)).toBe(dataUri)
  })

  test('constructs data URI from base64 body using content-type header format', () => {
    const b64Body = 'A'.repeat(120)
    const result = getImageSource('https://x.com/img.webp', b64Body, { 'content-type': 'image/webp' })
    expect(result).toBe(`data:image/webp;base64,${b64Body}`)
  })

  test('falls back to png format when base64 body has no format clue', () => {
    const b64Body = 'A'.repeat(120)
    const result = getImageSource('https://x.com/api/image', b64Body)
    expect(result).toBe(`data:image/png;base64,${b64Body}`)
  })

  test('returns URL directly when body is plain text', () => {
    expect(getImageSource('https://x.com/img.png', undefined)).toBe('https://x.com/img.png')
  })

  test('returns URL directly when body is not base64', () => {
    expect(getImageSource('https://x.com/img.png', 'short')).toBe('https://x.com/img.png')
  })
})
