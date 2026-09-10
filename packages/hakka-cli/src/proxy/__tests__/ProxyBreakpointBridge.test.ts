import { afterEach, describe, expect, test } from 'bun:test'
import { connect, type Socket } from 'node:net'

import WebSocket, { WebSocketServer } from 'ws'

import { createProxyBreakpointBridge, type ProxyBreakpointBridge } from '../ProxyBreakpointBridge'

const resources: Array<() => void | Promise<void>> = []

afterEach(async () => {
  await Promise.all(
    resources
      .splice(0)
      .reverse()
      .map((close) => close()),
  )
})

async function createRelay(): Promise<{ url: string; sockets: WebSocket[] }> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  const sockets: WebSocket[] = []
  server.on('connection', (socket) => {
    sockets.push(socket)
    socket.on('message', (data) => {
      for (const peer of sockets) if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data)
    })
  })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  resources.push(async () => {
    for (const socket of sockets) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Relay did not bind.')
  return { url: `ws://127.0.0.1:${address.port}`, sockets }
}

async function openWebSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  resources.push(() => socket.close())
  return socket
}

function lines(socket: Socket): { next(): Promise<Record<string, unknown>>; none(ms: number): Promise<boolean> } {
  let buffered = ''
  const queue: Record<string, unknown>[] = []
  const waiters: Array<(value: Record<string, unknown>) => void> = []
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffered += chunk
    let newline = buffered.indexOf('\n')
    while (newline >= 0) {
      const value = JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>
      buffered = buffered.slice(newline + 1)
      const waiter = waiters.shift()
      if (waiter) waiter(value)
      else queue.push(value)
      newline = buffered.indexOf('\n')
    }
  })
  return {
    next: () => {
      const value = queue.shift()
      return value ? Promise.resolve(value) : new Promise((resolve) => waiters.push(resolve))
    },
    none: async (ms) => {
      if (queue.length > 0) return false
      await new Promise((resolve) => setTimeout(resolve, ms))
      return queue.length === 0
    },
  }
}

async function connectAddon(
  bridge: ProxyBreakpointBridge,
): Promise<{ socket: Socket; line: ReturnType<typeof lines> }> {
  const socket = connect(bridge.addonPort, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  resources.push(() => socket.destroy())
  const line = lines(socket)
  socket.write(`${JSON.stringify({ type: 'auth', token: bridge.addonToken })}\n`)
  await line.next()
  return { socket, line }
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => socket.once('message', (data) => resolve(JSON.parse(data.toString()))))
}

