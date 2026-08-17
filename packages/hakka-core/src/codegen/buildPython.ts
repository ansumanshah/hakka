import type { NetworkRequest } from '../model/types'
import { pySingleQuote } from './escaping'

/** Build a Python `requests` snippet. */
export const buildPython = (r: NetworkRequest): string => {
  const lines: string[] = []
  const hasHeaders = r.requestHeaders != null && Object.keys(r.requestHeaders).length > 0
  const hasBody = Boolean(r.requestBody)

  lines.push('import requests')
  lines.push('')

  if (hasHeaders) {
    lines.push('headers = {')
    for (const [k, v] of Object.entries(r.requestHeaders ?? {})) {
      lines.push(`    ${pySingleQuote(k)}: ${pySingleQuote(v)},`)
    }
    lines.push('}')
  }

  if (hasBody) {
    const body = r.requestBody ?? ''
    // JSON bodies keep the raw string in `data=` deliberately — converting to a
    // Python dict would need true/false/null -> True/False/None rewriting, and a
    // verbatim string round-trips exactly what was captured.
    lines.push(`data = ${pySingleQuote(body)}`)
  }

  const method = r.method.toLowerCase()
  const args: string[] = [pySingleQuote(r.url)]
  if (hasHeaders) args.push('headers=headers')
  if (hasBody) args.push('data=data')

  lines.push('')
  lines.push(`response = requests.${method}(${args.join(', ')})`)
  lines.push('print(response.status_code, response.text)')

  return lines.join('\n')
}
