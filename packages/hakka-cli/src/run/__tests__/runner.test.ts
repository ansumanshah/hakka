import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCollection } from '../runner.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function collection(request: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'hakka-runner-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'collection.hakka'),
    JSON.stringify({ version: 4, id: 'c', name: 'test', defaultHeaders: [], auth: { none: {} } }),
  )
  await writeFile(
    join(directory, 'request.hakka'),
    JSON.stringify({
      seq: 0,
      spec: {
        id: 'r',
        name: 'request',
        method: 'GET',
        url: 'http://127.0.0.1:1',
        headers: [],
        query: [],
        body: { none: {} },
        auth: { inherit: {} },
        assertions: [],
        captures: [],
        followRedirects: true,
        ...request,
        ...(request.scripts
          ? {
              scripts: {
                preRequestLines: [],
                postResponseLines: [],
                ...(request.scripts as Record<string, unknown>),
              },
            }
          : {}),
      },
    }),
  )
  return directory
}

test('runs a post-response hook once even without captures', async () => {
  const app = createServer((_, response) => response.end('ok'))
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise((resolve) => app.close(() => resolve())))
  const address = app.address() as { port: number }
  const directory = await collection({
    url: `http://127.0.0.1:${address.port}`,
    scripts: { postResponseLines: ['throw new Error("post hook ran")'] },
  })
  const report = await runCollection(directory)
  expect(report.items[0]?.outcome).toBe('failed')
  expect(report.items[0]?.assertions).toEqual(['script failed: post hook ran'])
})

test('rejects hooks before sending any request when scripts are disabled', async () => {
  let hits = 0
  const app = createServer((_, response) => {
    hits++
    response.end('ok')
  })
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise((resolve) => app.close(() => resolve())))
  const address = app.address() as { port: number }
  const directory = await collection({
    url: `http://127.0.0.1:${address.port}`,
    scripts: { postResponseLines: ['vars.set("x", "1")'] },
  })
  await expect(runCollection(directory, { allowScripts: false })).rejects.toThrow('scripts, which are disabled')
  expect(hits).toBe(0)
})

test('scrubs known environment values from hook failures', async () => {
  const directory = await collection({ scripts: { preRequestLines: ['throw new Error(env.CREDENTIAL)'] } })
  const report = await runCollection(directory, { environment: { CREDENTIAL: 'fake-review-credential-123' } })
  expect(report.items[0]?.error).not.toContain('fake-review-credential-123')
})

test('scrubs an authored API key echoed by a failing hook', async () => {
  const directory = await collection({
    headers: [{ name: 'X-Api-Key', value: 'literal-hook-api-key' }],
    scripts: { preRequestLines: ['throw new Error(request.headers["X-Api-Key"])'] },
  })
  const report = await runCollection(directory)
  expect(report.items[0]?.outcome).toBe('error')
  expect(JSON.stringify(report)).not.toContain('literal-hook-api-key')
})

test('cancels an iteration delay', async () => {
  const controller = new AbortController()
  const directory = await collection({})
  setTimeout(() => controller.abort(), 10)
  await expect(runCollection(directory, { repeat: 2, delayMs: 1_000, signal: controller.signal })).rejects.toThrow(
    'run cancelled',
  )
})

test('OAuth acquisition obeys the request deadline before contacting the API', async () => {
  let apiHits = 0
  const app = createServer((request, response) => {
    if (request.url === '/token') {
      const timer = setTimeout(() => response.end(JSON.stringify({ access_token: 'test-token' })), 500)
      response.on('close', () => clearTimeout(timer))
    } else {
      apiHits++
      response.end('ok')
    }
  })
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise((resolve) => {
        app.closeAllConnections()
        app.close(() => resolve())
      }),
  )
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
  const directory = await collection({
    url: base,
    auth: {
      oauth2: {
        _0: {
          grant: { clientCredentials: { _0: { tokenURL: `${base}/token`, clientId: 'test', clientSecret: '' } } },
        },
      },
    },
  })
  const report = await runCollection(directory, { timeoutMs: 20 })
  expect(report.items[0]?.error).toBe('request timed out')
  expect(apiHits).toBe(0)
})

test('upload symlinks cannot read outside the collection root', async () => {
  const directory = await collection({ body: { file: { path: 'external.txt', contentType: 'text/plain' } } })
  const outside = await mkdtemp(join(tmpdir(), 'hakka-outside-'))
  cleanups.push(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'secret.txt'), 'must-not-send')
  await symlink(join(outside, 'secret.txt'), join(directory, 'external.txt'))
  const report = await runCollection(directory)
  expect(report.items[0]?.error).toContain('outside the collection')
})
