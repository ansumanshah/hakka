/**
 * URL parsing for display — host, path, and security status.
 *
 * Hand-rolled on purpose: must NOT go through the ambient `URL` constructor,
 * which is a broken regex stub on React Native (see docs/concepts/url-parsing.md).
 * One deliberate difference from WHATWG: dot segments are NOT collapsed, so the
 * path shown is the path the client actually put on the wire.
 */

// scheme :// authority path? query?  — authority stops at the first / ? #, so
// an `@` in the path can never be mistaken for userinfo.
const ABSOLUTE_URL = /^([a-zA-Z][a-zA-Z\d+\-.]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/

const DEFAULT_PORT: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
}

const SECURE_PROTOCOLS = new Set(['https:', 'wss:'])

/** Strip userinfo, lowercase the hostname, drop the scheme's default port. */
function normalizeHost(authority: string, protocol: string): string {
  const at = authority.lastIndexOf('@')
  const hostPort = at === -1 ? authority : authority.slice(at + 1)
  if (!hostPort) return ''

  // IPv6 literals keep their brackets and may contain colons of their own, so
  // the port separator is the colon *after* the closing bracket.
  const closingBracket = hostPort.startsWith('[') ? hostPort.indexOf(']') : -1
  const colon = hostPort.indexOf(':', closingBracket + 1)
  const hostname = (colon === -1 ? hostPort : hostPort.slice(0, colon)).toLowerCase()
  const port = colon === -1 ? '' : hostPort.slice(colon + 1)

  if (!port || port === DEFAULT_PORT[protocol]) return hostname
  return `${hostname}:${port}`
}

export const parseUrl = (urlString: string) => {
  const match = ABSOLUTE_URL.exec(urlString)
  if (!match) return { protocol: '', host: '', path: urlString, isSecure: false }

  const protocol = `${match[1].toLowerCase()}:`
  return {
    protocol,
    host: normalizeHost(match[2], protocol),
    path: (match[3] || '/') + (match[4] || ''),
    isSecure: SECURE_PROTOCOLS.has(protocol),
  }
}

export const splitPathAndQuery = (path: string) => {
  const queryIndex = path.indexOf('?')
  if (queryIndex === -1) {
    return { pathPart: path, queryPart: '' }
  }
  return {
    pathPart: path.substring(0, queryIndex),
    queryPart: path.substring(queryIndex),
  }
}
