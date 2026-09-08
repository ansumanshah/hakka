import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { createServer as httpServer } from 'node:http'
import { createServer as http2Server } from 'node:http2'
import type { AddressInfo } from 'node:net'

import { WebSocketServer } from 'ws'

import { executeGrpc, executeSse, executeWebSocket } from './transports'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

test('SSE ignores comments and joins multiline data across CRLF chunk boundaries', async () => {
  const server = httpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(': heartbeat\r\n\r\nid: 4\r')
    setTimeout(() => response.end('\ndata: first\r\ndata: second\r\n\r\ndata: final\n\n'), 5)
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  const result = await executeSse(url, new Headers(), { maxEvents: 2, timeoutMs: 1000 })
  expect(JSON.parse(result.body).events).toEqual([
    { event: 'message', data: 'first\nsecond', id: '4' },
    { event: 'message', data: 'final', id: '4' },
  ])
})

test('SSE cancellation interrupts a peer that never sends data', async () => {
  const server = httpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.flushHeaders()
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  await expect(
    executeSse(url, new Headers(), { maxEvents: 1, timeoutMs: 1000 }, AbortSignal.timeout(20)),
  ).rejects.toThrow()
})

test('WebSocket preserves the handshake status and fails promptly on early close', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate()
        server.close(() => resolve())
      }),
  )
  server.on('connection', (socket) =>
    socket.once('message', (data) => {
      socket.send(data.toString())
      socket.close()
    }),
  )
  const url = new URL(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`)
  const spec = { sendFrames: [{ data: 'hello', isBinary: false }], maxFrames: 1, timeoutMs: 1000 }
  const result = await executeWebSocket(url, new Headers(), spec)
  expect(result.status).toBe(101)
  expect(JSON.parse(result.body).frames).toEqual([{ data: 'hello', isBinary: false }])
  await expect(executeWebSocket(url, new Headers(), { ...spec, maxFrames: 2 })).rejects.toThrow(
    'closed before maxFrames',
  )
})

test('gRPC validates framing and requires real status trailers', async () => {
  const server = http2Server()
  server.on('stream', (stream, headers) => {
    stream.on('error', () => {})
    stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
    stream.on('wantTrailers', () =>
      stream.sendTrailers(headers[':path'] === '/test/invalid' ? {} : { 'grpc-status': '0' }),
    )
    stream.end(Buffer.from([0, 0, 0, 0, 2, 8, 1]))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const base = `grpc://127.0.0.1:${(server.address() as AddressInfo).port}`
  const result = await executeGrpc(new URL(`${base}/test/ok`), new Headers(), '0801', 1000)
  expect(JSON.parse(result.body).messageBase64).toBe('CAE=')
  await expect(executeGrpc(new URL(`${base}/test/invalid`), new Headers(), '0801', 1000)).rejects.toThrow('grpc-status')
})

test('gRPC connection refusal rejects without an unhandled client error', async () => {
  const server = httpServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await expect(executeGrpc(new URL(`grpc://127.0.0.1:${port}/test/echo`), new Headers(), '', 1000)).rejects.toThrow()
})
