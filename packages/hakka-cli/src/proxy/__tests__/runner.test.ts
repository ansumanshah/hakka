import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import WebSocket, { WebSocketServer } from 'ws'

import { runProxyCommand } from '../../proxyCommand'
import { startProxyCapture } from '../runner'

const temporaryDirectories: string[] = []
const hasMitmdump = spawnSync('mitmdump', ['--version'], { stdio: 'ignore' }).status === 0

function fakeMitmdump(
  mode: 'listen' | 'exit' | 'snapshots' | 'ignore-term' | 'ready-ignore-term' | 'ready-exit',
): string {
  const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-sidecar-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'mitmdump')
  writeFileSync(
    path,
    `#!/usr/bin/env bun
const port = Number(Bun.argv[Bun.argv.indexOf('--listen-port') + 1])
if (${JSON.stringify(mode)} === 'exit') process.exit(3)
if (${JSON.stringify(mode)}.includes('ignore-term')) process.on('SIGTERM', () => {})
Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response('ok') })
if (${JSON.stringify(mode)} !== 'ignore-term') console.log('{"type":"ready"}')
if (['snapshots', 'ready-ignore-term'].includes(${JSON.stringify(mode)})) setTimeout(() => {
  console.log(JSON.stringify({ type: 'flow', id: 'stream-1', startedAt: 1, endedAt: 2, method: 'GET', url: 'http://example.test/stream', requestHeaders: [], status: 200, responseBody: 'first' }))
  console.log(JSON.stringify({ type: 'flow', id: 'stream-1', startedAt: 1, endedAt: 3, method: 'GET', url: 'http://example.test/stream', requestHeaders: [], status: 200, responseBody: 'final' }))
}, 10)
if (${JSON.stringify(mode)} === 'ready-exit') setTimeout(() => process.exit(7), 200)
setInterval(() => {}, 1_000)
`,
  )
  chmodSync(path, 0o755)
  return path
}

function streamedBodyMitmdump(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-streamed-body-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'mitmdump')
  writeFileSync(path, '#!/bin/sh\nexec mitmdump --set stream_large_bodies=1b "$@"\n')
  chmodSync(path, 0o755)
  return path
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port.')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

async function sendWebSocketTextThroughProxy(proxyPort: number, targetPort: number, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(proxyPort, '127.0.0.1')
    let upgraded = false
    let response = ''
    socket.setTimeout(3_000, () => reject(new Error('WebSocket proxy smoke timed out.')))
    socket.once('error', reject)
    socket.on('data', (chunk: Buffer) => {
      if (upgraded) return
      response += chunk.toString('utf8')
      if (!response.includes('\r\n\r\n')) return
      if (!response.startsWith('HTTP/1.1 101')) {
        socket.destroy()
        reject(new Error(`WebSocket proxy smoke upgrade failed: ${response.slice(0, 160)}`))
        return
      }
      upgraded = true
      const payload = Buffer.from(text)
      const mask = Buffer.from([1, 2, 3, 4])
      const frame = Buffer.concat([
        Buffer.from([0x81, 0x80 | payload.length]),
        mask,
        Buffer.from(payload.map((byte, index) => byte ^ mask[index % mask.length]!)),
      ])
      socket.write(frame)
      setTimeout(() => {
        socket.end()
        resolve()
      }, 250)
    })
    socket.write(
      `GET http://127.0.0.1:${targetPort}/smoke HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    )
  })
}

async function sendHttpThroughProxy(proxyPort: number, targetPort: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, '127.0.0.1')
    let response = ''
    socket.setTimeout(3_000, () => reject(new Error('HTTP proxy smoke timed out.')))
    socket.once('error', reject)
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8')
    })
    socket.once('end', () => resolve(response))
    socket.write(
      `GET http://127.0.0.1:${targetPort}${path} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`,
    )
  })
}

interface BreakpointPauseFrame {
  type: 'control'
  payload: {
    kind: 'breakpoint.paused'
    pauseId: string
    ruleId?: string
    phase: 'request' | 'response'
    request: { method: string; headers: Record<string, string>; body?: string }
    response?: { status: number; headers: Record<string, string>; body?: string }
  }
}

