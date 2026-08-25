import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { connect, type Socket } from 'node:net'

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

function consoleFrame(id: string, message: string): string {
  return JSON.stringify({ type: 'console', payload: [{ id, timestamp: 1, level: 'info', message }] })
}

function storageFrame(store: string, entries: Record<string, string>): string {
  return JSON.stringify({ type: 'storage', payload: { store, timestamp: 1, entries } })
}

/**
 * Completes just the WebSocket opening handshake over a raw TCP socket, with
 * no `ws` client involved on this end — so, unlike a real `ws.WebSocket`,
 * this peer never auto-responds to a ping with a pong. Simulates a peer gone
 * dark without a close frame (dropped network, frozen/backgrounded device):
 * `ws.WebSocket.pause()` would normally be the way to make a real client stop
 * reading, but it's a no-op on this suite's runtime (`ws.WebSocket.pause()
 * is not implemented in bun`), so this drives the handshake directly instead.
 */
function openRawSilentPeer(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      const key = randomBytes(16).toString('base64')
      socket.write(
        `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    socket.once('error', reject)
    let buffered = ''
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString('latin1')
      if (!buffered.includes('\r\n\r\n')) return
      socket.off('data', onData)
      if (!buffered.startsWith('HTTP/1.1 101')) {
        reject(new Error(`expected a 101 handshake response, got: ${buffered.split('\r\n')[0]}`))
        return
      }
      resolve(socket)
    }
    socket.on('data', onData)
  })
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

describe('startBridgeServer (console + storage)', () => {
  test('relays a console frame live to other peers, never buffered', async () => {
    server = await startBridgeServer({ port: 0 })
    const url = `ws://localhost:${server.port}`

    const sender = await open(url)
    const viewer = await open(url)
    const relayed = nextMessage(viewer)

    sender.send(consoleFrame('log_1', 'hello'))

    const got = JSON.parse(await relayed)
    expect(got.type).toBe('console')
    expect(got.payload[0].message).toBe('hello')
    expect(server.hub.size).toBe(0)

    sender.close()
    viewer.close()
  })

  test('a late joiner gets no replayed console frames — logs are a live stream only', async () => {
    server = await startBridgeServer({ port: 0 })
    server.hub.ingest(requestFrame('buffered-request'))
    server.hub.ingest(consoleFrame('log_1', 'already scrolled by'))

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

  test('relays a storage frame live to other peers and replays the latest snapshot to a new peer', async () => {
    server = await startBridgeServer({ port: 0 })
    const url = `ws://localhost:${server.port}`

    const sender = await open(url)
    const viewer = await open(url)
    const relayed = nextMessage(viewer)

    sender.send(storageFrame('defaults', { theme: 'dark' }))

    const got = JSON.parse(await relayed)
    expect(got.type).toBe('storage')
    expect(got.payload.store).toBe('defaults')
    expect(got.payload.entries).toEqual({ theme: 'dark' })

    // A newly-connected third peer gets the latest snapshot on connect.
    const lateJoiner = await open(url)
    const replayed = JSON.parse(await nextMessage(lateJoiner))
    expect(replayed).toEqual({
      type: 'storage',
      payload: { store: 'defaults', timestamp: 1, entries: { theme: 'dark' } },
    })

    sender.close()
    viewer.close()
    lateJoiner.close()
  })

  test('replaying storage to a new peer sends only the latest snapshot per store, not history', async () => {
    server = await startBridgeServer({ port: 0 })
    server.hub.ingest(storageFrame('defaults', { a: '1', b: '2' }))
    server.hub.ingest(storageFrame('defaults', { a: '1' })) // replaces the first — `b` is gone

    const viewer = await open(`ws://localhost:${server.port}`)
    const got = JSON.parse(await nextMessage(viewer))
    expect(got.payload.entries).toEqual({ a: '1' })

    let extra = false
    viewer.on('message', () => {
      extra = true
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(extra).toBe(false)

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

  /**
   * `JSON.parse` is iterative and accepts nesting far past what the recursive
   * `JSON.stringify` can re-serialize. A frame in that gap parsed cleanly,
   * entered the replay buffer, and then threw `RangeError` while serving the
   * *next* peer to connect — outside any try/catch, killing the hub process
   * and every peer on it. One ordinary-looking frame from any peer.
   */
  test('a frame too deep to re-serialize never enters the replay buffer', async () => {
    server = await startBridgeServer({ port: 0 })
    const sender = await open(`ws://127.0.0.1:${server.port}`)

    const depth = 50_000
    const deep = `{"type":"request","payload":{"id":"deep","url":"https://x","method":"GET","nested":${'['.repeat(depth)}${']'.repeat(depth)}}}`
    sender.send(deep)
    sender.send(requestFrame('ordinary'))
    await new Promise((r) => setTimeout(r, 60))

    // The hostile frame is refused; the ordinary one that followed still lands.
    expect(server.hub.getRecords().map((r) => r.id)).toEqual(['ordinary'])

    // The join that used to crash the process.
    const viewer = await open(`ws://127.0.0.1:${server.port}`)
    const replayed = await nextMessage(viewer)
    expect(JSON.parse(replayed).payload.id).toBe('ordinary')

    sender.close()
    viewer.close()
  })

  test('ordinary nesting is still accepted', async () => {
    server = await startBridgeServer({ port: 0 })
    const sender = await open(`ws://127.0.0.1:${server.port}`)

    const nested = `{"type":"request","payload":{"id":"nested","url":"https://x","method":"GET","body":${'['.repeat(50)}${']'.repeat(50)}}}`
    sender.send(nested)
    await new Promise((r) => setTimeout(r, 60))

    expect(server.hub.getRecords().map((r) => r.id)).toEqual(['nested'])
    sender.close()
  })
})

describe('startBridgeServer (frame size)', () => {
  /**
   * `ws` defaults `maxPayload` to 100MB and the hub exposed no way to lower
   * it, so the record-count bound was the only limit on how much a peer could
   * make the buffer hold.
   */
  test('a frame past maxPayload is rejected instead of buffered', async () => {
    server = await startBridgeServer({ port: 0, maxPayload: 4096 })
    const sender = await open(`ws://127.0.0.1:${server.port}`)

    const huge = JSON.stringify({
      type: 'request',
      payload: { id: 'huge', url: 'https://x', method: 'GET', requestBody: 'x'.repeat(8192) },
    })
    sender.send(huge)
    await new Promise((r) => setTimeout(r, 60))

    expect(server.hub.getRecords()).toHaveLength(0)
  })

  test('an ordinary frame under the cap still lands', async () => {
    server = await startBridgeServer({ port: 0, maxPayload: 4096 })
    const sender = await open(`ws://127.0.0.1:${server.port}`)

    sender.send(requestFrame('small'))
    await new Promise((r) => setTimeout(r, 60))

    expect(server.hub.getRecords().map((r) => r.id)).toEqual(['small'])
    sender.close()
  })

  /**
   * `maxPayload` is a byte budget, but the bun-fallback re-check used to
   * compare `raw.length` — UTF-16 code units — against it. A run of
   * multi-byte characters (CJK here: 3 bytes in UTF-8, 1 UTF-16 code unit
   * each) inflates the byte length well past the char length, so a frame
   * that should be rejected slipped through on that comparison alone.
   */
  test('a frame whose byte length exceeds maxPayload but whose UTF-16 length does not is still rejected', async () => {
    const huge = JSON.stringify({
      type: 'request',
      payload: { id: 'wide', url: 'https://x', method: 'GET', requestBody: '中'.repeat(2000) },
    })
    const maxPayload = huge.length + 10 // above the UTF-16 length, below the byte length
    expect(Buffer.byteLength(huge, 'utf8')).toBeGreaterThan(maxPayload)

    server = await startBridgeServer({ port: 0, maxPayload })
    const sender = await open(`ws://127.0.0.1:${server.port}`)

    sender.send(huge)
    await new Promise((r) => setTimeout(r, 60))

    expect(server.hub.getRecords()).toHaveLength(0)
    sender.close()
  })
})

describe('startBridgeServer (heartbeat / dead-peer detection)', () => {
  test('pings connected peers on the configured heartbeat cadence', async () => {
    server = await startBridgeServer({ port: 0, heartbeatIntervalMs: 20 })
    const ws = await open(`ws://127.0.0.1:${server.port}`)

    await new Promise<void>((resolve) => ws.once('ping', () => resolve()))

    ws.close()
  })

  test('terminates a peer that never responds to pings, without disrupting other peers', async () => {
    server = await startBridgeServer({ port: 0, heartbeatIntervalMs: 20 })

    // A raw socket that completes the WS handshake but then goes silent —
    // no 'close'/'error' fires on the server side on its own; only an
    // active heartbeat notices and reaps it.
    const victim = await openRawSilentPeer(server.port)

    await new Promise<void>((resolve) => victim.once('close', () => resolve()))

    // The reaped dead peer didn't wedge the server or its client set.
    const alive = await open(`ws://127.0.0.1:${server.port}`)
    alive.close()
    victim.destroy()
  })

  test('a peer that keeps answering pings is never terminated', async () => {
    server = await startBridgeServer({ port: 0, heartbeatIntervalMs: 20 })
    const ws = await open(`ws://127.0.0.1:${server.port}`)

    let closed = false
    ws.on('close', () => {
      closed = true
    })
    // `ws` auto-responds to pings with pongs at the protocol level with no
    // application code involved; give the heartbeat several ticks to prove a
    // normally-behaving peer is left alone.
    await new Promise((r) => setTimeout(r, 120))

    expect(closed).toBe(false)
    ws.close()
  })

  test('clears the heartbeat interval when the WebSocketServer fails to bind (EADDRINUSE)', async () => {
    server = await startBridgeServer({ port: 0 })
    const port = server.port

    // The failing instance's own heartbeat is the only `setInterval` call in
    // this window — `wss.on('listening', ...)` (which would start mDNS, etc.)
    // never fires on a bind failure, so this is exactly the interval the
    // regression is about: created unconditionally, must be cleared on the
    // `error` path too, not just inside the success-only `close()`.
    const setIntervalSpy = spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval')

    await expect(startBridgeServer({ port })).rejects.toThrow()

    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    const heartbeatHandle = setIntervalSpy.mock.results[0]?.value
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeatHandle)

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })
})
