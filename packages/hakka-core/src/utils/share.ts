import { shellSingleQuote } from '../codegen/escaping'
import type { NetworkRequest } from '../model/types'

/**
 * True when the response used gzip/br/deflate Content-Encoding (curl needs --compressed
 * to decompress). Checks ONLY the response header — the request Accept-Encoding is
 * already emitted verbatim as a -H flag and must not also trigger --compressed.
 */
function needsCompressedFlag(r: NetworkRequest): boolean {
  const COMPRESSED_RE = /\b(gzip|br|deflate)\b/i
  const responseEncoding = r.responseHeaders?.['Content-Encoding'] ?? r.responseHeaders?.['content-encoding']
  return responseEncoding != null && COMPRESSED_RE.test(responseEncoding)
}

/** Decode a Base64 Basic-auth credential into "user:pass", or null if malformed. */
function decodeBasicAuth(value: string): string | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value.trim())
  if (!match) return null
  try {
    return atob(match[1])
  } catch {
    return null
  }
}

/**
 * Build a cURL command from a request. Every value is single-quoted (embedded quotes
 * escaped as '\'') so header values and bodies can't break out of their argument.
 */
export const buildCurl = (r: NetworkRequest): string => {
  const parts: string[] = ['curl', '-X', r.method, shellSingleQuote(r.url)]

  if (r.requestHeaders) {
    for (const [k, v] of Object.entries(r.requestHeaders)) {
      if (k.toLowerCase() === 'authorization') {
        const creds = decodeBasicAuth(v)
        if (creds !== null) {
          parts.push('-u', shellSingleQuote(creds))
        }
      }
      parts.push('-H', shellSingleQuote(`${k}: ${v}`))
    }
  }

  if (r.requestBody) {
    parts.push('--data-binary', shellSingleQuote(r.requestBody))
  }

  if (needsCompressedFlag(r)) {
    parts.push('--compressed')
  }

  return parts.join(' ')
}
