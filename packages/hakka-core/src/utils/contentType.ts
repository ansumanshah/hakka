type ContentType = 'json' | 'xml' | 'html' | 'text' | 'image' | 'binary' | 'unknown'

export interface ParsedContentType {
  type: ContentType
  mimeType: string
  charset?: string
  isImage: boolean
  imageFormat?: 'png' | 'jpg' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'bmp' | 'ico'
}

export const parseContentType = (contentType?: string): ParsedContentType => {
  if (!contentType) {
    return {
      type: 'unknown',
      mimeType: 'application/octet-stream',
      isImage: false,
    }
  }

  const lower = contentType.toLowerCase()
  const parts = lower.split(';').map((p) => p.trim())
  const mimeType = parts[0] || 'application/octet-stream'
  const charset = parts.find((p) => p.startsWith('charset='))?.split('=')[1]

  if (mimeType.startsWith('image/')) {
    const format = mimeType.split('/')[1]?.split('+')[0] as ParsedContentType['imageFormat']
    return {
      type: 'image',
      mimeType,
      charset,
      isImage: true,
      imageFormat: format,
    }
  }

  if (mimeType.includes('json')) {
    return { type: 'json', mimeType, charset, isImage: false }
  }

  if (mimeType.includes('xml')) {
    return { type: 'xml', mimeType, charset, isImage: false }
  }

  if (mimeType.includes('html')) {
    return { type: 'html', mimeType, charset, isImage: false }
  }

  if (mimeType.startsWith('text/')) {
    return { type: 'text', mimeType, charset, isImage: false }
  }

  if (
    mimeType.includes('octet-stream') ||
    mimeType.includes('binary') ||
    mimeType.includes('zip') ||
    mimeType.includes('pdf')
  ) {
    return { type: 'binary', mimeType, charset, isImage: false }
  }

  return { type: 'unknown', mimeType, charset, isImage: false }
}

export const isImageResponse = (headers?: Record<string, string>): boolean => {
  if (!headers) return false

  const contentType = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1]

  if (!contentType) return false

  return parseContentType(contentType).isImage
}

export const getImageFormat = (url: string, headers?: Record<string, string>): string | null => {
  if (headers) {
    const contentTypeValue = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
    const parsed = parseContentType(contentTypeValue)
    if (parsed.imageFormat) return parsed.imageFormat
  }

  const match = url.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)(?:\?|$)/i)
  return match?.[1]?.toLowerCase() || null
}

export const isBase64Image = (body?: string): boolean => {
  if (!body || body.length < 100) return false

  if (body.startsWith('data:image/')) return true

  const base64Pattern = /^[A-Za-z0-9+/]{100,}={0,2}$/
  return base64Pattern.test(body.substring(0, 200))
}

export const getImageSource = (url: string, body?: string, headers?: Record<string, string>): string | null => {
  if (body?.startsWith('data:image/')) {
    return body
  }

  if (body && isBase64Image(body)) {
    const format = getImageFormat(url, headers) || 'png'
    return `data:image/${format};base64,${body}`
  }

  return url
}
