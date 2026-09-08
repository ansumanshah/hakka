import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createHttp2Server } from 'node:http2'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WebSocketServer } from 'ws'

import { runCollection } from '../runCommand'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hakka-run-'))
  dirs.push(dir)
  await Promise.all(
    Object.entries(files).map(async ([name, value]) =>
      writeFile(join(dir, name), `${JSON.stringify(value, null, 2)}\n`),
    ),
  )
  return dir
}
async function server(): Promise<{ base: string; seen: string[]; close: () => Promise<void> }> {
  const seen: string[] = []
  const app = createServer(async (request, response) => {
    const body = await new Promise<string>((done) => {
      let value = ''
      request.on('data', (chunk: Buffer) => {
        value += chunk
      })
      request.on('end', () => done(value))
    })
    seen.push(`${request.method} ${request.url} ${request.headers.authorization ?? ''} ${body}`)
    if (request.url === '/login') {
      response.setHeader('content-type', 'application/json')
      response.end('{"id":"42"}')
      return
    }
    if (request.url === '/token') {
      response.setHeader('content-type', 'application/json')
      response.end('{"access_token":"token-from-endpoint","refresh_token":"rotated"}')
      return
    }
    if (request.url === '/users/42') {
      response.end('ok')
      return
    }
    if (request.url === '/slow') {
      setTimeout(() => response.end('late'), 100)
      return
    }
    if (request.url === '/stream') {
      response.write('first')
      setTimeout(() => response.end('late'), 100)
      return
    }
    response.statusCode = 500
    response.end('no')
  })
  await new Promise<void>((done) => app.listen(0, '127.0.0.1', done))
  const address = app.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  return {
    base: `http://127.0.0.1:${address.port}`,
    seen,
    close: () => new Promise((done, fail) => app.close((error) => (error ? fail(error) : done()))),
  }
}
function request(
  seq: number,
  id: string,
  name: string,
  method: string,
  url: string,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    seq,
    spec: {
      id,
      name,
      method,
      url,
      headers: [],
      query: [],
      body: { none: {} },
      auth: { inherit: {} },
      assertions: [{ id: `${id}-status`, target: { status: {} }, op: 'equals', expected: '200', enabled: true }],
      captures: [],
      followRedirects: true,
      ...extra,
    },
  }
}

