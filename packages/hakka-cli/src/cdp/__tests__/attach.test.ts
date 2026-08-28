import { afterEach, describe, expect, test } from 'bun:test'

import { WebSocketServer, type WebSocket as WsSocket } from 'ws'

import { createWsTransport } from '../attach'

/**
 * `createWsTransport` is the only hand-rolled piece of `hakka cdp` — the rest of
 * the CDP path was moved verbatim from the old `hakka-cdp` package. It speaks
 * JSON-RPC over a raw socket, so it owns id correlation and, critically, the
 * settling of in-flight requests when that socket dies.
 *
 * Asserted against a real `WebSocketServer` stub rather than a mock, matching
 * `bridgeClient.test.ts` — the pending map is private to the closure by design.
 */

let hub: WebSocketServer | null = null

afterEach(async () => {
  if (!hub) return
  const toClose = hub
  hub = null
  // `close()` waits on lingering connections, so terminate them first and keep
  // a timeout fallback — same shape as `bridgeClient.test.ts`.
  for (const client of toClose.clients) client.terminate()
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
})

/** Start a stub debugger endpoint; `onMessage` decides how it answers. */
async function startStubDebugger(
  onMessage: (socket: WsSocket, msg: { id: number; method: string }) => void,
): Promise<string> {
  hub = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => hub!.once('listening', () => resolve()))
  hub.on('connection', (socket) => {
    socket.on('message', (data) => onMessage(socket, JSON.parse(data.toString('utf8'))))
  })
  const { port } = hub.address() as { port: number }
  return `ws://127.0.0.1:${port}`
}

describe('createWsTransport', () => {
  test('correlates responses to their request id, not arrival order', async () => {
    // Answers out of order, so a transport that matched positionally would fail.
    const url = await startStubDebugger((socket, msg) => {
      const delay = msg.method === 'Slow.call' ? 40 : 0
      setTimeout(() => socket.send(JSON.stringify({ id: msg.id, result: { echoed: msg.method } })), delay)
    })

    const { transport, socket, ready } = createWsTransport(url)
    await ready

    const [slow, fast] = await Promise.all([
      transport.send<{ echoed: string }>('Slow.call'),
      transport.send<{ echoed: string }>('Fast.call'),
    ])

    expect(slow.echoed).toBe('Slow.call')
    expect(fast.echoed).toBe('Fast.call')
    socket.close()
  })

  test('rejects in-flight requests when the socket closes instead of hanging', async () => {
    // Regression guard. `runCdpAttach` shuts down on the debuggee's socket
    // closing (the tab was closed) and that path calls `capture.stop()`, which
    // sends CDP commands over the now-dead socket. Without settling `pending`
    // here those promises never resolve, `stop()`'s `.finally()` never fires,
    // and the process hangs instead of exiting.
    const url = await startStubDebugger((socket) => socket.close()) // never answers

    const { transport, socket, ready } = createWsTransport(url)
    await ready

    const inFlight = transport.send('Network.enable')
    await expect(inFlight).rejects.toThrow(/closed/i)

    socket.close()
  })
})
