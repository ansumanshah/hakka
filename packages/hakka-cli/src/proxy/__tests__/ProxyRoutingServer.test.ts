import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHTTPServer, request, type Server as HTTPServer } from 'node:http'
import { connect, createServer as createTCPServer, type Server as TCPServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startProxyRoutingServer, type PreparedProxyRouting } from '../ProxyRoutingServer'

const httpServers: HTTPServer[] = []
const tcpServers: TCPServer[] = []
const routingServers: PreparedProxyRouting[] = []
const temporaryDirectories: string[] = []

async function listen(server: HTTPServer | TCPServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate port.')
  return address.port
}

function temporaryFile(name: string, contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'hakka-routing-'))
  temporaryDirectories.push(directory)
  const path = join(directory, name)
  writeFileSync(path, contents, { mode: 0o600 })
  return path
}

function hopAuthorization(routing: PreparedProxyRouting): string {
  const value = routing.environment.HAKKA_PROXY_UPSTREAM_AUTH
  if (!value) throw new Error('Missing hop authentication.')
  return `Basic ${Buffer.from(value).toString('base64')}`
}

async function routedRequest(routing: PreparedProxyRouting, target: string, method = 'GET'): Promise<string> {
  const proxy = new URL(routing.proxyURL)
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: proxy.hostname,
        port: proxy.port,
        path: target,
        method,
        headers: { 'proxy-authorization': hopAuthorization(routing) },
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.once('end', () =>
          response.statusCode === 200 ? resolve(body) : reject(new Error(`HTTP ${response.statusCode}`)),
        )
      },
    )
    outgoing.once('error', reject)
    outgoing.end()
  })
}

async function routedStatus(routing: PreparedProxyRouting, target: string): Promise<number | undefined> {
  const proxy = new URL(routing.proxyURL)
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: proxy.hostname,
        port: proxy.port,
        path: target,
        headers: { 'proxy-authorization': hopAuthorization(routing) },
      },
      (response) => {
        response.resume()
        response.once('end', () => resolve(response.statusCode))
      },
    )
    outgoing.once('error', reject)
    outgoing.end()
  })
}

afterEach(async () => {
  await Promise.all(routingServers.splice(0).map((server) => server.close()))
  await Promise.all(
    httpServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  await Promise.all(tcpServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test('PAC routes DIRECT without leaking credentials and falls back to an authenticated proxy', async () => {
  const originAuthorizations: Array<string | undefined> = []
  const origin = createHTTPServer((incoming, response) => {
    originAuthorizations.push(incoming.headers['proxy-authorization'])
    response.end(incoming.url)
  })
  httpServers.push(origin)
  const originPort = await listen(origin)

  const expectedUpstreamAuthorization = `Basic ${Buffer.from('pac-user:pac-password').toString('base64')}`
  const seenUpstreamAuthorizations: Array<string | undefined> = []
  const upstream = createHTTPServer((incoming, response) => {
    seenUpstreamAuthorizations.push(incoming.headers['proxy-authorization'])
    if (incoming.headers['proxy-authorization'] !== expectedUpstreamAuthorization) {
      response.writeHead(407)
      response.end()
      return
    }
    const target = new URL(incoming.url!)
    const forwarded = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: { host: target.host },
      },
      (originResponse) => originResponse.pipe(response),
    )
    forwarded.once('error', () => response.destroy())
    incoming.pipe(forwarded)
  })
  httpServers.push(upstream)
  const upstreamPort = await listen(upstream)
  const closedServer = createHTTPServer()
  const closedPort = await listen(closedServer)
  await new Promise<void>((resolve) => closedServer.close(() => resolve()))

  const pacPath = temporaryFile(
    'routing.pac',
    `function FindProxyForURL(url, host) {
      if (shExpMatch(url, "*/direct")) return "DIRECT";
      return "PROXY 127.0.0.1:${closedPort}; PROXY 127.0.0.1:${upstreamPort}; DIRECT";
    }`,
  )
  const configPath = temporaryFile(
    'routing.json',
    JSON.stringify({
      version: 1,
      mode: 'pac',
      pac: { file: pacPath },
      authentication: [
        {
          url: `http://127.0.0.1:${upstreamPort}`,
          authentication: { username: 'pac-user', password: 'pac-password' },
        },
      ],
    }),
  )
  chmodSync(configPath, 0o644)
  await expect(startProxyRoutingServer(configPath)).rejects.toThrow('0600')
  chmodSync(configPath, 0o600)
  const routing = await startProxyRoutingServer(configPath)
  routingServers.push(routing)

  await expect(routedRequest(routing, `http://127.0.0.1:${originPort}/direct`)).resolves.toBe('/direct')
  await expect(routedRequest(routing, `http://127.0.0.1:${originPort}/proxied`)).resolves.toBe('/proxied')
  expect(seenUpstreamAuthorizations).toEqual([expectedUpstreamAuthorization])
  expect(originAuthorizations).toEqual([undefined, undefined])
  expect(routing.proxyURL).not.toContain('pac-user')
  expect(JSON.stringify(routing.environment)).not.toContain('pac-password')
})

test('authenticated upstream carries a CONNECT tunnel and closes with its peer', async () => {
  const echo = createTCPServer((socket) => socket.pipe(socket))
  tcpServers.push(echo)
  const echoPort = await listen(echo)
  const expected = `Basic ${Buffer.from('tunnel-user:tunnel-password').toString('base64')}`
  let seenAuthorization: string | undefined
  const upstream = createHTTPServer()
  upstream.on('connect', (incoming, client, head) => {
    seenAuthorization = incoming.headers['proxy-authorization']
    if (seenAuthorization !== expected) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')
      return
    }
    const target = connect(echoPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) target.write(head)
      target.pipe(client)
      client.pipe(target)
    })
  })
  httpServers.push(upstream)
  const upstreamPort = await listen(upstream)
  const configPath = temporaryFile(
    'routing.json',
    JSON.stringify({
      version: 1,
      mode: 'upstream',
      upstream: {
        url: `http://127.0.0.1:${upstreamPort}`,
        authentication: { username: 'tunnel-user', password: 'tunnel-password' },
      },
    }),
  )
  const routing = await startProxyRoutingServer(configPath)
  routingServers.push(routing)
  const proxy = new URL(routing.proxyURL)

  await new Promise<void>((resolve, reject) => {
    const client: Socket = connect(Number(proxy.port), proxy.hostname, () => {
      client.write(
        `CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\nProxy-Authorization: ${hopAuthorization(routing)}\r\n\r\n`,
      )
    })
    let received = Buffer.alloc(0)
    let tunnelReady = false
    client.on('data', (chunk) => {
      received = Buffer.concat([received, chunk])
      if (!tunnelReady) {
        const end = received.indexOf('\r\n\r\n')
        if (end === -1) return
        expect(received.subarray(0, end).toString()).toContain('200 Connection Established')
        received = received.subarray(end + 4)
        tunnelReady = true
        client.write('hello-through-connect')
      }
      if (tunnelReady && received.toString().includes('hello-through-connect')) {
        client.end()
        resolve()
      }
    })
    client.once('error', reject)
  })
  expect(seenAuthorization).toBe(expected)
})

