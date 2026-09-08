import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ProxySessionManager } from '../ProxySessionManager'

const directories: string[] = []

function sidecar(delayMs = 0): string {
  const directory = mkdtempSync(join(tmpdir(), 'hakka-proxy-manager-'))
  directories.push(directory)
  const path = join(directory, 'mitmdump')
  writeFileSync(
    path,
    `#!/usr/bin/env bun\nsetTimeout(() => console.log("{\\"type\\":\\"ready\\"}"), ${delayMs})\nsetInterval(() => {}, 1000)\n`,
  )
  chmodSync(path, 0o755)
  return path
}

async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!address || typeof address === 'string') throw new Error('no port')
  return address.port
}

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

describe('ProxySessionManager', () => {
  test('starts, reports public certificate metadata only, and stops its child', async () => {
    const manager = new ProxySessionManager()
    const status = await manager.start({
      sessionId: 'test',
      port: await port(),
      mitmdumpPath: sidecar(),
      configDir: join(tmpdir(), 'hakka-ca'),
    })
    expect(status.state).toBe('running')
    expect(status.certificates.privateKeyExposed).toBe(false)
    expect(status.certificates.publicCaPath).toEndWith('mitmproxy-ca-cert.pem')
    await expect(manager.stop('test')).resolves.toMatchObject({ state: 'stopped' })
  })

  test('requires explicit restart before changing mappings on a running session', async () => {
    const manager = new ProxySessionManager()
    await manager.start({ sessionId: 'maps', port: await port(), mitmdumpPath: sidecar() })
    await expect(manager.updateMappings('maps', undefined)).rejects.toThrow('restart: true')
    await manager.stop('maps')
  })

  test('stops a sidecar when shutdown is requested before readiness', async () => {
    const manager = new ProxySessionManager()
    const starting = manager.start({ sessionId: 'slow', port: await port(), mitmdumpPath: sidecar(100) })
    const stopping = manager.stop('slow')
    await expect(manager.start({ sessionId: 'slow', port: await port(), mitmdumpPath: sidecar() })).rejects.toThrow(
      'already running',
    )
    await expect(stopping).resolves.toMatchObject({ state: 'stopped' })
    await expect(starting).resolves.toMatchObject({ state: 'stopped' })
    expect(manager.status('slow').state).toBe('stopped')
  })
})
