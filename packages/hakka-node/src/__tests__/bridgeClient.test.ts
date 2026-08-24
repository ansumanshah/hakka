import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import net from 'node:net'

import { mockEngine, type NetworkRequest } from 'hakka-core'
import { WebSocket, WebSocketServer } from 'ws'

import { createBridgeClient, type BridgeClient } from '../bridgeClient'

/**
 * The queue is private to the client's closure by design (no inspection
 * hook), so every assertion here goes through a real `WebSocketServer` stub
 * hub and checks what actually crosses the wire — the same contract the real
 * `hakka-bridge` hub relies on.
 */

let client: BridgeClient | null = null
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
      // Safety net, matching packages/hakka-bridge/server.ts: some ws runtimes never
      // invoke the close callback, so don't let a stray hub hang the suite.
      setTimeout(done, 200)
    })
  }
})

function makeRequest(id: string, extra: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `http://example.com/${id}`,
    method: 'GET',
    startTime: 0,
    ...extra,
  }
}

/**
 * Reserves an OS-assigned free port and immediately releases it — lets a
 * test create the bridge client pointed at a real port *before* any hub is
 * listening there, so records enqueue while genuinely offline.
 */
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

/** Stub hub: accepts connections and records every frame it receives, in order. */
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

/** Polls for an async delivery condition instead of hardcoding a sleep. */
async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    // Deliberately sequential: this is a poll loop, not parallelisable work.
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 10))
  }
}

function payloadIds(messages: unknown[]): Array<string | undefined> {
  return (messages as Array<{ payload?: NetworkRequest }>).map((m) => m.payload?.id)
}

describe('createBridgeClient', () => {
  test('a record sent while connected arrives as a parseable { type: request, payload } frame', async () => {
    const port = await getFreePort()
    const started = await startHub(port)
    hub = started.wss

    client = createBridgeClient({ url: `ws://localhost:${port}` })
    await waitFor(() => client?.connected === true)

    const req = makeRequest('live-1')
    client.send(req)

    await waitFor(() => started.messages.length >= 1)
    const frame = started.messages[0] as { type?: string; payload?: NetworkRequest }
    expect(frame.type).toBe('request')
    expect(frame.payload?.id).toBe('live-1')
    expect(frame.payload?.url).toBe(req.url)
  })

  test('records queued while offline flush in order once the hub comes up', async () => {
    const port = await getFreePort()
    client = createBridgeClient({ url: `ws://localhost:${port}` })
    expect(client.connected).toBe(false) // nothing listening yet — enqueues offline

    client.send(makeRequest('q1'))
    client.send(makeRequest('q2'))
    client.send(makeRequest('q3'))

    const started = await startHub(port)
    hub = started.wss

    await waitFor(() => started.messages.length >= 3)
    expect(payloadIds(started.messages)).toEqual(['q1', 'q2', 'q3'])
  })

  test('byte cap evicts oldest records, keeping only the newest survivor', async () => {
    const port = await getFreePort()
    // Every record below shares the same id length ("big-N") and body size,
    // so their serialised frames are all exactly the same length — sizing
    // the cap at "one frame plus a few bytes" makes two frames always
    // exceed it, deterministically forcing eviction down to one survivor.
    const bodySize = 2000
    const oneFrameLen = JSON.stringify({
      type: 'request',
      payload: makeRequest('big-1', { requestBody: 'x'.repeat(bodySize) }),
    }).length

    client = createBridgeClient({
      url: `ws://localhost:${port}`,
      maxQueueBytes: oneFrameLen + 10,
    })
    expect(client.connected).toBe(false)

    client.send(makeRequest('big-1', { requestBody: 'x'.repeat(bodySize) }))
    client.send(makeRequest('big-2', { requestBody: 'x'.repeat(bodySize) }))
    client.send(makeRequest('big-3', { requestBody: 'x'.repeat(bodySize) }))

    const started = await startHub(port)
    hub = started.wss

    await waitFor(() => started.messages.length >= 1)
    // Give any (incorrect) extra delivery a beat to show up before asserting
    // the settled count — there's no positive event to wait for otherwise.
    await new Promise((r) => setTimeout(r, 100))

    expect(payloadIds(started.messages)).toEqual(['big-3'])
  })

  test('connected socket + tiny maxQueueBytes + one large record → the record ARRIVES (delivery before eviction)', async () => {
    const port = await getFreePort()
    const started = await startHub(port)
    hub = started.wss

    // A cap far smaller than the record we're about to send — if eviction ran
    // BEFORE a delivery attempt, this record would be dropped from the queue
    // on the way in and never reach the hub, even though the socket is open
    // and would happily deliver it right now.
    client = createBridgeClient({ url: `ws://localhost:${port}`, maxQueueBytes: 32 })
    await waitFor(() => client?.connected === true)

    const big = makeRequest('oversized-1', { requestBody: 'x'.repeat(5000) })
    client.send(big)

    await waitFor(() => started.messages.length >= 1)
    expect(payloadIds(started.messages)).toEqual(['oversized-1'])
  })

  test('count cap (MAX_QUEUE=1000) still evicts oldest when bytes alone would not trigger it', async () => {
    const port = await getFreePort()
    client = createBridgeClient({ url: `ws://localhost:${port}` }) // default 5 MiB byte cap — irrelevant here
    expect(client.connected).toBe(false)

    const total = 1005
    for (let i = 0; i < total; i++) {
      client.send(makeRequest(`c${i}`))
    }

    const started = await startHub(port)
    hub = started.wss

    await waitFor(() => started.messages.length >= 1000, 6000)
    // No further records should ever arrive beyond the count cap.
    await new Promise((r) => setTimeout(r, 150))

    const ids = payloadIds(started.messages)
    expect(ids.length).toBe(1000)
    expect(ids[0]).toBe('c5') // oldest 5 (c0..c4) evicted to hold the 1000 cap
    expect(ids[999]).toBe('c1004')
  })

  test('flush() respects ws backpressure: a high bufferedAmount stops draining mid-queue instead of calling send() unconditionally', async () => {
    const port = await getFreePort()
    const started = await startHub(port)
    hub = started.wss

    client = createBridgeClient({ url: `ws://localhost:${port}` })
    await waitFor(() => client?.connected === true)

    // `bufferedAmount` is a real getter on WebSocket.prototype (configurable,
    // no setter — verified via Object.getOwnPropertyDescriptor), so it can be
    // overridden directly instead of needing to actually saturate loopback's
    // multi-MB OS socket buffers to reproduce a slow-reading peer. Forcing it
    // above MAX_BUFFERED_AMOUNT (1 MiB) simulates exactly that without
    // touching send()/the real socket at all.
    const original = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount')
    Object.defineProperty(WebSocket.prototype, 'bufferedAmount', {
      configurable: true,
      get: () => 2 * 1024 * 1024,
    })

    try {
      client.send(makeRequest('backpressure-1'))
      client.send(makeRequest('backpressure-2'))

      // No positive event to wait for a non-delivery — give an (incorrect)
      // send a beat to show up before asserting nothing crossed the wire.
      await new Promise((r) => setTimeout(r, 150))
      expect(started.messages.length).toBe(0)
    } finally {
      // Restore before the next send() — and before any other test in this
      // process touches WebSocket.prototype again — regardless of assertion
      // outcome above.
      if (original) Object.defineProperty(WebSocket.prototype, 'bufferedAmount', original)
    }

    // Once bufferedAmount reports normally again, the next send()'s flush()
    // drains everything still sitting in `queue`, oldest first — proving the
    // records were retained during backpressure, not dropped.
    client.send(makeRequest('backpressure-3'))
    await waitFor(() => started.messages.length >= 3)
    expect(payloadIds(started.messages)).toEqual(['backpressure-1', 'backpressure-2', 'backpressure-3'])
  })
})

