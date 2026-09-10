import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isIP } from 'node:net'
import { resolve } from 'node:path'

const MAX_ROUTING_CONFIG_BYTES = 64 * 1024
export const MAX_PAC_BYTES = 256 * 1024
const MAX_PAC_URL_LENGTH = 2_048

export interface ProxyAuthentication {
  username: string
  password: string
}
interface ProxyEndpoint {
  url: string
  authentication?: ProxyAuthentication
}
interface DirectProxyRoutingConfig {
  version: 1
  mode: 'direct'
}
interface UpstreamProxyRoutingConfig {
  version: 1
  mode: 'upstream'
  upstream: ProxyEndpoint
}
export interface PacProxyRoutingConfig {
  version: 1
  mode: 'pac'
  pac: { file: string } | { url: string }
  authentication?: ProxyEndpoint[]
}
export type ProxyRoutingConfig = DirectProxyRoutingConfig | UpstreamProxyRoutingConfig | PacProxyRoutingConfig

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${field} must be an object.`)
  return value as Record<string, unknown>
}

function requireExactKeys(object: Record<string, unknown>, keys: readonly string[], field: string): void {
  const accepted = new Set(keys)
  const unexpected = Object.keys(object).find((key) => !accepted.has(key))
  if (unexpected) throw new Error(`${field} contains unsupported field ${JSON.stringify(unexpected)}.`)
}

function hasLineBreak(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) === 10 || character.charCodeAt(0) === 13)
}

function parseAuthentication(value: unknown, field: string): ProxyAuthentication | undefined {
  if (value === undefined) return undefined
  const object = requireObject(value, field)
  requireExactKeys(object, ['username', 'password'], field)
  if (typeof object.username !== 'string' || object.username.length === 0 || object.username.length > 1_024)
    throw new Error(`${field}.username must contain 1 through 1024 characters.`)
  if (typeof object.password !== 'string' || object.password.length > 8_192)
    throw new Error(`${field}.password must contain at most 8192 characters.`)
  if (object.username.includes(':')) throw new Error(`${field}.username must not contain a colon.`)
  if (hasLineBreak(object.username) || hasLineBreak(object.password))
    throw new Error(`${field} must not contain line breaks.`)
  return { username: object.username, password: object.password }
}

export function normalizeProxyURL(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PAC_URL_LENGTH)
    throw new Error(`${field} must be a bounded HTTP(S) proxy URL with an explicit port.`)
  if (/\s/.test(input) || input.includes('?') || input.includes('#'))
    throw new Error(`${field} must not contain whitespace, a query, or a fragment.`)
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`${field} must be an HTTP(S) proxy URL with an explicit port.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${field} must use http:// or https://.`)
  if (!url.hostname || url.username || url.password || (url.pathname !== '' && url.pathname !== '/'))
    throw new Error(`${field} must contain only a host and explicit port; credentials belong in a separate field.`)
  const authority = input.slice(input.indexOf('//') + 2).replace(/\/$/, '')
  const match = authority.match(/^\[[^\]]+\]:(\d+)$/) ?? authority.match(/^[^:]+:(\d+)$/)
  if (!match) throw new Error(`${field} requires an explicit port between 1 and 65535.`)
  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`${field} port must be between 1 and 65535.`)
  const hostname = isIP(url.hostname) === 6 ? `[${url.hostname}]` : url.hostname
  return `${url.protocol}//${hostname}:${port}`
}

function parseEndpoint(value: unknown, field: string): ProxyEndpoint {
  const object = requireObject(value, field)
  requireExactKeys(object, ['url', 'authentication'], field)
  return {
    url: normalizeProxyURL(object.url, `${field}.url`),
    authentication: parseAuthentication(object.authentication, `${field}.authentication`),
  }
}

export function parseProxyRoutingConfig(value: unknown): ProxyRoutingConfig {
  const object = requireObject(value, 'Routing configuration')
  if (object.version !== 1) throw new Error('Routing configuration version must be 1.')
  if (object.mode === 'direct') {
    requireExactKeys(object, ['version', 'mode'], 'Routing configuration')
    return { version: 1, mode: 'direct' }
  }
  if (object.mode === 'upstream') {
    requireExactKeys(object, ['version', 'mode', 'upstream'], 'Routing configuration')
    return { version: 1, mode: 'upstream', upstream: parseEndpoint(object.upstream, 'upstream') }
  }
  if (object.mode !== 'pac') throw new Error('Routing configuration mode must be direct, upstream, or pac.')
  requireExactKeys(object, ['version', 'mode', 'pac', 'authentication'], 'Routing configuration')
  const pac = requireObject(object.pac, 'pac')
  requireExactKeys(pac, ['file', 'url'], 'pac')
  const file = typeof pac.file === 'string' ? pac.file : undefined
  const pacURL = typeof pac.url === 'string' ? pac.url : undefined
  const hasFile = file !== undefined
  const hasURL = pacURL !== undefined
  if (hasFile === hasURL) throw new Error('pac must specify exactly one explicit file or URL source.')
  let source: { file: string } | { url: string }
  if (file !== undefined) {
    if (file === '' || file.length > 4_096) throw new Error('pac.file must be a bounded path.')
    source = { file: resolve(file) }
  } else {
    if (pacURL!.length > MAX_PAC_URL_LENGTH) throw new Error('pac.url is too long.')
    let url: URL
    try {
      url = new URL(pacURL!)
    } catch {
      throw new Error('pac.url must be an HTTP(S) URL.')
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hash)
      throw new Error('pac.url must be an HTTP(S) URL without credentials or a fragment.')
    source = { url: url.href }
  }
  if (object.authentication !== undefined && !Array.isArray(object.authentication))
    throw new Error('authentication must be an array.')
  const authentication = (object.authentication ?? []).map((entry, index) =>
    parseEndpoint(entry, `authentication[${index}]`),
  )
  const seen = new Set<string>()
  for (const endpoint of authentication) {
    if (!endpoint.authentication) throw new Error('PAC authentication entries require authentication credentials.')
    if (seen.has(endpoint.url)) throw new Error(`PAC authentication contains duplicate proxy ${endpoint.url}.`)
    seen.add(endpoint.url)
  }
  return { version: 1, mode: 'pac', pac: source, authentication }
}

export async function loadProxyRoutingConfig(path: string): Promise<ProxyRoutingConfig> {
  let contents: Buffer
  let permissions = 0
  try {
    const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const status = await handle.stat()
      if (!status.isFile()) throw new Error('path is not a regular file')
      if (status.size > MAX_ROUTING_CONFIG_BYTES) throw new Error(`file exceeds ${MAX_ROUTING_CONFIG_BYTES} bytes`)
      permissions = status.mode & 0o777
      contents = await handle.readFile()
    } finally {
      await handle.close()
    }
  } catch (error: unknown) {
    throw new Error(`Could not read routing configuration: ${error instanceof Error ? error.message : String(error)}`)
  }
  let value: unknown
  try {
    value = JSON.parse(contents.toString('utf8'))
  } catch {
    throw new Error('Routing configuration must be valid JSON.')
  }
  const config = parseProxyRoutingConfig(value)
  const hasCredentials =
    config.mode === 'upstream'
      ? config.upstream.authentication !== undefined
      : config.mode === 'pac' && (config.authentication?.length ?? 0) > 0
  if (hasCredentials && (permissions & 0o077) !== 0)
    throw new Error('Routing configuration containing credentials must have file permissions 0600 or stricter.')
  return config
}
