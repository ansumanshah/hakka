import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startProxyCapture, type ProxyCapture } from '../runner'

const hasMitmdump = spawnSync('mitmdump', ['--version'], { stdio: 'ignore' }).status === 0
const servers: Server[] = []
let capture: ProxyCapture | undefined
let configDir: string | undefined

async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a test port.')
  return address.port
}

async function proxyRequest(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: 'http://example.test/upstream',
        headers: { host: 'example.test' },
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.once('end', () => resolve(body))
      },
    )
    client.setTimeout(2_000, () => client.destroy(new Error('Upstream test request timed out.')))
    client.once('error', reject)
    client.end()
  })
}

afterEach(async () => {
  await capture?.stop()
  capture = undefined
  if (configDir) rmSync(configDir, { recursive: true, force: true })
  configDir = undefined
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

test.skipIf(!hasMitmdump)('chains a capture through an HTTP upstream proxy', async () => {
  let forwardedURL = ''
  const upstreamPort = await listen(
    createServer((incoming, response) => {
      forwardedURL = incoming.url ?? ''
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('upstream response')
    }),
  )
  const capturePort = await listen(createServer())
  await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()))
  configDir = mkdtempSync(join(tmpdir(), 'hakka-upstream-test-'))
  const recorded = Promise.withResolvers<void>()
  capture = await startProxyCapture({
    configDir,
    bridgeUrl: 'ws://127.0.0.1:1',
    onRecord: () => recorded.resolve(),
    port: capturePort,
    mitmdumpPath: 'mitmdump',
    upstreamProxy: `http://127.0.0.1:${upstreamPort}`,
    onDiagnostic: () => {},
  })

  await expect(proxyRequest(capturePort)).resolves.toBe('upstream response')
  expect(forwardedURL).toBe('http://example.test/upstream')
  await recorded.promise
  expect(capture.records.some((record) => record.url === 'http://example.test/upstream')).toBe(true)
})
