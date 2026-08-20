/**
 * The redaction-boundary invariant from ADR 0004 (e): no unredacted sensitive
 * header or body value may appear in a frame handed to `bridgeClient.send()`.
 *
 * The existing redaction tests cover the redaction *functions* in isolation.
 * Nothing proved the ordering end-to-end — that redaction completes inside the
 * synchronous capture path, before the record is serialized onto the wire. So
 * these tests drive a real `http` request through the real interceptor, hand
 * the resulting record to a real bridge client, and assert against the exact
 * string that crosses a real socket. Substring assertions, deliberately: the
 * question is not "is the field named correctly" but "can these bytes leave
 * the machine".
 *
 * Writing it found two capture paths that were building records with
 * unredacted bodies — this file is the regression fence.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

import { configureBodyRedaction, type NetworkRequest } from 'hakka-core'
import { WebSocketServer } from 'ws'

import { createBridgeClient, type BridgeClient } from '../bridgeClient'
import { disableHttpInterceptor, enableHttpInterceptor } from '../httpInterceptor'

const HEADER_SECRET = 'Bearer sk-live-51H8xQpZ'
const BODY_SECRET = 'hunter2-correct-horse'

let client: BridgeClient | null = null
let hub: WebSocketServer | null = null
let server: Server | null = null

afterEach(async () => {
  disableHttpInterceptor()
  configureBodyRedaction([])
  client?.close()
  client = null
  server?.close()
  server = null
  if (hub) {
    const toClose = hub
    hub = null
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      toClose.close(() => done())
      setTimeout(done, 200)
    })
  }
})

function listen(s: Server): Promise<number> {
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port)))
}

/** Stub hub that keeps every frame as the raw string it arrived as — not parsed, so nothing can re-encode a leak away. */
function startHub(): Promise<{ wss: WebSocketServer; port: number; frames: string[] }> {
  return new Promise((resolve, reject) => {
    const frames: string[] = []
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    wss.on('error', reject)
    wss.on('connection', (socket) => {
      socket.on('message', (raw) => frames.push(raw.toString()))
    })
    wss.on('listening', () => {
      const address = wss.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ wss, port, frames })
    })
  })
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))

/**
 * Drive one real POST through the real interceptor, relay whatever it captures
 * through a real bridge client, and return every frame the hub received.
 */
async function captureThroughBridge(requestBody: string): Promise<string[]> {
  server = http.createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  const appPort = await listen(server)

  const started = await startHub()
  hub = started.wss

  client = createBridgeClient({ url: `ws://127.0.0.1:${started.port}` })
  await settle()

  // The interceptor's own listener is the seam a real integration uses: the
  // record it hands over is the record that gets serialized.
  enableHttpInterceptor((record: NetworkRequest) => client?.send(record), 1_000_000, ['authorization'])

  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: appPort,
        path: '/login',
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: HEADER_SECRET },
      },
      (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      },
    )
    req.on('error', reject)
    req.write(requestBody)
    req.end()
  })

  await settle(80)
  return started.frames
}

describe('redaction boundary — ADR 0004 (e)', () => {
  test('a sensitive header value never reaches the wire', async () => {
    const frames = await captureThroughBridge('{"user":"ada"}')

    expect(frames.length).toBeGreaterThan(0)
    const wire = frames.join('')
    expect(wire).not.toContain(HEADER_SECRET)
    expect(wire).not.toContain('sk-live-51H8xQpZ')
    expect(wire).toContain('[REDACTED]')
  })

  test('a configured body field never reaches the wire', async () => {
    configureBodyRedaction(['password'])
    const frames = await captureThroughBridge(`{"user":"ada","password":"${BODY_SECRET}"}`)

    expect(frames.length).toBeGreaterThan(0)
    const wire = frames.join('')
    expect(wire).not.toContain(BODY_SECRET)
    // The key survives, only the value is blanked — redaction is a value
    // replace, per the redaction spec.
    expect(wire).toContain('password')
    expect(wire).toContain('[REDACTED]')
  })

  test('a nested body field never reaches the wire', async () => {
    configureBodyRedaction(['token'])
    const frames = await captureThroughBridge(`{"auth":{"nested":{"token":"${BODY_SECRET}"}},"user":"ada"}`)

    const wire = frames.join('')
    expect(wire).not.toContain(BODY_SECRET)
    expect(wire).toContain('[REDACTED]')
  })

  test('with redaction unconfigured the body still crosses intact', async () => {
    // The invariant is "redact what was configured", not "mangle everything".
    // A body field nobody asked to redact must survive, or the inspector is
    // lying about what the app sent.
    const frames = await captureThroughBridge('{"user":"ada","note":"keep-me"}')

    const wire = frames.join('')
    expect(wire).toContain('keep-me')
  })
})