describe('ProxyBreakpointBridge', () => {
  test('relays rules and bodyless pauses, rejects body edits, then applies valid request edits', async () => {
    const relay = await createRelay()
    const diagnostics: string[] = []
    let ready = 0
    const bridge = await createProxyBreakpointBridge({
      bridgeUrl: relay.url,
      onDiagnostic: (message) => diagnostics.push(message),
      onReady: () => ready++,
    })
    resources.push(() => bridge.close())
    const controller = await openWebSocket(relay.url)
    const addon = await connectAddon(bridge)
    expect(ready).toBe(1)

    controller.send(
      JSON.stringify({
        type: 'control',
        payload: {
          kind: 'breakpoint.add',
          breakpoint: { id: 'proxy_rule', pattern: '/held', on: 'request', enabled: true },
        },
      }),
    )
    expect(await addon.line.next()).toEqual({
      type: 'rules',
      breakpoints: [{ id: 'proxy_rule', pattern: '/held', on: 'request', enabled: true }],
    })

    const pauseFrame = nextMessage(controller)
    addon.socket.write(
      `${JSON.stringify({
        type: 'pause',
        pauseId: 'proxy_pause',
        ruleId: 'proxy_rule',
        phase: 'request',
        request: {
          url: 'http://example.test/held',
          method: 'POST',
          headers: { accept: '*/*', authorization: 'Bearer secret' },
        },
      })}\n`,
    )
    expect(await pauseFrame).toEqual({
      type: 'control',
      payload: {
        kind: 'breakpoint.paused',
        pauseId: 'proxy_pause',
        ruleId: 'proxy_rule',
        phase: 'request',
        device: 'Proxy Capture',
        request: {
          url: 'http://example.test/held',
          method: 'POST',
          headers: { accept: '*/*', authorization: '[REDACTED]' },
        },
      },
    })

    controller.send(
      JSON.stringify({
        type: 'control',
        payload: { kind: 'breakpoint.resume', pauseId: 'proxy_pause', requestEdits: { body: 'unsupported' } },
      }),
    )
    expect(await addon.line.none(40)).toBe(true)
    expect(diagnostics.at(-1)).toContain('body edits are unavailable')
    controller.send(
      JSON.stringify({
        type: 'control',
        payload: {
          kind: 'breakpoint.resume',
          pauseId: 'proxy_pause',
          requestEdits: { method: 'PUT', headers: { x: 'edited', authorization: '[REDACTED]' } },
        },
      }),
    )
    expect(await addon.line.next()).toEqual({
      type: 'action',
      pauseId: 'proxy_pause',
      action: 'resume',
      requestEdits: { method: 'PUT', headers: { x: 'edited', authorization: 'Bearer secret' } },
    })
  })

  test('aborts held pauses and clears rules when the desktop bridge disconnects', async () => {
    const relay = await createRelay()
    const bridge = await createProxyBreakpointBridge({ bridgeUrl: relay.url })
    resources.push(() => bridge.close())
    const addon = await connectAddon(bridge)
    addon.socket.write(
      `${JSON.stringify({
        type: 'pause',
        pauseId: 'held',
        phase: 'request',
        request: { url: 'http://example.test/', method: 'GET', headers: {} },
      })}\n`,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    relay.sockets[0]?.terminate()
    expect(await addon.line.next()).toEqual({ type: 'abort-all' })
    expect(await addon.line.next()).toEqual({ type: 'rules', breakpoints: [] })
  })

  test('enforces the 64-pause bound and aborts the overflow pause', async () => {
    const relay = await createRelay()
    const bridge = await createProxyBreakpointBridge({ bridgeUrl: relay.url })
    resources.push(() => bridge.close())
    await openWebSocket(relay.url)
    const addon = await connectAddon(bridge)
    for (let index = 0; index <= 64; index++)
      addon.socket.write(
        `${JSON.stringify({
          type: 'pause',
          pauseId: `pause_${index}`,
          phase: 'request',
          request: { url: `http://example.test/${index}`, method: 'GET', headers: {} },
        })}\n`,
      )
    expect(await addon.line.next()).toEqual({ type: 'action', pauseId: 'pause_64', action: 'abort' })
  })

  test('reclaims completed pauses so sequential watchdog expirations do not fill the pending bound', async () => {
    const relay = await createRelay()
    const bridge = await createProxyBreakpointBridge({ bridgeUrl: relay.url })
    resources.push(() => bridge.close())
    await openWebSocket(relay.url)
    const addon = await connectAddon(bridge)
    for (let index = 0; index < 64; index++) {
      addon.socket.write(
        `${JSON.stringify({
          type: 'pause',
          pauseId: `expired_${index}`,
          phase: 'request',
          request: { url: `http://example.test/${index}`, method: 'GET', headers: {} },
        })}\n${JSON.stringify({ type: 'complete', pauseId: `expired_${index}`, result: 'timeout' })}\n`,
      )
    }
    addon.socket.write(
      `${JSON.stringify({
        type: 'pause',
        pauseId: 'after_timeouts',
        phase: 'request',
        request: { url: 'http://example.test/final', method: 'GET', headers: {} },
      })}\n`,
    )
    expect(await addon.line.none(50)).toBe(true)
  })

  test('expires a malformed auth drip on an absolute deadline and closes every accepted socket', async () => {
    const relay = await createRelay()
    const bridge = await createProxyBreakpointBridge({ bridgeUrl: relay.url })
    resources.push(() => bridge.close())
    const dripping = connect(bridge.addonPort, '127.0.0.1')
    resources.push(() => dripping.destroy())
    await new Promise<void>((resolve) => dripping.once('connect', resolve))
    const drip = setInterval(() => dripping.write('{\n'), 40)
    const addon = await connectAddon(bridge)
    expect(await addon.line.none(20)).toBe(true)
    const drippingClosed = new Promise<void>((resolve) => dripping.once('close', resolve))
    await drippingClosed
    clearInterval(drip)

    const unauthenticated = connect(bridge.addonPort, '127.0.0.1')
    resources.push(() => unauthenticated.destroy())
    await new Promise<void>((resolve) => unauthenticated.once('connect', resolve))
    const unauthenticatedClosed = new Promise<void>((resolve) => unauthenticated.once('close', resolve))
    const started = performance.now()
    await bridge.close()
    await unauthenticatedClosed
    expect(performance.now() - started).toBeLessThan(500)
  }, 4_000)

  test('rejects an aggregate rule update over 64 KiB without mutating installed rules', async () => {
    const relay = await createRelay()
    const diagnostics: string[] = []
    const bridge = await createProxyBreakpointBridge({
      bridgeUrl: relay.url,
      onDiagnostic: (value) => diagnostics.push(value),
    })
    resources.push(() => bridge.close())
    const controller = await openWebSocket(relay.url)
    const addon = await connectAddon(bridge)
    const first = 'a'.repeat(55_000)
    controller.send(
      JSON.stringify({
        type: 'control',
        payload: { kind: 'breakpoint.add', breakpoint: { id: 'large_a', pattern: first, enabled: true } },
      }),
    )
    expect((await addon.line.next()).type).toBe('rules')
    controller.send(
      JSON.stringify({
        type: 'control',
        payload: { kind: 'breakpoint.add', breakpoint: { id: 'large_b', pattern: 'b'.repeat(15_000), enabled: true } },
      }),
    )
    expect(await addon.line.none(40)).toBe(true)
    expect(diagnostics.at(-1)).toContain('exceeds 64 KiB')
    controller.send(JSON.stringify({ type: 'control', payload: { kind: 'breakpoint.remove', id: 'large_a' } }))
    expect(await addon.line.next()).toEqual({ type: 'rules', breakpoints: [] })
  })
})
