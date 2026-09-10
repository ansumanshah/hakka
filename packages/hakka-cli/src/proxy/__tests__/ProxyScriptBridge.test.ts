import { afterEach, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createProxyScriptBridge, type ProxyScriptBridge } from '../ProxyScriptBridge'

const directories: string[] = []
const bridges: ProxyScriptBridge[] = []

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function scriptFile(source = 'function onRequest(request) { request.headers["x-script"] = "yes"; }'): string {
  const directory = join(tmpdir(), `hakka-proxy-script-${crypto.randomUUID()}`)
  directories.push(directory)
  mkdirSync(directory)
  const path = join(directory, 'script.js')
  writeFileSync(path, source)
  return path
}

function lines(socket: Socket): AsyncIterableIterator<string> {
  socket.setEncoding('utf8')
  let buffer = ''
  const queued: string[] = []
  let wake: (() => void) | undefined
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      queued.push(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
    wake?.()
    wake = undefined
  })
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      while (!queued.length)
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      return { value: queued.shift()!, done: false }
    },
  }
}

test('requires launch token authentication and executes hooks over loopback JSONL', async () => {
  let ready = 0
  const bridge = await createProxyScriptBridge({ scriptPath: scriptFile(), onReady: () => ready++ })
  bridges.push(bridge)

  const rejected = connect({ host: '127.0.0.1', port: bridge.addonPort })
  const rejectedClose = new Promise<void>((resolve) => rejected.once('close', () => resolve()))
  rejected.write('{"type":"auth","token":"wrong"}\n')
  await rejectedClose

  const socket = connect({ host: '127.0.0.1', port: bridge.addonPort })
  const output = lines(socket)
  socket.write(`${JSON.stringify({ type: 'auth', token: bridge.addonToken })}\n`)
  expect(JSON.parse((await output.next()).value)).toEqual({ type: 'authenticated' })
  expect(ready).toBe(1)
  socket.write(
    `${JSON.stringify({
      type: 'hook',
      id: 'one',
      phase: 'request',
      request: { url: 'https://example.test/', method: 'GET', headers: {}, body: null },
    })}\n`,
  )
  expect(JSON.parse((await output.next()).value)).toMatchObject({
    type: 'result',
    id: 'one',
    outcome: 'applied',
    request: { headers: { 'x-script': 'yes' } },
  })
  socket.destroy()
})

test('rejects a script without hooks before opening a socket', async () => {
  await expect(createProxyScriptBridge({ scriptPath: scriptFile('const noHook = true') })).rejects.toThrow(
    'Define onRequest',
  )
})

test('round trips request and response hooks through the Python helper', async () => {
  const bridge = await createProxyScriptBridge({
    scriptPath: scriptFile(`
function onRequest(request) { request.method = "PATCH"; request.headers["x-request-script"] = "yes"; request.body += "!"; }
function onResponse(response) { response.status = 202; response.headers["x-response-script"] = "yes"; response.body = "changed"; }
`),
  })
  bridges.push(bridge)
  const helper = fileURLToPath(new URL('../hakka_script_helper.py', import.meta.url))
  const harness = String.raw`
import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("hakka_script_helper", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class Headers(dict):
    def items(self, multi=False): return super().items()
class Message:
    def __init__(self, body):
        self.pretty_url = "https://example.test/path"; self.url = self.pretty_url; self.method = "POST"
        self.headers = Headers({"content-type": "text/plain"}); self.raw_content = body; self.status_code = 200
    def get_content(self, strict=False): return getattr(self, "content", self.raw_content)
request = Message(b"request"); response = Message(b"response")
flow = type("Flow", (), {"request": request, "response": response})()
async def run():
    client = module.HakkaScriptHelper.from_environment()
    results = [await client.request(flow), await client.response(flow)]
    await client.close()
    return {"results": results, "method": flow.request.method, "requestHeaders": flow.request.headers,
            "requestBody": flow.request.content.decode(), "status": flow.response.status_code,
            "responseHeaders": flow.response.headers, "responseBody": flow.response.content.decode()}
print(json.dumps(asyncio.run(run())))
`
  const child = spawn('python3', ['-c', harness, helper], {
    env: {
      ...process.env,
      HAKKA_PROXY_SCRIPT_PORT: String(bridge.addonPort),
      HAKKA_PROXY_SCRIPT_TOKEN: bridge.addonToken,
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
  const code = await new Promise<number | null>((resolve) => child.once('close', resolve))
  expect(code, stderr).toBe(0)
  expect(JSON.parse(stdout)).toEqual({
    results: [true, true],
    method: 'PATCH',
    requestHeaders: { 'content-type': 'text/plain', 'x-request-script': 'yes' },
    requestBody: 'request!',
    status: 202,
    responseHeaders: { 'content-type': 'text/plain', 'x-response-script': 'yes' },
    responseBody: 'changed',
  })
})
