import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WebSocketServer } from 'ws'

import { runProxyCommand } from '../../proxyCommand'
import { startProxyCapture } from '../runner'

const temporaryDirectories: string[] = []
const hasMitmdump = spawnSync('mitmdump', ['--version'], { stdio: 'ignore' }).status === 0

function fakeMitmdump(mode: 'listen' | 'exit' | 'snapshots' | 'ignore-term' | 'ready-ignore-term'): string {
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
setInterval(() => {}, 1_000)
`,
  )
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
