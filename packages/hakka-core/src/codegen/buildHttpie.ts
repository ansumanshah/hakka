import type { NetworkRequest } from '../model/types'
import { shellSingleQuote } from './escaping'

/**
 * Build an HTTPie CLI snippet (`http METHOD url header:value ... body`).
 * Shell-safe: every argument is single-quoted, matching buildCurl's conventions.
 */
export const buildHttpie = (r: NetworkRequest): string => {
  const parts: string[] = ['http', '-v', r.method, shellSingleQuote(r.url)]

  if (r.requestHeaders) {
    for (const [k, v] of Object.entries(r.requestHeaders)) {
      parts.push(shellSingleQuote(`${k}:${v}`))
    }
  }

  if (r.requestBody) {
    // HTTPie reads raw body from stdin via --raw; keeps arbitrary (non-JSON) bodies intact.
    parts.push('--raw', shellSingleQuote(r.requestBody))
  }

  return parts.join(' ')
}
