import { afterEach, describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'

import type { NetworkRequest } from 'hakka-core'
import { WebSocketServer } from 'ws'

import { createEdgeRelayHandler } from '../edgeRelayHandler'

const record = (id: string): NetworkRequest =>
  ({
    id,
    url: `https://edge.example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    runtime: 'edge',
  }) as NetworkRequest

function post(handler: (request: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(
    new Request('http://localhost:3000/api/__hakka/edge-relay', { method: 'POST', body: JSON.stringify(body) }),
  )
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port
      probe.close(() => resolve(port))
    })
  })
}

async function startHub(): Promise<{ wss: WebSocketServer; url: string; ids: string[] }> {
  const port = await freePort()
  const ids: string[] = []
  const wss = new WebSocketServer({ port })
  wss.on('connection', (socket) => {
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as { type: string; payload?: NetworkRequest }
      if (frame.type === 'request' && frame.payload) ids.push(frame.payload.id)
    })
  })
  await new Promise((resolve) => wss.on('listening', resolve))
  return { wss, url: `ws://localhost:${port}`, ids }
}

async function waitFor(check: () => boolean): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > 4000) throw new Error('waitFor: timed out')
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 10))
  }
}

let hub: WebSocketServer | null = null
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  hub?.close()
  hub = null
  process.env.NODE_ENV = originalNodeEnv
})

describe('createEdgeRelayHandler', () => {
  test('forwards a posted Edge record to the bridge hub', async () => {
    const started = await startHub()
    hub = started.wss
    const handler = createEdgeRelayHandler({ bridgeUrl: started.url })

    const res = await post(handler, record('edge-1'))

    expect(res.status).toBe(202)
    await waitFor(() => started.ids.includes('edge-1'))
  })

  test('rejects a body that is not a request record', async () => {
    const handler = createEdgeRelayHandler()
    expect((await post(handler, { nope: true })).status).toBe(400)
    expect((await handler(new Request('http://localhost:3000/x', { method: 'POST', body: 'not json' }))).status).toBe(
      400,
    )
  })

  test('answers 404 in production unless forced', async () => {
    process.env.NODE_ENV = 'production'
    const started = await startHub()
    hub = started.wss

    expect((await post(createEdgeRelayHandler({ bridgeUrl: started.url }), record('prod-1'))).status).toBe(404)
    expect((await post(createEdgeRelayHandler({ bridgeUrl: started.url, force: true }), record('prod-2'))).status).toBe(
      202,
    )
    await waitFor(() => started.ids.includes('prod-2'))
    expect(started.ids).not.toContain('prod-1')
  })
})
