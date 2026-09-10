/** Maximum accepted upstream proxy URL length, excluding accidental pasted configuration. */
export const MAX_UPSTREAM_PROXY_URL_LENGTH = 2_048

/**
 * Validates the small upstream proxy URL form accepted by mitmproxy's upstream mode.
 * Authentication and PAC URLs intentionally are not part of this configuration surface.
 */
export function buildUpstreamProxyArgs(input: string | undefined): string[] {
  if (input === undefined || input.trim() === '') return []
  const value = input.trim()
  if (value.length > MAX_UPSTREAM_PROXY_URL_LENGTH)
    throw new Error(`--upstream-proxy must be at most ${MAX_UPSTREAM_PROXY_URL_LENGTH} characters.`)
  if (value.includes('?') || value.includes('#'))
    throw new Error('--upstream-proxy must not include a query or fragment.')
  if (/\s/.test(value)) throw new Error('--upstream-proxy must not include whitespace.')

  const suffix = value.slice(value.indexOf('//') + 2)
  const slashIndex = suffix.indexOf('/')
  const authority = slashIndex === -1 ? suffix : suffix.slice(0, slashIndex)
  const rawPath = slashIndex === -1 ? '' : suffix.slice(slashIndex)
  if (rawPath !== '' && rawPath !== '/') throw new Error('--upstream-proxy must not include a path.')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('--upstream-proxy must be an HTTP(S) URL with an explicit port.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('--upstream-proxy must use http:// or https://.')
  if (!url.hostname) throw new Error('--upstream-proxy must include a host.')
  if (url.username || url.password) throw new Error('--upstream-proxy must not include credentials.')
  const portMatch = authority.match(/^\[[^\]]+\]:(\d+)$/) ?? authority.match(/^[^:]+:(\d+)$/)
  if (!portMatch) throw new Error('--upstream-proxy requires an explicit port between 1 and 65535.')
  const port = Number(portMatch[1])
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error('--upstream-proxy port must be an integer between 1 and 65535.')

  const host = url.hostname.includes(':') && !url.hostname.startsWith('[') ? `[${url.hostname}]` : url.hostname
  return ['--mode', `upstream:${url.protocol}//${host}:${port}`]
}
