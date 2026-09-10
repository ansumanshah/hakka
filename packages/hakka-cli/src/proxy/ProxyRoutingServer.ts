import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as requestHTTP, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { request as requestHTTPS } from 'node:https'
import { connect as connectTCP, isIP, type Socket } from 'node:net'
import { connect as connectTLS } from 'node:tls'

import { ForbiddenProxyEndpoints, type ProxyRoutingEndpoint } from './ForbiddenProxyEndpoints'
import { createPacRouter, type PacRouter, type ProxyRoute } from './pacRouting'
import { loadProxyRoutingConfig, type ProxyAuthentication, type ProxyRoutingConfig } from './proxyRoutingConfig'

const CONNECT_TIMEOUT_MS = 10_000
const FORWARD_TIMEOUT_MS = 30_000
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024
const MAX_ACTIVE_CONNECTIONS = 128
const MAX_CONNECT_RESPONSE_BYTES = 32 * 1024

export interface PreparedProxyRouting {
  /** Credential-free loopback URL suitable for mitmproxy's --mode upstream value. */
  proxyURL: string
  /** Per-launch authentication passed only through the child environment. */
  environment: Readonly<Record<string, string>>
  close(): Promise<void>
}

export interface ProxyRoutingServerOptions {
  /** Hakka listeners and helpers that must never be used as destinations or upstream proxies. */
  forbiddenEndpoints?: readonly ProxyRoutingEndpoint[]
}

interface TargetAddress {
  host: string
  port: number
  authority: string
}

function socketHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function basicAuthorization(authentication: ProxyAuthentication): string {
  return `Basic ${Buffer.from(`${authentication.username}:${authentication.password}`, 'utf8').toString('base64')}`
}

function sanitizeHeaders(headers: IncomingHttpHeaders, targetHost: string): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {}
  const connectionTokens = new Set(
    String(headers.connection ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (
      lower === 'connection' ||
      lower === 'proxy-authorization' ||
      lower === 'proxy-authenticate' ||
      lower === 'proxy-connection' ||
      lower === 'keep-alive' ||
      lower === 'te' ||
      lower === 'trailer' ||
      lower === 'upgrade' ||
      connectionTokens.has(lower)
    )
      continue
    result[name] = value
  }
  result.host = targetHost
  return result
}

function sanitizeResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result = sanitizeHeaders(headers, '')
  delete result.host
  return result
}