test('rejects malformed or non-compiling PAC before opening a routing listener', async () => {
  const invalid = temporaryFile('routing.pac', 'function FindProxyForURL( {')
  const config = temporaryFile('routing.json', JSON.stringify({ version: 1, mode: 'pac', pac: { file: invalid } }))
  await expect(startProxyRoutingServer(config)).rejects.toThrow('compile PAC')
})

test('PAC does not replay a POST after an upstream accepts it then disconnects', async () => {
  let accepted = 0
  let fallback = 0
  const first = createHTTPServer((incoming, response) => {
    accepted += 1
    incoming.resume()
    incoming.once('end', () => response.destroy())
  })
  const second = createHTTPServer((_incoming, response) => {
    fallback += 1
    response.end('unexpected replay')
  })
  httpServers.push(first, second)
  const firstPort = await listen(first)
  const secondPort = await listen(second)
  const pac = temporaryFile(
    'routes.pac',
    `function FindProxyForURL() { return "PROXY 127.0.0.1:${firstPort}; PROXY 127.0.0.1:${secondPort}"; }`,
  )
  const config = temporaryFile('routing.json', JSON.stringify({ version: 1, mode: 'pac', pac: { file: pac } }))
  const routing = await startProxyRoutingServer(config)
  routingServers.push(routing)
  await expect(routedRequest(routing, 'http://example.test/payment', 'POST')).rejects.toThrow('HTTP 502')
  expect(accepted).toBe(1)
  expect(fallback).toBe(0)
})

test('rejects a configured upstream that targets a Hakka listener through another loopback spelling', async () => {
  const config = temporaryFile(
    'routing.json',
    JSON.stringify({ version: 1, mode: 'upstream', upstream: { url: 'http://localhost:43210' } }),
  )
  await expect(
    startProxyRoutingServer(config, { forbiddenEndpoints: [{ host: '127.12.34.56', port: 43210 }] }),
  ).rejects.toThrow('must not target a Hakka listener')
})

test('skips a forbidden PAC proxy and uses the next route', async () => {
  let forbiddenRequests = 0
  const forbidden = createHTTPServer((_incoming, response) => {
    forbiddenRequests += 1
    response.end('recursive')
  })
  httpServers.push(forbidden)
  const forbiddenPort = await listen(forbidden)
  const origin = createHTTPServer((_incoming, response) => response.end('origin'))
  httpServers.push(origin)
  const originPort = await listen(origin)
  const pac = temporaryFile(
    'routes.pac',
    `function FindProxyForURL() { return "PROXY localhost:${forbiddenPort}; DIRECT"; }`,
  )
  const config = temporaryFile('routing.json', JSON.stringify({ version: 1, mode: 'pac', pac: { file: pac } }))
  const routing = await startProxyRoutingServer(config, {
    forbiddenEndpoints: [{ host: '127.0.0.1', port: forbiddenPort }],
  })
  routingServers.push(routing)
  await expect(routedRequest(routing, `http://127.0.0.1:${originPort}/fallback`)).resolves.toBe('origin')
  expect(forbiddenRequests).toBe(0)
})

test('rejects requests targeting the routing listener itself', async () => {
  const config = temporaryFile('routing.json', JSON.stringify({ version: 1, mode: 'direct' }))
  const routing = await startProxyRoutingServer(config)
  routingServers.push(routing)
  await expect(routedStatus(routing, `${routing.proxyURL}/recursive`)).resolves.toBe(502)
})
