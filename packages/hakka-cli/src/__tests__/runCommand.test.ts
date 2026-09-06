import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
})