function parseTargetAddress(authority: string): TargetAddress {
  if (authority.length === 0 || authority.length > 2_048 || /[\s/@?#]/.test(authority))
    throw new Error('CONNECT target is invalid.')
  const match = authority.match(/^\[([^\]]+)]:(\d+)$/) ?? authority.match(/^([^:]+):(\d+)$/)
  if (!match) throw new Error('CONNECT target requires a host and port.')
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('CONNECT target port is invalid.')
  const host = match[1]!
  return { host, port, authority: isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}` }
}

function socketConnect(host: string, port: number, secure: boolean): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? connectTLS({ host, port, servername: isIP(host) === 0 ? host : undefined, ALPNProtocols: ['http/1.1'] })
      : connectTCP({ host, port })
    const fail = (error: Error): void => {
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => socket.destroy(new Error('Connection timed out.')), CONNECT_TIMEOUT_MS)
    const event = secure ? 'secureConnect' : 'connect'
    socket.once(event, () => {
      clearTimeout(timer)
      socket.removeListener('error', fail)
      resolve(socket)
    })
    socket.once('error', fail)
  })
}

async function connectRoute(route: ProxyRoute, target: TargetAddress): Promise<Socket> {
  if (route.kind === 'direct') return socketConnect(target.host, target.port, false)
  const proxy = new URL(route.proxyURL!)
  const port = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80))
  const socket = await socketConnect(socketHost(proxy.hostname), port, proxy.protocol === 'https:')
  const headers = [`CONNECT ${target.authority} HTTP/1.1`, `Host: ${target.authority}`, 'Proxy-Connection: close']
  if (route.authentication) headers.push(`Proxy-Authorization: ${basicAuthorization(route.authentication)}`)
  socket.write(`${headers.join('\r\n')}\r\n\r\n`)
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0)
    const timer = setTimeout(() => socket.destroy(new Error('Upstream CONNECT timed out.')), CONNECT_TIMEOUT_MS)
    const fail = (error: Error): void => {
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    }
    socket.on('data', function read(chunk: Buffer) {
      response = Buffer.concat([response, chunk])
      if (response.byteLength > MAX_CONNECT_RESPONSE_BYTES) {
        socket.removeListener('data', read)
        fail(new Error('Upstream CONNECT response headers were too large.'))
        return
      }
      const end = response.indexOf('\r\n\r\n')
      if (end === -1) return
      socket.removeListener('data', read)
      socket.removeListener('error', fail)
      clearTimeout(timer)
      const status = response
        .subarray(0, response.indexOf('\r\n'))
        .toString('ascii')
        .match(/^HTTP\/1\.[01] (\d{3})/)
      if (!status || Number(status[1]) < 200 || Number(status[1]) >= 300) {
        fail(new Error(`Upstream proxy rejected CONNECT with HTTP ${status?.[1] ?? 'unknown'}.`))
        return
      }
      const remaining = response.subarray(end + 4)
      if (remaining.length > 0) socket.unshift(remaining)
      resolve(socket)
    })
    socket.once('error', fail)
  })
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.byteLength
    if (size > MAX_REQUEST_BODY_BYTES) throw new Error('Proxy request body is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

class ForwardingFailure extends Error {
  constructor(readonly canTryNextRoute: boolean) {
    super('Forwarded request failed.')
  }
}

function forwardRequest(
  incoming: IncomingMessage,
  target: URL,
  body: Buffer,
  route: ProxyRoute,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const isDirect = route.kind === 'direct'
    const endpoint = isDirect ? target : new URL(route.proxyURL!)
    const client = endpoint.protocol === 'https:' ? requestHTTPS : requestHTTP
    const headers = sanitizeHeaders(incoming.headers, target.host)
    if (!isDirect && route.authentication) headers['proxy-authorization'] = basicAuthorization(route.authentication)
    const outgoing = client(
      {
        protocol: endpoint.protocol,
        hostname: socketHost(endpoint.hostname),
        port: endpoint.port,
        method: incoming.method,
        path: isDirect ? `${target.pathname}${target.search}` : target.href,
        headers,
        agent: false,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      },
      resolve,
    )
    outgoing.setTimeout(FORWARD_TIMEOUT_MS, () => outgoing.destroy(new Error('Forwarded request timed out.')))
    let connected = false
    outgoing.once('socket', (socket) => {
      connected = !socket.connecting
      socket.once('connect', () => {
        connected = true
      })
    })
    outgoing.once('error', () => reject(new ForwardingFailure(!connected)))
    outgoing.end(body)
  })
}

function fixedRoutes(config: ProxyRoutingConfig): ProxyRoute[] | undefined {
  if (config.mode === 'direct') return [{ kind: 'direct' }]
  if (config.mode === 'upstream')
    return [
      {
        kind: 'proxy',
        proxyURL: config.upstream.url,
        authentication: config.upstream.authentication,
      },
    ]
  return undefined
}

/** Validates routing, loads and compiles PAC when present, then starts a loopback-only forwarder. */
export async function startProxyRoutingServer(
  configurationPath: string,
  options: ProxyRoutingServerOptions = {},
): Promise<PreparedProxyRouting> {
  const config = await loadProxyRoutingConfig(configurationPath)
  const forbiddenEndpoints = new ForbiddenProxyEndpoints(options.forbiddenEndpoints)
  const pacRouter: PacRouter | undefined = config.mode === 'pac' ? await createPacRouter(config) : undefined
  const staticRoutes = fixedRoutes(config)
  if (
    staticRoutes?.some(
      (candidate) => candidate.kind === 'proxy' && forbiddenEndpoints.hasURL(new URL(candidate.proxyURL!)),
    )
  ) {
    pacRouter?.close()
    throw new Error('Routing proxy must not target a Hakka listener.')
  }
  const route = async (url: URL): Promise<ProxyRoute[]> => {
    const candidates = staticRoutes ?? (await pacRouter!.resolve(url))
    return candidates.filter(
      (candidate) => candidate.kind === 'direct' || !forbiddenEndpoints.hasURL(new URL(candidate.proxyURL!)),
    )
  }
  const token = randomBytes(32).toString('base64url')
  const expectedAuthorization = Buffer.from(`Basic ${Buffer.from(`hakka:${token}`).toString('base64')}`)
  const sockets = new Set<Socket>()
  let activeConnections = 0
  const server = createServer(
    { maxHeaderSize: 16 * 1024, requestTimeout: FORWARD_TIMEOUT_MS, headersTimeout: 10_000 },
    async (incoming, response) => {
      const supplied = Buffer.from(String(incoming.headers['proxy-authorization'] ?? ''))
      if (supplied.length !== expectedAuthorization.length || !timingSafeEqual(supplied, expectedAuthorization)) {
        response.writeHead(407, { 'proxy-authenticate': 'Basic realm="Hakka routing"', connection: 'close' })
        response.end()
        return
      }
      if (activeConnections >= MAX_ACTIVE_CONNECTIONS) {
        response.writeHead(503, { connection: 'close' })
        response.end()
        return
      }
      activeConnections += 1
      let released = false
      const release = (): void => {
        if (released) return
        released = true
        activeConnections -= 1
      }
      response.once('close', release)
      try {
        if (!incoming.url || incoming.url.length > 8_192) throw new Error('Proxy request URL is invalid.')
        const target = new URL(incoming.url)
        if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('Unsupported target protocol.')
        if (forbiddenEndpoints.hasURL(target)) throw new Error('Proxy target is a Hakka listener.')
        const body = await readRequestBody(incoming)
        let lastError: unknown
        for (const candidate of await route(target)) {
          try {
            // PAC fallbacks must be attempted in the order returned by FindProxyForURL.
            // eslint-disable-next-line no-await-in-loop
            const upstream = await forwardRequest(incoming, target, body, candidate)
            response.writeHead(upstream.statusCode ?? 502, sanitizeResponseHeaders(upstream.headers))
            upstream.pipe(response)
            return
          } catch (error: unknown) {
            if (!(error instanceof ForwardingFailure) || !error.canTryNextRoute) throw error
            lastError = error
          }
        }
        throw lastError ?? new Error('No routing candidate succeeded.')
      } catch {
        if (!response.headersSent) response.writeHead(502, { connection: 'close' })
        response.end()
      }
    },
  )
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.on('connect', async (incoming, client, head) => {
    const supplied = Buffer.from(String(incoming.headers['proxy-authorization'] ?? ''))
    if (supplied.length !== expectedAuthorization.length || !timingSafeEqual(supplied, expectedAuthorization)) {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Hakka routing"\r\nConnection: close\r\n\r\n',
      )
      return
    }
    if (activeConnections >= MAX_ACTIVE_CONNECTIONS) {
      client.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      return
    }
    activeConnections += 1
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      activeConnections -= 1
    }
    client.once('close', release)
    try {
      const target = parseTargetAddress(incoming.url ?? '')
      if (forbiddenEndpoints.has(target.host, target.port)) throw new Error('Proxy target is a Hakka listener.')
      let upstream: Socket | undefined
      for (const candidate of await route(new URL(`https://${target.authority}/`))) {
        try {
          // PAC fallbacks must be attempted in the order returned by FindProxyForURL.
          // eslint-disable-next-line no-await-in-loop
          upstream = await connectRoute(candidate, target)
          break
        } catch {
          // PAC ordering defines the next fallback.
        }
      }
      if (!upstream) throw new Error('No CONNECT routing candidate succeeded.')
      upstream.once('close', () => client.destroy())
      client.once('close', () => upstream.destroy())
      upstream.once('error', () => client.destroy())
      client.once('error', () => upstream.destroy())
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    } catch {
      client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  } catch (error: unknown) {
    pacRouter?.close()
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not determine routing proxy port.')
  forbiddenEndpoints.add({ host: '127.0.0.1', port: address.port })
  let closePromise: Promise<void> | undefined
  return {
    proxyURL: `http://127.0.0.1:${address.port}`,
    environment: { HAKKA_PROXY_UPSTREAM_AUTH: `hakka:${token}` },
    close(): Promise<void> {
      closePromise ??= new Promise<void>((resolve) => {
        server.close(() => {
          pacRouter?.close()
          resolve()
        })
        for (const socket of sockets) socket.destroy()
      })
      return closePromise
    },
  }
}
