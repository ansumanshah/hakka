import { afterEach, describe, expect, test } from 'bun:test'
import net from 'node:net'

import type { NetworkRequest } from 'hakka-core'
import { WebSocketServer, type WebSocket } from 'ws'

import { bridge, createCdpBridgeClient, type CdpBridgeClient } from '../bridgeClient'

/**
 * Mirrors hakka-node's `bridgeClient.test.ts` — asserts against what actually
 * crosses a real `WebSocketServer` stub hub, since the client's queue is
 * private to its closure by design.
 */

let client: CdpBridgeClient | null = null
let hub: WebSocketServer | null = null

afterEach(async () => {
  client?.close()
  client = null
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

function makeRequest(id: string, extra: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `https://example.com/${id}`,
    method: 'GET',
    startTime: 0,
    ...extra,
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

function startHub(port: number): Promise<{ wss: WebSocketServer; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = []
    const wss = new WebSocketServer({ port })
    wss.on('error', reject)
    wss.on('connection', (socket: WebSocket) => {
      socket.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()))
        } catch {
          // Not expected in these tests — ignore rather than fail the hub.
        }
      })
    })
    wss.on('listening', () => resolve({ wss, messages }))
  })
}

async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('createCdpBridgeClient', () => {
  test('a record sent while connected arrives as a { type: request, payload } frame', async () => {
    const port = await getFreePort()
    const started = await startHub(port)
    hub = started.wss

    client = createCdpBridgeClient({ url: `ws://localhost:${port}` })
    await waitFor(() => client?.connected === true)

    const req = makeRequest('cdp-1')
    client.send(req)

    await waitFor(() => started.messages.length >= 1)
    const frame = started.messages[0] as { type?: string; payload?: NetworkRequest }
    expect(frame.type).toBe('request')
    expect(frame.payload?.id).toBe('cdp-1')
    expect(frame.payload?.url).toBe(req.url)
  })

  test('records queued while offline flush in order once the hub comes up', async () => {
    const port = await getFreePort()
    client = createCdpBridgeClient({ url: `ws://localhost:${port}` })
    expect(client.connected).toBe(false)

    client.send(makeRequest('q1'))
    client.send(makeRequest('q2'))
    client.send(makeRequest('q3'))

    const started = await startHub(port)
    hub = started.wss

    await waitFor(() => started.messages.length >= 3)
    const ids = (started.messages as Array<{ payload?: NetworkRequest }>).map((m) => m.payload?.id)
    expect(ids).toEqual(['q1', 'q2', 'q3'])
  })

  test('bridge(url) is the same client, usable directly as onRequest', async () => {
    const port = await getFreePort()
    const started = await startHub(port)
    hub = started.wss

    client = bridge(`ws://localhost:${port}`)
    await waitFor(() => client?.connected === true)

    client.send(makeRequest('via-bridge-helper'))

    await waitFor(() => started.messages.length >= 1)
    const frame = started.messages[0] as { payload?: NetworkRequest }
    expect(frame.payload?.id).toBe('via-bridge-helper')
  })
})