describe('createBridgeClient — inbound control frames', () => {
  beforeEach(() => mockEngine.clearRules())
  afterEach(() => mockEngine.clearRules())

  test('a { type: control, payload: mock.add } frame from the hub lands the rule in mockEngine', async () => {
    const port = await getFreePort()
    const started = await startHub(port)
    hub = started.wss

    client = createBridgeClient({ url: `ws://localhost:${port}` })
    await waitFor(() => client?.connected === true)

    // The hub is the one side that sends control frames (it relays whatever
    // the desktop app / MCP originated) — simulate that here by pushing one
    // straight from the stub hub to every connected socket, same as
    // `hakka-bridge`'s real relay does.
    for (const socket of started.wss.clients) {
      socket.send(
        JSON.stringify({
          type: 'control',
          payload: {
            kind: 'mock.add',
            rule: {
              id: 'bridge-control-test',
              pattern: 'example.com/mocked',
              enabled: true,
              response: { status: 200, body: '{"mocked":true}' },
            },
          },
        }),
      )
    }

    await waitFor(() => mockEngine.getRules().some((r) => r.id === 'bridge-control-test'))
    const rule = mockEngine.getRules().find((r) => r.id === 'bridge-control-test')
    expect(rule?.pattern).toBe('example.com/mocked')
    expect(rule?.response.status).toBe(200)
  })

  test('a malformed control frame is ignored, not thrown', async () => {
    const port = await getFreePort()
    const started = await startHub(port)
    hub = started.wss

    client = createBridgeClient({ url: `ws://localhost:${port}` })
    await waitFor(() => client?.connected === true)

    for (const socket of started.wss.clients) {
      socket.send(JSON.stringify({ type: 'control', payload: { kind: 'mock.add', rule: { id: 'x' } } }))
      socket.send('not json at all')
    }

    // Give both malformed frames a beat to be (mis)handled, then prove the
    // client is still alive and usable — the real assertion is "no crash".
    await new Promise((r) => setTimeout(r, 100))
    client.send(makeRequest('still-alive'))
    await waitFor(() => started.messages.some((m) => (m as { payload?: NetworkRequest }).payload?.id === 'still-alive'))
    expect(mockEngine.getRules().some((r) => r.id === 'x')).toBe(false)
  })

  test('handleControl: false keeps the client send-only — a control frame from the hub is ignored', async () => {
    const port = await getFreePort()
    const started = await startHub(port)
    hub = started.wss

    client = createBridgeClient({ url: `ws://localhost:${port}`, handleControl: false })
    await waitFor(() => client?.connected === true)

    for (const socket of started.wss.clients) {
      socket.send(
        JSON.stringify({
          type: 'control',
          payload: {
            kind: 'mock.add',
            rule: {
              id: 'should-not-apply',
              pattern: 'example.com/x',
              enabled: true,
              response: { status: 200, body: '{}' },
            },
          },
        }),
      )
    }

    await new Promise((r) => setTimeout(r, 150))
    expect(mockEngine.getRules().some((r) => r.id === 'should-not-apply')).toBe(false)
  })
})
