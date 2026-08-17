/**
 * Cookie parsing utilities for request/response headers.
 * Pure functions — no React imports, safe to use in tests.
 */

export interface ParsedCookie {
  name: string
  value: string
  attributes?: string
}

/**
 * Parse request Cookie header: "name=value; name2=value2"
 */
export function parseRequestCookies(raw: string): ParsedCookie[] {
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq === -1) return { name: pair, value: '' }
      return {
        name: pair.substring(0, eq).trim(),
        value: pair.substring(eq + 1).trim(),
      }
    })
}

/**
 * Parse a single Set-Cookie directive: "name=value; Path=/; HttpOnly"
 * Returns the name, value, and raw attribute string.
 */
export function parseSetCookieDirective(directive: string): ParsedCookie {
  const parts = directive.split(';')
  const first = parts[0] ?? ''
  const eq = first.indexOf('=')
  const name = eq === -1 ? first.trim() : first.substring(0, eq).trim()
  const value = eq === -1 ? '' : first.substring(eq + 1).trim()
  const attributes = parts
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('; ')
  return { name, value, attributes: attributes || undefined }
}

/**
 * Extract Set-Cookie values from a headers object.
 * Native fetch/XHR sometimes joins multiple Set-Cookie values with ", " in a
 * single header string. We split on ", " but are careful not to split cookie
 * values that legitimately contain commas (e.g. date strings in Expires=).
 *
 * Simple heuristic: split on ", " only when the next token looks like a new
 * cookie assignment (contains "=") or a known attribute keyword.
 */
export function extractSetCookieValues(headers: Record<string, string>): string[] {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'set-cookie')
  if (!key) return []
  const raw = headers[key]
  if (!raw) return []

  if (!raw.includes(',')) return [raw]

  const directives: string[] = []
  let current = ''
  const segments = raw.split(', ')
  for (const segment of segments) {
    if (current === '') {
      current = segment
    } else if (segment.includes('=') && !segment.startsWith('Expires') && !segment.startsWith('expires')) {
      directives.push(current)
      current = segment
    } else {
      current = `${current}, ${segment}`
    }
  }
  if (current) directives.push(current)
  return directives
}

export function parseCookies(
  headers: Record<string, string> | null | undefined,
  type: 'request' | 'response',
): ParsedCookie[] {
  if (!headers) return []

  if (type === 'request') {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'cookie')
    if (!key) return []
    const raw = headers[key]
    if (!raw) return []
    return parseRequestCookies(raw)
  }

  const directives = extractSetCookieValues(headers)
  return directives.map(parseSetCookieDirective)
}
