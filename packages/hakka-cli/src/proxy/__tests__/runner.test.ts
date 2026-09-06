import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runProxyCommand } from '../../proxyCommand'
import { startProxyCapture } from '../runner'

const temporaryDirectories: string[] = []

function fakeMitmdump(mode: 'listen' | 'exit'): string {
  const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-sidecar-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'mitmdump')
  writeFileSync(
    path,
    `#!/usr/bin/env bun
const port = Number(Bun.argv[Bun.argv.indexOf('--listen-port') + 1])
if (${JSON.stringify(mode)} === 'exit') process.exit(3)
Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response('ok') })
console.log('{"type":"ready"}')
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
})
