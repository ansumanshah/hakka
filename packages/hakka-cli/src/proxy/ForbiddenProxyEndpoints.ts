import { isIP } from 'node:net'

export interface ProxyRoutingEndpoint {
  host: string
  port: number
}

function normalizeHost(host: string): string {
  let normalized = host.trim().toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1)
  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1)
  if (!normalized || /[\s/?#@]/.test(normalized)) throw new Error('Forbidden proxy endpoint host is invalid.')
  if (isIP(normalized) === 6) {
    const canonical = new URL(`http://[${normalized}]/`).hostname
    normalized = canonical.slice(1, -1)
  }
  return normalized
}

function isLoopback(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true
  if (isIP(host) !== 4) return false
  return Number(host.split('.')[0]) === 127
}

function endpointKey(host: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Forbidden proxy endpoint port is invalid.')
  const normalized = normalizeHost(host)
  if (isLoopback(normalized) || normalized === '0.0.0.0' || normalized === '::') return `local:${port}`
  return `${normalized}:${port}`
}

/** Matches configured listener endpoints, treating every loopback spelling as the same host. */
export class ForbiddenProxyEndpoints {
  readonly #keys = new Set<string>()

  constructor(endpoints: readonly ProxyRoutingEndpoint[] = []) {
    for (const endpoint of endpoints) this.add(endpoint)
  }

  add(endpoint: ProxyRoutingEndpoint): void {
    this.#keys.add(endpointKey(endpoint.host, endpoint.port))
  }

  has(host: string, port: number): boolean {
    return this.#keys.has(endpointKey(host, port))
  }

  hasURL(url: URL): boolean {
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    return this.has(url.hostname, port)
  }
}
