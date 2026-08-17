import { afterEach, describe, expect, test } from 'bun:test'

import { WebSocket } from 'ws'

import { advertiseHostFor, startBridgeServer, type BridgeServer } from '../server'

let server: BridgeServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => ws.once('message', (d) => resolve(d.toString())))
}

function requestFrame(id: string): string {
  return JSON.stringify({ type: 'request', payload: { id, url: 'https://x', method: 'GET' } })
}

function controlFrame(kind: string): string {
  return JSON.stringify({ type: 'control', payload: { kind } })
}

function spanFrame(id: string, traceId: string, parentId: string | null = null): string {
  return JSON.stringify({ type: 'span', payload: { id, traceId, parentId } })
}

/** Opens a WebSocket with a caller-supplied `Origin` header, like a real browser tab would send. */
function openWithOrigin(url: string, origin: string | undefined): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin === undefined ? undefined : { headers: { Origin: origin } })
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

/** Resolves with the close code, or rejects if the socket instead received a message (i.e. wasn't rejected). */
function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.once('close', (code) => resolve(code))
    ws.once('message', (d) => reject(new Error(`expected close, got message: ${d.toString()}`)))
  })
}

describe('startBridgeServer (e2e)', () => {
  test('receives a request frame, buffers it, and relays to other peers', async () => {
    server = await startBridgeServer({ port: 0 })
    const url = `ws://localhost:${server.port}`

    const sender = await open(url)
    const viewer = await open(url)
    const relayed = nextMessage(viewer)

    sender.send(requestFrame('r1'))

    const got = await relayed
    expect(JSON.parse(got).payload.id).toBe('r1')
    expect(server.hub.size).toBe(1)

    sender.close()
    viewer.close()
  })

  test('replays the buffer to a newly connected peer', async () => {
    server = await startBridgeServer({ port: 0 })
    server.hub.ingest(requestFrame('buffered'))

    const viewer = await open(`ws://localhost:${server.port}`)
    const got = await nextMessage(viewer)
    expect(JSON.parse(got).payload.id).toBe('buffered')

    viewer.close()
  })

  test('relays a span frame live to other peers, unaffected by buffering', async () => {
    server = await startBridgeServer({ port: 0 })
    const url = `ws://localhost:${server.port}`

    const sender = await open(url)
    const viewer = await open(url)
    const relayed = nextMessage(viewer)

    sender.send(spanFrame('s1', 't1'))

    const got = await relayed
    const parsed = JSON.parse(got)
    expect(parsed.type).toBe('span')
    expect(parsed.payload.id).toBe('s1')

    sender.close()
    viewer.close()
  })

  test('relays a control frame to other peers without buffering it or firing onRecord', async () => {
    const records: string[] = []
    server = await startBridgeServer({ port: 0, onRecord: (r) => records.push(r.id) })
    const url = `ws://localhost:${server.port}`

    const sender = await open(url)
    const viewer = await open(url)
    const relayed = nextMessage(viewer)

    sender.send(controlFrame('throttle.set'))

    const got = await relayed
    const parsed = JSON.parse(got)
    expect(parsed.type).toBe('control')
    expect(parsed.payload.kind).toBe('throttle.set')
    expect(server.hub.size).toBe(0)
    expect(records).toEqual([])

    sender.close()
    viewer.close()
  })

  test('never echoes a control frame back to the sender', async () => {
    server = await startBridgeServer({ port: 0 })
    const sender = await open(`ws://localhost:${server.port}`)

    let echoed = false
    sender.on('message', () => {
      echoed = true
    })
    sender.send(controlFrame('mock.clear'))

    // Give the event loop a turn; no message should arrive back at the sender.
    await new Promise((r) => setTimeout(r, 50))
    expect(echoed).toBe(false)

    sender.close()
  })
})

