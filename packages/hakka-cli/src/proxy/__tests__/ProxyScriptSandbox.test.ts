import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadProxyScriptFile,
  runProxyScriptHook,
  validateProxyScript,
  type ProxyScriptProgram,
} from '../ProxyScriptSandbox'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function program(source: string): ProxyScriptProgram {
  return { path: '/tmp/proxy-script.js', source }
}

function request(body: string | null = 'hello') {
  return { url: 'https://example.test/path', method: 'POST', headers: { accept: 'text/plain' }, body }
}

test('applies bounded request and response mutations', async () => {
  const source = `
function onRequest(request) {
  request.method = "PUT";
  request.url = "https://example.test/changed";
  request.headers["x-script"] = "request";
  request.body = request.body.toUpperCase();
}
function onResponse(response, request) {
  response.status = request.method === "POST" ? 201 : 500;
  response.headers["x-script"] = "response";
  response.body += "!";
}`
  const loaded = program(source)
  await expect(validateProxyScript(loaded)).resolves.toBeUndefined()
  await expect(runProxyScriptHook(loaded, { phase: 'request', request: request() })).resolves.toEqual({
    outcome: 'applied',
    request: {
      url: 'https://example.test/changed',
      method: 'PUT',
      headers: { accept: 'text/plain', 'x-script': 'request' },
      body: 'HELLO',
    },
  })
  await expect(
    runProxyScriptHook(loaded, {
      phase: 'response',
      request: request(),
      response: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'world' },
    }),
  ).resolves.toEqual({
    outcome: 'applied',
    request: request(),
    response: { status: 201, headers: { 'content-type': 'text/plain', 'x-script': 'response' }, body: 'world!' },
  })
})

test('times out an infinite loop and does not include thrown values in diagnostics', async () => {
  const loop = await runProxyScriptHook(program('function onRequest() { while (true) {} }'), {
    phase: 'request',
    request: request(),
  })
  expect(loop).toMatchObject({ outcome: 'error', code: 'timeout' })

  const secret = 'private-token-value'
  const thrown = await runProxyScriptHook(program(`function onRequest() { throw new Error("${secret}") }`), {
    phase: 'request',
    request: request(),
  })
  expect(thrown).toMatchObject({ outcome: 'error', code: 'script-error' })
  expect(JSON.stringify(thrown)).not.toContain(secret)
})

test('enforces the memory limit', async () => {
  const result = await runProxyScriptHook(
    program('function onRequest(request) { request.body = "x".repeat(32 * 1024 * 1024); }'),
    { phase: 'request', request: request() },
  )
  expect(result).toMatchObject({ outcome: 'error', code: 'memory-limit' })
})

test('does not expose Node, filesystem, or network capabilities', async () => {
  const result = await runProxyScriptHook(
    program(`function onRequest(request) {
      request.headers.capabilities = [typeof process, typeof require, typeof fetch, typeof WebSocket, typeof XMLHttpRequest].join(",");
    }`),
    { phase: 'request', request: request() },
  )
  expect(result).toMatchObject({
    outcome: 'applied',
    request: { headers: { capabilities: 'undefined,undefined,undefined,undefined,undefined' } },
  })
})

test('rejects oversized source, body output, invalid headers, method, URL, and status', async () => {
  const directory = join(tmpdir(), `hakka-proxy-script-${crypto.randomUUID()}`)
  directories.push(directory)
  mkdirSync(directory)
  const path = join(directory, 'large.js')
  writeFileSync(path, ' '.repeat(256 * 1024 + 1))
  expect(() => loadProxyScriptFile(path)).toThrow('256 KiB')

  const cases = [
    'request.body = "x".repeat(1024 * 1024 + 1)',
    'request.headers["bad\\nname"] = "x"',
    'request.method = "BAD METHOD"',
    'request.url = "file:///etc/passwd"',
  ]
  for (const mutation of cases) {
    const result = await runProxyScriptHook(program(`function onRequest(request) { ${mutation}; }`), {
      phase: 'request',
      request: request(),
    })
    expect(result).toMatchObject({ outcome: 'error', code: 'invalid-output' })
  }
  const responseResult = await runProxyScriptHook(program('function onResponse(response) { response.status = 42; }'), {
    phase: 'response',
    request: request(),
    response: { status: 200, headers: {}, body: null },
  })
  expect(responseResult).toMatchObject({ outcome: 'error', code: 'invalid-output' })
})

test('requires at least one synchronous hook', async () => {
  await expect(validateProxyScript(program('const value = 1'))).rejects.toThrow('Define onRequest')
  await expect(validateProxyScript(program('function onRequest( {'))).rejects.toThrow('threw an exception')
})