describe('runCollection', () => {
  it('runs in saved sequence, captures values, interpolates auth, and writes redacted reports', async () => {
    const local = await server()
    try {
      const dir = await fixture({
        'collection.hakka': {
          version: 4,
          id: 'c',
          name: 'test',
          defaultHeaders: [],
          auth: { bearer: { token: '{{TOKEN}}' } },
          notes: null,
        },
        'second.hakka': request(1, 'get', 'get user', 'GET', '{{BASE}}/users/{{id}}'),
        'first.hakka': request(0, 'login', 'login', 'GET', '{{BASE}}/login', {
          captures: [{ id: 'capture', variable: 'id', source: { jsonPath: { _0: 'id' } }, enabled: true }],
        }),
      })
      const json = join(dir, 'report.json')
      const xml = join(dir, 'report.xml')
      const report = await runCollection(dir, {
        environment: { BASE: local.base, TOKEN: 'never-print-me' },
        jsonReport: json,
        junitReport: xml,
      })
      expect(report.failed).toBe(0)
      expect(report.items.map((item) => item.name)).toEqual(['login', 'get user'])
      expect(local.seen).toEqual(['GET /login Bearer never-print-me ', 'GET /users/42 Bearer never-print-me '])
      expect(await readFile(json, 'utf8')).not.toContain('never-print-me')
      expect(await readFile(xml, 'utf8')).toContain('tests="2"')
    } finally {
      await local.close()
    }
  })

  it('runs every dataset row in order and turns assertions into a failing report', async () => {
    const local = await server()
    try {
      const dir = await fixture({
        'collection.hakka': { version: 4, id: 'c', name: 'test', defaultHeaders: [], auth: { none: {} }, notes: null },
        'request.hakka': request(0, 'bad', 'bad', 'GET', '{{BASE}}/{{path}}'),
      })
      const data = join(dir, 'rows.csv')
      await writeFile(data, 'path,unused\nusers/42,\n"missing",\n')
      const report = await runCollection(dir, { environment: { BASE: local.base }, dataFile: data, repeat: 2 })
      expect(report.items).toHaveLength(4)
      expect(report.passed).toBe(2)
      expect(report.failed).toBe(2)
    } finally {
      await local.close()
    }
  })

  it('reports bounded request timeouts as failures', async () => {
    const local = await server()
    try {
      const dir = await fixture({
        'collection.hakka': { version: 4, id: 'c', name: 'test', defaultHeaders: [], auth: { none: {} }, notes: null },
        'slow.hakka': request(0, 'slow', 'slow', 'GET', '{{BASE}}/slow'),
      })
      const report = await runCollection(dir, { environment: { BASE: local.base }, timeoutMs: 10 })
      expect(report.items[0]?.error).toBe('request timed out')
    } finally {
      await local.close()
    }
  })

  it('keeps the timeout active while a response body is streaming', async () => {
    const local = await server()
    try {
      const dir = await fixture({
        'collection.hakka': { version: 4, id: 'c', name: 'test', defaultHeaders: [], auth: { none: {} }, notes: null },
        'stream.hakka': request(0, 'stream', 'stream', 'GET', '{{BASE}}/stream'),
      })
      const report = await runCollection(dir, { environment: { BASE: local.base }, timeoutMs: 10 })
      expect(report.items[0]?.error).toBe('request timed out')
    } finally {
      await local.close()
    }
  })

  it('rejects an unresolved header before it sends the request', async () => {
    const local = await server()
    try {
      const dir = await fixture({
        'collection.hakka': { version: 4, id: 'c', name: 'test', defaultHeaders: [], auth: { none: {} }, notes: null },
        'request.hakka': request(0, 'one', 'one', 'GET', `${local.base}/users/42`, {
          headers: [{ id: 'h', name: 'X-Test', value: '{{MISSING}}', enabled: true }],
        }),
      })
      const report = await runCollection(dir)
      expect(report.items[0]?.error).toContain('missing variables: MISSING')
      expect(local.seen).toHaveLength(0)
    } finally {
      await local.close()
    }
  })

  it('rejects non-finite run limits instead of silently succeeding', async () => {
    const dir = await fixture({
      'collection.hakka': { version: 4, id: 'c', name: 'test', defaultHeaders: [], auth: { none: {} }, notes: null },
      'request.hakka': request(0, 'one', 'one', 'GET', 'http://127.0.0.1:1'),
    })
    await expect(runCollection(dir, { repeat: 0 })).rejects.toThrow('--repeat must be an integer')
    await expect(runCollection(dir, { timeoutMs: Number.NaN })).rejects.toThrow('--timeout-ms must be an integer')
  })

  it('sends binary multipart files relative to the collection and runs hook mutations', async () => {
    const local = await server()
    try {
      const dir = await fixture({
        'collection.hakka': { version: 4, id: 'c', name: 'test', defaultHeaders: [], auth: { none: {} }, notes: null },
        'upload.hakka': request(0, 'upload', 'upload', 'POST', '{{BASE}}/login', {
          scripts: {
            preRequestLines: ["request.headers['X-Hook'] = 'yes'; vars.set('hooked', '42')"],
            postResponseLines: ["vars.set('responseStatus', response.status)"],
          },
          headers: [],
          body: {
            multipart: {
              _0: [
                { id: 'text', name: 'field', value: '{{hooked}}', enabled: true },
                {
                  id: 'file',
                  name: 'file',
                  value: '',
                  filePath: 'payload.bin',
                  contentType: 'application/octet-stream',
                  enabled: true,
                },
              ],
            },
          },
        }),
      })
      await writeFile(join(dir, 'payload.bin'), Buffer.from([0, 255, 10]))
      const report = await runCollection(dir, { environment: { BASE: local.base } })
      expect(report.failed).toBe(0)
      expect(local.seen[0]).toContain('field')
      expect(local.seen[0]).toContain('42')
    } finally {
      await local.close()
    }
  })

  it('obtains a client-credentials token without reporting it', async () => {
    const local = await server()
    try {
      const dir = await fixture({
        'collection.hakka': { version: 4, id: 'c', name: 'test', defaultHeaders: [], auth: { none: {} }, notes: null },
        'request.hakka': request(0, 'oauth', 'oauth', 'GET', '{{BASE}}/users/42', {
          auth: {
            oauth2: {
              _0: {
                grant: {
                  clientCredentials: {
                    _0: {
                      tokenURL: '{{BASE}}/token',
                      clientId: 'client',
                      clientSecret: 'secret',
                      scope: 'read',
                    },
                  },
                },
                accessTokenVariable: 'token',
                refreshTokenVariable: 'refresh',
                expiresAtVariable: 'expiry',
              },
            },
          },
        }),
      })
      const report = await runCollection(dir, { environment: { BASE: local.base } })
      expect(report.items[0]?.outcome).toBe('passed')
      expect(local.seen).toContain(`GET /users/42 Bearer token-from-endpoint `)
    } finally {
      await local.close()
    }
  })

  it('runs bounded WebSocket and SSE sessions and exposes their JSON bodies to assertions', async () => {
    const webSocket = new WebSocketServer({ port: 0 })
    webSocket.on('connection', (socket) =>
      socket.on('message', (message) => {
        socket.send(message)
        socket.send('second')
      }),
    )
    await new Promise<void>((done) => webSocket.once('listening', done))
    const address = webSocket.address()
    if (!address || typeof address === 'string') throw new Error('no websocket address')
    const sse = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('event: first\ndata: one\n\n')
      response.end('event: second\ndata: two\n\n')
    })
    await new Promise<void>((done) => sse.listen(0, '127.0.0.1', done))
    const sseAddress = sse.address()
    if (!sseAddress || typeof sseAddress === 'string') throw new Error('no sse address')
    try {
      const dir = await fixture({
        'collection.hakka': {
          version: 5,
          id: 'c',
          name: 'sessions',
          defaultHeaders: [],
          auth: { none: {} },
          notes: null,
        },
        'ws.hakka': request(0, 'ws', 'ws', 'GET', `ws://127.0.0.1:${address.port}`, {
          session: { webSocket: { sendFrames: [{ data: 'one', isBinary: false }], maxFrames: 2, timeoutMs: 500 } },
          assertions: [
            {
              id: 'frames',
              target: { jsonPath: { _0: 'frames[1].data' } },
              op: 'equals',
              expected: 'second',
              enabled: true,
            },
          ],
        }),
        'sse.hakka': request(1, 'sse', 'sse', 'GET', `http://127.0.0.1:${sseAddress.port}`, {
          session: { sse: { maxEvents: 2, timeoutMs: 500 } },
          assertions: [
            {
              id: 'events',
              target: { jsonPath: { _0: 'events[1].data' } },
              op: 'equals',
              expected: 'two',
              enabled: true,
            },
          ],
        }),
      })
      const report = await runCollection(dir)
      expect(report.failed).toBe(0)
    } finally {
      await new Promise<void>((done) => webSocket.close(() => done()))
      await new Promise<void>((done, fail) => sse.close((error) => (error ? fail(error) : done())))
    }
  })

  it('runs a canonical raw unary gRPC request over HTTP/2 and asserts its trailer', async () => {
    const grpc = createHttp2Server()
    grpc.on('stream', (stream) => {
      stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
      stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }))
      stream.end(Buffer.from([0, 0, 0, 0, 0]))
    })
    await new Promise<void>((done) => grpc.listen(0, '127.0.0.1', done))
    const address = grpc.address()
    if (!address || typeof address === 'string') throw new Error('no grpc address')
    try {
      const dir = await fixture({
        'collection.hakka': { version: 5, id: 'c', name: 'grpc', defaultHeaders: [], auth: { none: {} }, notes: null },
        'grpc.hakka': request(0, 'grpc', 'grpc', 'POST', `grpc://127.0.0.1:${address.port}/demo.Echo/Ping`, {
          body: { grpcMessage: { hex: '0a00' } },
          assertions: [
            { id: 'status', target: { header: { name: 'grpc-status' } }, op: 'equals', expected: '0', enabled: true },
          ],
        }),
      })
      expect((await runCollection(dir)).failed).toBe(0)
    } finally {
      await new Promise<void>((done, fail) => grpc.close((error) => (error ? fail(error) : done())))
    }
  })
})
