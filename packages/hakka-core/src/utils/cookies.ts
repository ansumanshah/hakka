/**
 * Cookie parsing utilities — platform-neutral, no DOM/browser deps.
 */

export interface ParsedCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  maxAge?: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/** Parse a `Cookie:` request header into name/value pairs (split on `;`, first `=`). */
export function parseRequestCookies(cookieHeader: string | undefined): Array<{ name: string; value: string }> {
  if (!cookieHeader) return []
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const idx = part.indexOf('=')
      if (idx === -1) return { name: part, value: '' }
      return {
        name: part.slice(0, idx).trim(),
        value: part.slice(idx + 1).trim(),
      }
    })
}

/**
 * Parse one or more `Set-Cookie` header values (string, newline-joined string, or
 * array) into `ParsedCookie` objects. Attribute keys are matched case-insensitively.
 */
export function parseSetCookie(setCookie: string | string[] | undefined): ParsedCookie[] {
  if (!setCookie) return []

  let lines: string[]
  if (Array.isArray(setCookie)) {
    lines = setCookie
  } else {
    // Only `\n` is split on — comma-splitting would break on `Expires` (e.g. "Thu, 01 Jan …").
    lines = setCookie
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  }

  return lines.map((line) => parseSingleSetCookie(line))
}

function parseSingleSetCookie(line: string): ParsedCookie {
  const parts = line.split(';')
  const [rawNameVal, ...attrParts] = parts

  const eqIdx = (rawNameVal ?? '').indexOf('=')
  const name = eqIdx === -1 ? (rawNameVal ?? '').trim() : rawNameVal!.slice(0, eqIdx).trim()
  const value = eqIdx === -1 ? '' : rawNameVal!.slice(eqIdx + 1).trim()

  const cookie: ParsedCookie = {
    name,
    value,
    httpOnly: false,
    secure: false,
  }

  for (const attr of attrParts) {
    const trimmed = attr.trim()
    if (!trimmed) continue

    const attrEq = trimmed.indexOf('=')
    const attrKey = (attrEq === -1 ? trimmed : trimmed.slice(0, attrEq)).trim().toLowerCase()
    const attrVal = attrEq === -1 ? '' : trimmed.slice(attrEq + 1).trim()

    switch (attrKey) {
      case 'domain':
        cookie.domain = attrVal
        break
      case 'path':
        cookie.path = attrVal
        break
      case 'expires':
        cookie.expires = attrVal
        break
      case 'max-age': {
        const n = Number(attrVal)
        if (!Number.isNaN(n)) cookie.maxAge = n
        break
      }
      case 'httponly':
        cookie.httpOnly = true
        break
      case 'secure':
        cookie.secure = true
        break
      case 'samesite':
        if (attrVal === 'Strict' || attrVal === 'Lax' || attrVal === 'None') {
          cookie.sameSite = attrVal
        } else {
          const lower = attrVal.toLowerCase()
          if (lower === 'strict') cookie.sameSite = 'Strict'
          else if (lower === 'lax') cookie.sameSite = 'Lax'
          else if (lower === 'none') cookie.sameSite = 'None'
        }
        break
    }
  }

  return cookie
}
