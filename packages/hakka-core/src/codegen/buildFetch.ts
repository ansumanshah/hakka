import type { NetworkRequest } from '../model/types'
import { jsSingleQuote } from './escaping'

/** Builds a browser/Node `fetch()` snippet. Body is a quoted string literal, not an object literal, since only the already-serialized body string is available here. */
export const buildFetch = (r: NetworkRequest): string => {
  const lines: string[] = []
  const hasHeaders = r.requestHeaders != null && Object.keys(r.requestHeaders).length > 0
  const hasBody = Boolean(r.requestBody)

  lines.push(`fetch(${jsSingleQuote(r.url)}, {`)
  lines.push(`  method: ${jsSingleQuote(r.method)},`)

  if (hasHeaders) {
    lines.push('  headers: {')
    for (const [k, v] of Object.entries(r.requestHeaders ?? {})) {
      lines.push(`    ${jsSingleQuote(k)}: ${jsSingleQuote(v)},`)
    }
    lines.push('  },')
  }

  if (hasBody) {
    lines.push(`  body: ${jsSingleQuote(r.requestBody ?? '')},`)
  }

  lines.push('})')
  return lines.join('\n')
}