function nextBreakpointPause(socket: WebSocket): Promise<BreakpointPauseFrame> {
  return new Promise((resolve) => {
    const receive = (data: WebSocket.RawData): void => {
      const frame = JSON.parse(data.toString()) as BreakpointPauseFrame
      if (frame.type === 'control' && frame.payload?.kind === 'breakpoint.paused') resolve(frame)
      else socket.once('message', receive)
    }
    socket.once('message', receive)
  })
}

async function openWebSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

function sendBodyThroughProxy(proxyPort: number, targetPort: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, '127.0.0.1')
    let response = ''
    socket.setTimeout(4_000, () => reject(new Error(`Paused proxy request timed out at ${path}.`)))
    socket.once('error', reject)
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8')
    })
    socket.once('end', () => resolve(response))
    socket.write(
      `POST http://127.0.0.1:${targetPort}${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${targetPort}\r\nContent-Length: 12\r\nConnection: close\r\n\r\nrequest-body`,
    )
  })
}

async function sendStreamedHttpThroughProxy(proxyPort: number, targetPort: number, body: string): Promise<string> {
  const process = Bun.spawn(
    [
      'curl',
      '--silent',
      '--show-error',
      '--http1.1',
      '--proxy',
      `http://127.0.0.1:${proxyPort}`,
      '--data-binary',
      `@${body}`,
      '--write-out',
      '\n%{http_code}',
      `http://127.0.0.1:${targetPort}/blocked-stream`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [output, diagnostics, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (status !== 0) throw new Error(`Streamed HTTP proxy smoke failed: ${diagnostics}`)
  return output
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('startProxyCapture lifecycle', () => {
  test('rejects a missing executable before reporting readiness', async () => {
    await expect(startProxyCapture({ mitmdumpPath: '/tmp/hakka-no-such-mitmdump' })).rejects.toThrow('was not found')
  })

  test('rejects a nonzero startup exit', async () => {
    await expect(
      startProxyCapture({ mitmdumpPath: fakeMitmdump('exit'), port: await availablePort(), onDiagnostic: () => {} }),
    ).rejects.toThrow('exited')
  })

  test('rejects an occupied proxy port instead of returning a false ready capture', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const address = blocker.address()
    if (!address || typeof address === 'string') throw new Error('Could not allocate occupied test port.')
    await expect(
      startProxyCapture({ mitmdumpPath: fakeMitmdump('listen'), port: address.port, onDiagnostic: () => {} }),
    ).rejects.toThrow()
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  })

  test('reports ready then stops without hanging', async () => {
    const capture = await startProxyCapture({
      mitmdumpPath: fakeMitmdump('listen'),
      port: await availablePort(),
      onDiagnostic: () => {},
    })
    await capture.stop()
  })

  test('kills a sidecar that ignores TERM after readiness times out', async () => {
    await expect(
      startProxyCapture({
        mitmdumpPath: fakeMitmdump('ignore-term'),
        port: await availablePort(),
        startupTimeoutMs: 10,
        onDiagnostic: () => {},
      }),
    ).rejects.toThrow('did not report ready')
  }, 4_000)

  test('abort after readiness exports and terminates a TERM-resistant child exactly once', async () => {
    const executable = fakeMitmdump('ready-ignore-term')
    const harOutput = join(executable, '..', 'capture.har')
    const controller = new AbortController()
    const capture = await startProxyCapture({
      mitmdumpPath: executable,
      port: await availablePort(),
      harOutput,
      signal: controller.signal,
      onDiagnostic: () => {},
    })
    try {
      const deadline = Date.now() + 1_000
      while (capture.records.length === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10))
      expect(capture.records).toHaveLength(1)
      controller.abort()
      const firstStop = capture.stop()
      expect(capture.stop()).toBe(firstStop)
      await firstStop
      expect(JSON.parse(readFileSync(harOutput, 'utf8')).log.entries).toHaveLength(1)
      await capture.wait()
    } finally {
      await capture.stop()
    }
  }, 5_000)

  test('propagates an export write failure after terminating the sidecar', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-export-'))
    temporaryDirectories.push(directory)
    const capture = await startProxyCapture({
      mitmdumpPath: fakeMitmdump('listen'),
      port: await availablePort(),
      harOutput: join(directory, 'missing', 'capture.har'),
      onDiagnostic: () => {},
    })
    await expect(capture.stop()).rejects.toThrow()
  })

  test('runs a bounded JSON capture without reporting started before readiness', async () => {
    const writes: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    try {
      await runProxyCommand([
        '--mitmdump',
        fakeMitmdump('listen'),
        '--port',
        String(await availablePort()),
        '--duration-ms',
        '0',
        '--json',
      ])
    } finally {
      process.stdout.write = originalWrite
    }
    expect(writes.join('')).toContain('"status":"started"')
    expect(writes.join('')).toContain('"status":"stopped"')
  })

  test('emits throttled live status records for unique proxy flows', async () => {
    const writes: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    try {
      await runProxyCommand([
        '--mitmdump',
        fakeMitmdump('snapshots'),
        '--port',
        String(await availablePort()),
        '--duration-ms',
        '100',
        '--json',
      ])
    } finally {
      process.stdout.write = originalWrite
    }
    expect(writes.join('')).toContain('"status":"status","records":1')
  })

  test('replaces same-flow streaming snapshots so exports retain only the final record', async () => {
    const capture = await startProxyCapture({
      mitmdumpPath: fakeMitmdump('snapshots'),
      port: await availablePort(),
      onDiagnostic: () => {},
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(capture.records).toHaveLength(1)
    expect(capture.records[0]).toMatchObject({ id: 'stream-1', endTime: 3, responseBody: 'final' })
    await capture.stop()
  })

  test('puts the bandwidth relay on the public port and cleans all helpers after an unexpected sidecar exit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-advanced-'))
    temporaryDirectories.push(directory)
    const routing = join(directory, 'routing.json')
    const script = join(directory, 'hooks.js')
    writeFileSync(routing, JSON.stringify({ version: 1, mode: 'direct' }))
    writeFileSync(script, 'function onRequest(request) { request.headers["x-script"] = "yes"; }')
    const proxyPort = await availablePort()
    const capture = await startProxyCapture({
      port: proxyPort,
      mitmdumpPath: fakeMitmdump('ready-exit'),
      routingConfig: routing,
      scriptPath: script,
      bandwidth: { profile: 'custom', uploadBytesPerSecond: 1024 * 1024 },
      onDiagnostic: () => {},
    })
    await expect(capture.wait()).rejects.toThrow('code 7')
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = connect(proxyPort, '127.0.0.1')
        socket.once('connect', () => {
          socket.destroy()
          resolve()
        })
        socket.once('error', reject)
      }),
    ).rejects.toThrow()
    await capture.stop()
  })

  test.if(hasMitmdump)(
    'applies bounded request and response scripts to real mitmproxy traffic',
    async () => {
      let upstreamMethod = ''
      let upstreamBody = ''
      let upstreamHeader = ''
      const upstream = createHttpServer((request, response) => {
        upstreamMethod = request.method ?? ''
        upstreamHeader = String(request.headers['x-script-request'] ?? '')
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => (upstreamBody += chunk))
        request.on('end', () => {
          response.setHeader('Set-Cookie', ['one=1', 'two=2'])
          response.end('origin')
        })
      })
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
      const address = upstream.address()
      if (!address || typeof address === 'string') throw new Error('Could not allocate upstream port.')
      const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-script-live-'))
      temporaryDirectories.push(directory)
      const script = join(directory, 'hooks.js')
      writeFileSync(
        script,
        `function onRequest(request) {
  request.method = "PUT";
  request.headers["x-script-request"] = "applied";
  request.body = request.body.toUpperCase();
}
function onResponse(response) {
  response.status = 299;
  response.headers["x-script-response"] = "applied";
  response.body += "-scripted";
}`,
      )
      const proxyPort = await availablePort()
      const routingConfig = join(directory, 'routing.json')
      writeFileSync(routingConfig, JSON.stringify({ version: 1, mode: 'direct' }), { mode: 0o600 })
      const capture = await startProxyCapture({
        routingConfig,
        port: proxyPort,
        mitmdumpPath: 'mitmdump',
        scriptPath: script,
        onDiagnostic: () => {},
      })
      try {
        const response = await sendBodyThroughProxy(proxyPort, address.port, '/script')
        expect(upstreamMethod).toBe('PUT')
        expect(upstreamBody).toBe('REQUEST-BODY')
        expect(upstreamHeader).toBe('applied')
        expect(response).toContain('HTTP/1.1 299')
        expect(response.toLowerCase()).toContain('x-script-response: applied')
        expect(response.match(/set-cookie:/gi)).toHaveLength(2)
        expect(response).toContain('origin-scripted')
      } finally {
        await capture.stop()
        await new Promise<void>((resolve) => upstream.close(() => resolve()))
      }
    },
    15_000,
  )

  test.if(hasMitmdump)(
    'enforces integrated latency, offline, and byte-rate network conditions',
    async () => {
      let upstreamRequests = 0
      const upstream = createHttpServer((_request, response) => {
        upstreamRequests += 1
        response.end('x'.repeat(8 * 1024))
      })
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
      const address = upstream.address()
      if (!address || typeof address === 'string') throw new Error('Could not allocate upstream port.')
      const captures: Array<Awaited<ReturnType<typeof startProxyCapture>>> = []
      try {
        const shapedPort = await availablePort()
        const shaped = await startProxyCapture({
          port: shapedPort,
          mitmdumpPath: 'mitmdump',
          bandwidth: { profile: 'custom', downloadBytesPerSecond: 8 * 1024 },
          onDiagnostic: () => {},
        })
        captures.push(shaped)
        const shapedAt = Date.now()
        const shapedResponse = await sendHttpThroughProxy(shapedPort, address.port, '/shaped')
        const shapedElapsed = Date.now() - shapedAt
        await shaped.stop()
        expect(shapedResponse).toContain('x'.repeat(8 * 1024))
        expect(shapedElapsed).toBeGreaterThanOrEqual(800)

        const latencyPort = await availablePort()
        const delayed = await startProxyCapture({
          port: latencyPort,
          mitmdumpPath: 'mitmdump',
          bandwidth: { profile: 'custom', latencyMs: 120 },
          onDiagnostic: () => {},
        })
        captures.push(delayed)
        const delayedAt = Date.now()
        await sendHttpThroughProxy(latencyPort, address.port, '/delayed')
        const delayedElapsed = Date.now() - delayedAt
        await delayed.stop()
        expect(delayedElapsed).toBeGreaterThanOrEqual(90)

        const offlinePort = await availablePort()
        const offline = await startProxyCapture({
          port: offlinePort,
          mitmdumpPath: 'mitmdump',
          bandwidth: { profile: 'offline' },
          onDiagnostic: () => {},
        })
        captures.push(offline)
        const offlineResponse = await sendHttpThroughProxy(offlinePort, address.port, '/offline')
        await offline.stop()
        expect(offlineResponse).toContain('503')
        expect(offlineResponse).toContain('Offline network profile')
        expect(upstreamRequests).toBe(2)
      } finally {
        await Promise.allSettled(captures.map((capture) => capture.stop()))
        await new Promise<void>((resolve) => upstream.close(() => resolve()))
      }
    },
    20_000,
  )

  test.if(hasMitmdump)(
    'holds body-bearing requests and responses for live bridge edits, abort, timeout, and disconnect',
    async () => {
      const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 })
      relay.on('connection', (socket) =>
        socket.on('message', (data) => {
          for (const peer of relay.clients) if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data)
        }),
      )
      await new Promise<void>((resolve) => relay.once('listening', resolve))
      const relayAddress = relay.address()
      if (!relayAddress || typeof relayAddress === 'string') throw new Error('Could not allocate bridge port.')
      const bridgeUrl = `ws://127.0.0.1:${relayAddress.port}`
      const controller = await openWebSocket(bridgeUrl)
      let upstreamRequests = 0
      let upstreamMethod = ''
      let upstreamHeader = ''
      const upstream = createHttpServer((request, response) => {
        upstreamRequests += 1
        upstreamMethod = request.method ?? ''
        upstreamHeader = String(request.headers['x-breakpoint-edit'] ?? '')
        request.resume()
        response.writeHead(201, { 'Content-Type': 'text/plain', 'X-Upstream': 'original' })
        response.end('upstream-body')
      })
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
      const upstreamAddress = upstream.address()
      if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('Could not allocate upstream port.')
      const proxyPort = await availablePort()
      let breakpointReady: (() => void) | undefined
      const ready = new Promise<void>((resolve) => {
        breakpointReady = resolve
      })
      const capture = await startProxyCapture({
        port: proxyPort,
        mitmdumpPath: streamedBodyMitmdump(),
        bridgeUrl,
        enableBreakpoints: true,
        breakpointTimeoutMs: 150,
        onBreakpointReady: () => breakpointReady?.(),
        onDiagnostic: () => {},
      })
      try {
        await ready
        controller.send(
          JSON.stringify({
            type: 'control',
            payload: {
              kind: 'breakpoint.add',
              breakpoint: { id: 'proxy_live', pattern: '/live', on: 'both', enabled: true },
            },
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 40))

        const requestPausePromise = nextBreakpointPause(controller)
        const successfulResponse = sendBodyThroughProxy(proxyPort, upstreamAddress.port, '/live/success')
        const requestPause = await requestPausePromise
        expect(requestPause.payload).toMatchObject({
          kind: 'breakpoint.paused',
          ruleId: 'proxy_live',
          phase: 'request',
          request: { method: 'POST' },
        })
        expect(requestPause.payload.request).not.toHaveProperty('body')
        await new Promise((resolve) => setTimeout(resolve, 80))
        expect(upstreamRequests).toBe(0)
        const requestHeaders = requestPause.payload.request.headers as Record<string, string>
        const responsePausePromise = nextBreakpointPause(controller)
        controller.send(
          JSON.stringify({
            type: 'control',
            payload: {
              kind: 'breakpoint.resume',
              pauseId: requestPause.payload.pauseId,
              requestEdits: { method: 'PUT', headers: { ...requestHeaders, 'X-Breakpoint-Edit': 'applied' } },
            },
          }),
        )
        const responsePause = await responsePausePromise
        expect(upstreamRequests).toBe(1)
        expect(upstreamMethod).toBe('PUT')
        expect(upstreamHeader).toBe('applied')
        expect(responsePause.payload).toMatchObject({
          kind: 'breakpoint.paused',
          ruleId: 'proxy_live',
          phase: 'response',
          response: { status: 201 },
        })
        expect(responsePause.payload.response?.body).toBe('')
        const responseHeaders = responsePause.payload.response!.headers
        controller.send(
          JSON.stringify({
            type: 'control',
            payload: {
              kind: 'breakpoint.resume',
              pauseId: responsePause.payload.pauseId,
              responseEdits: { status: 299, headers: { ...responseHeaders, 'X-Breakpoint-Response': 'applied' } },
            },
          }),
        )
        const response = await successfulResponse
        expect(response).toContain('HTTP/1.1 299')
        expect(response.toLowerCase()).toContain('x-breakpoint-response: applied')
        expect(response).toContain('upstream-body')

        const abortPausePromise = nextBreakpointPause(controller)
        const abortedResponse = sendBodyThroughProxy(proxyPort, upstreamAddress.port, '/live/abort')
        const abortPause = await abortPausePromise
        controller.send(
          JSON.stringify({
            type: 'control',
            payload: { kind: 'breakpoint.abort', pauseId: abortPause.payload.pauseId },
          }),
        )
        expect(await abortedResponse).toBe('')
        expect(upstreamRequests).toBe(1)

        const timeoutPausePromise = nextBreakpointPause(controller)
        const timedOutResponse = sendBodyThroughProxy(proxyPort, upstreamAddress.port, '/live/timeout')
        await timeoutPausePromise
        expect(await timedOutResponse).toBe('')
        expect(upstreamRequests).toBe(1)

        const disconnectPausePromise = nextBreakpointPause(controller)
        const disconnectedResponse = sendBodyThroughProxy(proxyPort, upstreamAddress.port, '/live/disconnect')
        await disconnectPausePromise
        for (const socket of relay.clients) socket.terminate()
        expect(await disconnectedResponse).toBe('')
        expect(upstreamRequests).toBe(1)
      } finally {
        controller.terminate()
        await capture.stop()
        await new Promise<void>((resolve) => upstream.close(() => resolve()))
        await new Promise<void>((resolve) => relay.close(() => resolve()))
      }
    },
    20_000,
  )
  test.if(hasMitmdump)(
    'applies request and response headers, then blocks matching requests before upstream',
    async () => {
      let upstreamRequests = 0
      const upstream = createHttpServer((request, response) => {
        upstreamRequests += 1
        response.setHeader('Set-Cookie', 'session=secret')
        response.end(JSON.stringify({ requestHeader: request.headers['x-hakka-rule'] }))
      })
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
      const address = upstream.address()
      if (!address || typeof address === 'string') throw new Error('Could not allocate upstream port.')
      const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-rules-live-'))
      temporaryDirectories.push(directory)
      const config = join(directory, 'rules.json')
      writeFileSync(
        config,
        JSON.stringify({
          headerRules: [
            { match: '/headers$', phase: 'request', operation: 'set', name: 'X-Hakka-Rule', value: 'request' },
            { match: '/headers$', phase: 'response', operation: 'set', name: 'X-Hakka-Response', value: 'response' },
            { match: '/blocked$', phase: 'response', operation: 'set', name: 'X-Hakka-Blocked', value: 'response' },
          ],
          blockRules: [{ match: '/blocked$', status: 451, body: 'Blocked for test' }],
          delayRules: [{ match: '/delayed$', phase: 'response', delayMs: 120 }],
        }),
      )
      const proxyPort = await availablePort()
      const capture = await startProxyCapture({
        port: proxyPort,
        mitmdumpPath: 'mitmdump',
        mapConfig: config,
        onDiagnostic: () => {},
      })
      try {
        const allowed = await sendHttpThroughProxy(proxyPort, address.port, '/headers')
        expect(allowed).toContain('"requestHeader":"request"')
        expect(allowed.toLowerCase()).toContain('x-hakka-response: response')
        const delayedAt = Date.now()
        const delayed = await sendHttpThroughProxy(proxyPort, address.port, '/delayed')
        expect(delayed).toContain('200')
        expect(Date.now() - delayedAt).toBeGreaterThanOrEqual(90)
        const blocked = await sendHttpThroughProxy(proxyPort, address.port, '/blocked')
        expect(blocked).toContain('451')
        expect(blocked).toContain('Blocked for test')
        expect(blocked.toLowerCase()).toContain('x-hakka-blocked: response')
        expect(upstreamRequests).toBe(2)
      } finally {
        await capture.stop()
        await new Promise<void>((resolve) => upstream.close(() => resolve()))
      }
    },
    10_000,
  )

  test.if(hasMitmdump)(
    'blocks streamed uploads at request headers before they reach upstream',
    async () => {
      let upstreamRequests = 0
      const upstream = createHttpServer((_request, response) => {
        upstreamRequests += 1
        response.end('unexpected upstream request')
      })
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
      const address = upstream.address()
      if (!address || typeof address === 'string') throw new Error('Could not allocate upstream port.')
      const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-streamed-rule-'))
      temporaryDirectories.push(directory)
      const config = join(directory, 'rules.json')
      const body = join(directory, 'upload.bin')
      writeFileSync(config, JSON.stringify({ blockRules: [{ match: '/blocked-stream$', status: 451 }] }))
      writeFileSync(body, Buffer.alloc(32 * 1024, 'x'))
      const proxyPort = await availablePort()
      const capture = await startProxyCapture({
        port: proxyPort,
        mitmdumpPath: streamedBodyMitmdump(),
        mapConfig: config,
        onDiagnostic: () => {},
      })
      try {
        const response = await sendStreamedHttpThroughProxy(proxyPort, address.port, body)
        expect(response).toContain('451')
        expect(upstreamRequests).toBe(0)
      } finally {
        await capture.stop()
        await new Promise<void>((resolve) => upstream.close(() => resolve()))
      }
    },
    10_000,
  )

  test.if(hasMitmdump)(
    'captures a real websocket frame through mitmdump',
    async () => {
      const server = new WebSocketServer({ port: 0 })
      await new Promise<void>((resolve) => server.once('listening', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Could not allocate WebSocket server port.')
      const proxyPort = await availablePort()
      const capture = await startProxyCapture({ port: proxyPort, mitmdumpPath: 'mitmdump', onDiagnostic: () => {} })
      try {
        await sendWebSocketTextThroughProxy(proxyPort, address.port, 'hello')
        await new Promise((resolve) => setTimeout(resolve, 300))
        expect(
          capture.records.some(
            (record) => record.source === 'websocket' && record.messages?.some((message) => message.data === 'hello'),
          ),
        ).toBe(true)
      } finally {
        await capture.stop()
        for (const socket of server.clients) socket.terminate()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
    10_000,
  )
})
