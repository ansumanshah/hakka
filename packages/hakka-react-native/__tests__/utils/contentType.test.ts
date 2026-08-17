import { parseContentType, getImageFormat } from 'hakka-core'

describe('parseContentType', () => {
  it('parses XML content type', () => {
    expect(parseContentType('application/xml').type).toBe('xml')
    expect(parseContentType('text/xml').type).toBe('xml')
  })

  it('parses HTML content type', () => {
    expect(parseContentType('text/html').type).toBe('html')
  })

  it('parses plain text', () => {
    expect(parseContentType('text/plain').type).toBe('text')
  })

  it('parses PNG image', () => {
    const result = parseContentType('image/png')
    expect(result.type).toBe('image')
    expect(result.isImage).toBe(true)
    expect(result.imageFormat).toBe('png')
  })

  it('parses JPEG image', () => {
    const result = parseContentType('image/jpeg')
    expect(result.type).toBe('image')
    expect(result.isImage).toBe(true)
    expect(result.imageFormat).toBe('jpeg')
  })

  it('parses SVG image', () => {
    const result = parseContentType('image/svg+xml')
    expect(result.type).toBe('image')
    expect(result.isImage).toBe(true)
    expect(result.imageFormat).toBe('svg')
  })

  it('parses binary / octet-stream', () => {
    expect(parseContentType('application/octet-stream').type).toBe('binary')
  })

  it('parses PDF as binary', () => {
    expect(parseContentType('application/pdf').type).toBe('binary')
  })

  it('handles unknown types', () => {
    expect(parseContentType('application/vnd.custom').type).toBe('unknown')
  })
})

describe('getImageFormat', () => {
  it('falls back to URL extension', () => {
    expect(getImageFormat('https://example.com/photo.jpg')).toBe('jpg')
    expect(getImageFormat('https://example.com/icon.png')).toBe('png')
    expect(getImageFormat('https://example.com/image.webp?v=1')).toBe('webp')
  })

  it('returns null for non-image URL with no content-type', () => {
    expect(getImageFormat('https://example.com/api/data')).toBeNull()
  })
})
