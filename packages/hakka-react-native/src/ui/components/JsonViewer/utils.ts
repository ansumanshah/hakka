import { Share } from 'react-native'

export const copyToClipboard = (text: string) => {
  Share.share({ message: text }).catch(() => {})
}

export const parseJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    if (data === '[object Object]') {
      return {}
    }

    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }

  if (data && typeof data === 'object') {
    return data
  }

  return data
}

export const formatJsonString = (data: unknown): string => {
  const parsed = parseJson(data)

  if (typeof parsed === 'string' && parsed === '[object Object]') {
    return '{}'
  }

  try {
    return JSON.stringify(parsed, null, 2)
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('circular')) {
      return '// Circular reference detected\n{}'
    }
    return String(parsed)
  }
}

export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const getItemCount = (value: unknown): { count: number; label: string } => {
  if (Array.isArray(value)) {
    const count = value.length
    return { count, label: count === 1 ? 'item' : 'items' }
  }
  if (value && typeof value === 'object') {
    const count = Object.keys(value).length
    return { count, label: count === 1 ? 'key' : 'keys' }
  }
  return { count: 0, label: 'items' }
}
