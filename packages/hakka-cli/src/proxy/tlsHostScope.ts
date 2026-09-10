/** A deliberately small input language for mitmproxy's host regular expressions. */
export type TlsHostScopeMode = 'bypass' | 'allowOnly'

export interface TlsHostScope {
  mode: TlsHostScopeMode
  /** Literal domains, optionally prefixed by `*.` and/or suffixed by `:port`. */
  hosts: readonly string[]
}

export const MAX_TLS_HOSTS = 100
export const MAX_TLS_HOST_LENGTH = 255

const DOMAIN_LABEL = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Converts literal input into the `host:port` expression mitmproxy expects. */
export function mitmproxyHostPattern(input: string): string {
  const value = input.trim().toLowerCase()
  if (value.length > MAX_TLS_HOST_LENGTH)
    throw new Error(`TLS host scope entries must be at most ${MAX_TLS_HOST_LENGTH} characters.`)
  const wildcard = value.startsWith('*.')
  const hostAndPort = wildcard ? value.slice(2) : value
  const colon = hostAndPort.lastIndexOf(':')
  const host = colon === -1 ? hostAndPort : hostAndPort.slice(0, colon)
  const port = colon === -1 ? undefined : hostAndPort.slice(colon + 1)
  if (!host || !DOMAIN_LABEL.test(host))
    throw new Error(
      `Invalid TLS host scope ${JSON.stringify(input)}. Use a literal domain such as api.example.com or *.example.com.`,
    )
  if (port !== undefined && (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535))
    throw new Error(`Invalid TLS host scope port in ${JSON.stringify(input)}. Use a port from 1 through 65535.`)
  const normalizedPort = port === undefined ? undefined : String(Number(port))
  const hostname = escapeRegex(host)
  const scopedHost = wildcard ? `(?:[a-z0-9-]+\\.)+${hostname}` : hostname
  return `^${scopedHost}:${normalizedPort ?? '\\d+'}$`
}

/** Builds repeatable mitmdump flags for a bounded TLS host scope. */
export function buildMitmproxyHostArgs(scope: TlsHostScope): string[] {
  if (scope.mode !== 'bypass' && scope.mode !== 'allowOnly')
    throw new Error('TLS host scope mode must be bypass or allowOnly.')
  if (scope.hosts.length > MAX_TLS_HOSTS) throw new Error(`TLS host scope supports at most ${MAX_TLS_HOSTS} hosts.`)
  const flag = scope.mode === 'bypass' ? '--ignore-hosts' : '--allow-hosts'
  const patterns = [...new Set(scope.hosts.map(mitmproxyHostPattern))]
  if (scope.mode === 'allowOnly' && patterns.length === 0)
    throw new Error('TLS allow-only scope requires at least one host.')
  return patterns.flatMap((pattern) => [flag, pattern])
}
