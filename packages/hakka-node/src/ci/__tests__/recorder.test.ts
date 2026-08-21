import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { deserializeSession } from 'hakka-core'

import { stopCapture } from '../../serverCapture'
import { startCiCapture } from '../recorder'

afterEach(() => stopCapture())

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  )
}

describe('startCiCapture', () => {
  test('collects requests made via fetch while active', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)

    const capture = startCiCapture({ captureHttp: false })
    await fetch(`http://127.0.0.1:${port}/ping`)
    const requests = capture.stop()

    server.close()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.some((r) => r.url.includes('/ping'))).toBe(true)
  })

  test('does not start the bridge (no human watching a CI run)', () => {
    // bridge:false is the recorder's default — this just documents/locks that
    // behavior so a future change to serverCapture's defaults can't silently
    // make CI runs try to dial a bridge hub.
    const capture = startCiCapture()
    expect(capture.requests).toEqual([])
    capture.stop()
  })

  test('writes a valid .hakka session file when outFile is given', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    const outFile = join(tmpdir(), `hakka-ci-recorder-test-${Date.now()}.hakka`)

    const capture = startCiCapture({ captureHttp: false })
    await fetch(`http://127.0.0.1:${port}/ping`)
    capture.stop(outFile)
    server.close()

    try {
      expect(existsSync(outFile)).toBe(true)
      const parsed = deserializeSession(readFileSync(outFile, 'utf8'))
      expect(parsed.requests.some((r) => r.url.includes('/ping'))).toBe(true)
    } finally {
      rmSync(outFile, { force: true })
    }
  })

  test('share-scrubs the written file but leaves in-memory requests untouched', async () => {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => res.end('ok'))
    })
    const port = await listen(server)
    const outFile = join(tmpdir(), `hakka-ci-recorder-scrub-test-${Date.now()}.hakka`)

    const capture = startCiCapture({ captureHttp: false })
    await fetch(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-live-super-secret' }),
    })
    const inMemory = capture.stop(outFile)
    server.close()

    try {
      // In-memory: the real secret is still there — a local debugging
      // session should see exactly what was sent.
      expect(inMemory.some((r) => r.requestBody?.includes('sk-live-super-secret'))).toBe(true)

      // On disk: scrubbed — this file is a share surface (see module doc).
      const onDiskText = readFileSync(outFile, 'utf8')
      expect(onDiskText).not.toContain('sk-live-super-secret')
      const parsed = deserializeSession(onDiskText)
      expect(parsed.requests.some((r) => r.requestBody?.includes('[REDACTED]'))).toBe(true)
      expect(parsed.meta?.shareScrub).toBeDefined()
    } finally {
      rmSync(outFile, { force: true })
    }
  })
})
