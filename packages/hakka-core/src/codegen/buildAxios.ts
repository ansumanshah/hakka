import type { NetworkRequest } from '../model/types'
import { jsSingleQuote, looksLikeJson } from './escaping'

/** Build an axios (`axios(config)`) snippet. */
export const buildAxios = (r: NetworkRequest): string => {
  const lines: string[] = []
  const hasHeaders = r.requestHeaders != null && Object.keys(r.requestHeaders).length > 0
  const hasBody = Boolean(r.requestBody)

  lines.push('axios({')
  lines.push(`  method: ${jsSingleQuote(r.method.toLowerCase())},`)
  lines.push(`  url: ${jsSingleQuote(r.url)},`)

  if (hasHeaders) {
    lines.push('  headers: {')
    for (const [k, v] of Object.entries(r.requestHeaders ?? {})) {
      lines.push(`    ${jsSingleQuote(k)}: ${jsSingleQuote(v)},`)
    }
    lines.push('  },')
  }

  if (hasBody) {
    const body = r.requestBody ?? ''
    // Inline valid-looking JSON as a literal object; otherwise pass the raw string.
    lines.push(looksLikeJson(body) ? `  data: ${body},` : `  data: ${jsSingleQuote(body)},`)
  }

  lines.push('})')
  return lines.join('\n')
}