describe('startBridgeServer (span backlog)', () => {
  test('replays buffered spans to a newly connected peer, after the request replay', async () => {
    server = await startBridgeServer({ port: 0 })
    server.hub.ingest(requestFrame('buffered-request'))
    server.hub.ingest(spanFrame('s1', 't1'))
    server.hub.ingest(spanFrame('s2', 't1', 's1'))

    const viewer = await open(`ws://localhost:${server.port}`)
    const first = JSON.parse(await nextMessage(viewer))
    const second = JSON.parse(await nextMessage(viewer))
    const third = JSON.parse(await nextMessage(viewer))

    expect(first).toEqual({ type: 'request', payload: { id: 'buffered-request', url: 'https://x', method: 'GET' } })
    expect(second.type).toBe('span')
    expect(second.payload.id).toBe('s1')
    expect(third.type).toBe('span')
    expect(third.payload.id).toBe('s2')

    viewer.close()
  })

  test('a late joiner with no buffered spans gets no span frames', async () => {
    server = await startBridgeServer({ port: 0 })
    server.hub.ingest(requestFrame('buffered-request'))

    const viewer = await open(`ws://localhost:${server.port}`)
    const only = JSON.parse(await nextMessage(viewer))
    expect(only.type).toBe('request')

    let extra = false
    viewer.on('message', () => {
      extra = true
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(extra).toBe(false)

    viewer.close()
  })

  test('enforces maxSpans/maxSpansPerTrace on the hub constructed by startBridgeServer', async () => {
    server = await startBridgeServer({ port: 0, maxSpans: 2, maxSpansPerTrace: 1 })
    server.hub.ingest(spanFrame('s1', 't1'))
    server.hub.ingest(spanFrame('s2', 't1', 's1')) // evicts s1 (per-trace cap)
    server.hub.ingest(spanFrame('s3', 't2')) // t1:[s2], t2:[s3] — total 2, at cap
    server.hub.ingest(spanFrame('s4', 't3')) // pushes total to 3 — evicts whole t1

    const viewer = await open(`ws://localhost:${server.port}`)
    const got = JSON.parse(await nextMessage(viewer))
    expect(got.type).toBe('span')
    expect(got.payload.id).toBe('s3')
    const second = JSON.parse(await nextMessage(viewer))
    expect(second.payload.id).toBe('s4')

    viewer.close()
  })
})

describe('startBridgeServer (connection gating)', () => {
  test('closes a connection with a disallowed browser Origin before the buffer replay', async () => {
    server = await startBridgeServer({ port: 0 })
    server.hub.ingest(requestFrame('buffered'))

    const ws = await openWithOrigin(`ws://localhost:${server.port}`, 'https://evil.example')
    const code = await nextClose(ws)
    expect(code).toBe(1008)
  })

  test('accepts a localhost browser Origin and replays the buffer', async () => {
    server = await startBridgeServer({ port: 0 })
    server.hub.ingest(requestFrame('buffered'))

    const ws = await openWithOrigin(`ws://localhost:${server.port}`, 'http://localhost:5173')
    const got = await nextMessage(ws)
    expect(JSON.parse(got).payload.id).toBe('buffered')

    ws.close()
  })

  test('accepts a connection with no Origin header (non-browser peer)', async () => {
    server = await startBridgeServer({ port: 0 })
    server.hub.ingest(requestFrame('buffered'))

    const ws = await openWithOrigin(`ws://localhost:${server.port}`, undefined)
    const got = await nextMessage(ws)
    expect(JSON.parse(got).payload.id).toBe('buffered')

    ws.close()
  })

  test('rejects a connection missing a required token', async () => {
    server = await startBridgeServer({ port: 0, token: 'secret-token' })

    const ws = await open(`ws://localhost:${server.port}`)
    const code = await nextClose(ws)
    expect(code).toBe(1008)
  })

  test('rejects a connection with the wrong token', async () => {
    server = await startBridgeServer({ port: 0, token: 'secret-token' })

    const ws = await open(`ws://localhost:${server.port}?token=wrong-token`)
    const code = await nextClose(ws)
    expect(code).toBe(1008)
  })

  test('accepts a connection with the correct token', async () => {
    server = await startBridgeServer({ port: 0, token: 'secret-token' })
    server.hub.ingest(requestFrame('buffered'))

    const ws = await open(`ws://localhost:${server.port}?token=secret-token`)
    const got = await nextMessage(ws)
    expect(JSON.parse(got).payload.id).toBe('buffered')

    ws.close()
  })
})

describe('startBridgeServer (mDNS advertise wiring)', () => {
  test('does not advertise on the default loopback-only host, even though advertise defaults to true', async () => {
    // The default `host` (127.0.0.1) is unreachable from other devices, so advertising it
    // via mDNS would just mislead LAN browsers into a dead connection attempt — the server
    // skips it regardless of the `advertise` opt-out flag. See discovery.test.ts for the
    // mDNS service-config + lifecycle unit tests (faked, no real socket).
    server = await startBridgeServer({ port: 0 })
    expect(server.mdnsAdvertising).toBe(false)
  })

  test('does not advertise when explicitly disabled, even on a non-loopback host', async () => {
    server = await startBridgeServer({ port: 0, host: '0.0.0.0', advertise: false })
    expect(server.mdnsAdvertising).toBe(false)
  })

  test('wires the bound host through to the advertiser (0.0.0.0 -> no specific host)', async () => {
    let captured: { host?: string; disabled?: boolean } | undefined
    server = await startBridgeServer({
      port: 0,
      host: '0.0.0.0',
      createAdvertisement: (opts) => {
        captured = opts
        return { active: true, close: () => Promise.resolve() }
      },
    })
    expect(captured?.disabled).toBe(false)
    expect(captured?.host).toBeUndefined()
  })
})

describe('advertiseHostFor', () => {
  // Exercised in isolation since binding to an arbitrary LAN IP isn't
  // guaranteed to work in CI; see `server.ts` for the full behavior.
  test('passes a specific non-loopback IP through unchanged', () => {
    expect(advertiseHostFor('192.168.1.68')).toBe('192.168.1.68')
  })

  test('omits the host for the all-interfaces wildcard (0.0.0.0)', () => {
    expect(advertiseHostFor('0.0.0.0')).toBeUndefined()
  })
})

describe('startBridgeServer (close race safety)', () => {
  test('wss stops listening even when advertisement.close() never resolves', async () => {
    server = await startBridgeServer({
      port: 0,
      host: '0.0.0.0',
      createAdvertisement: () => ({
        active: true,
        // Simulates a hung mDNS goodbye; `wss.close()` must still run and the
        // WS server must actually stop listening.
        close: () => new Promise<void>(() => {}),
      }),
    })
    const port = server.port

    const start = Date.now()
    await server.close()
    expect(Date.now() - start).toBeLessThan(1000)

    // The WS server must have actually stopped listening (not just "close() resolved").
    await expect(open(`ws://localhost:${port}`)).rejects.toBeTruthy()
    server = null
  })

  test('close() is idempotent — a second call resolves without hanging or throwing', async () => {
    server = await startBridgeServer({ port: 0 })
    await server.close()
    await expect(server.close()).resolves.toBeUndefined()
  })
})
