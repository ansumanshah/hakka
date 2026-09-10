import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(new URL('../hakka_script_helper.py', import.meta.url))

test('applies request and response edits while preserving unavailable binary bodies', () => {
  const harness = String.raw`
import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("hakka_script_helper", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Headers(dict):
    def items(self, multi=False): return super().items()
class Message:
    def __init__(self, body=b"hello"):
        self.pretty_url = "https://example.test/original"; self.url = self.pretty_url
        self.method = "POST"; self.headers = Headers({"accept": "text/plain"})
        self.raw_content = body; self.status_code = 200
request = Message(b"\xff\x00")
response = Message(b"world")
flow = type("Flow", (), {"request": request, "response": response})()
reports = []
client = module.HakkaScriptHelper(1, "x" * 64, report=reports.append)
async def execute(payload):
    if payload["phase"] == "request":
        assert payload["request"]["body"] is None
        return {"request": {"url": "https://example.test/changed", "method": "PUT", "headers": {"x-script": "yes"}, "body": None}}
    return {"response": {"status": 201, "headers": {"x-response": "yes"}, "body": "changed"}}
client._execute = execute
async def run():
    return [await client.request(flow), await client.response(flow)]
result = asyncio.run(run())
print(json.dumps({"result": result, "requestBody": list(flow.request.raw_content), "url": flow.request.url, "method": flow.request.method,
                  "requestHeaders": flow.request.headers, "status": flow.response.status_code, "responseHeaders": flow.response.headers,
                  "responseBody": flow.response.content.decode(), "reports": reports}))
`
  const result = spawnSync('python3', ['-c', harness, helper], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    result: [true, true],
    requestBody: [255, 0],
    url: 'https://example.test/changed',
    method: 'PUT',
    requestHeaders: { 'x-script': 'yes' },
    status: 201,
    responseHeaders: { 'x-response': 'yes' },
    responseBody: 'changed',
    reports: [],
  })
})

test('keeps complete original messages when a late request or response setter fails', () => {
  const harness = String.raw`
import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("hakka_script_helper", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class Headers(dict):
    def items(self, multi=False): return super().items()
class Message:
    def __init__(self, fail):
        object.__setattr__(self, "fail", fail); self.pretty_url = "https://example.test/original"; self.url = self.pretty_url
        self.method = "POST"; self.headers = Headers({"x-original": "yes"}); self.raw_content = b"original"
        self.status_code = 200; object.__setattr__(self, "armed", True)
    def __setattr__(self, name, value):
        if getattr(self, "armed", False) and name == self.fail: raise ValueError("late setter contained a secret")
        object.__setattr__(self, name, value)
    @property
    def content(self): return self.raw_content
    @content.setter
    def content(self, value): self.raw_content = value
request = Message("url")
response = Message("raw_content")
flow = type("Flow", (), {"request": request, "response": response})()
reports = []
client = module.HakkaScriptHelper(1, "x" * 64, report=reports.append)
async def execute(payload):
    if payload["phase"] == "request":
        return {"request": {"url": "https://example.test/changed", "method": "PUT", "headers": {"x-changed": "yes"}, "body": "changed"}}
    return {"response": {"status": 201, "headers": {"x-changed": "yes"}, "body": "changed"}}
client._execute = execute
async def run(): return [await client.request(flow), await client.response(flow)]
result = asyncio.run(run())
print(json.dumps({"result": result, "same": [flow.request is request, flow.response is response],
                  "headers": [request.headers, response.headers], "bodies": [request.raw_content.decode(), response.raw_content.decode()],
                  "url": request.url, "status": response.status_code, "reports": reports}))
`
  const result = spawnSync('python3', ['-c', harness, helper], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    result: [false, false],
    same: [true, true],
    headers: [{ 'x-original': 'yes' }, { 'x-original': 'yes' }],
    bodies: ['original', 'original'],
    url: 'https://example.test/original',
    status: 200,
    reports: [
      'The proxy script returned invalid request edits and the flow was left unchanged.',
      'The proxy script returned invalid response edits and the flow was left unchanged.',
    ],
  })
  expect(result.stdout).not.toContain('secret')
})

test('caps script bodies at one MiB and fails open with generic diagnostics', () => {
  const harness = String.raw`
import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("hakka_script_helper", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
reports = []
client = module.HakkaScriptHelper(1, "x" * 64, report=reports.append)
message = type("Message", (), {"raw_content": b"x" * (1024 * 1024 + 1), "pretty_url": "https://secret.test/token", "method": "GET",
                                "headers": type("Headers", (dict,), {"items": lambda self, multi=False: super(type(self), self).items()})({})})()
async def fail(_payload):
    client.report("The proxy script threw an exception and left the flow unchanged."); return None
client._execute = fail
async def run(): return await client.request(type("Flow", (), {"request": message})())
applied = asyncio.run(run())
print(json.dumps({"body": client._body(message), "applied": applied, "reports": reports}))
`
  const result = spawnSync('python3', ['-c', harness, helper], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  const output = JSON.parse(result.stdout)
  expect(output).toEqual({
    body: null,
    applied: false,
    reports: ['The proxy script threw an exception and left the flow unchanged.'],
  })
  expect(result.stdout).not.toContain('secret.test')
})

test('preserves duplicate headers for identity edits and bounds queue wait', () => {
  const harness = String.raw`
import asyncio, importlib.util, json, sys, time
spec = importlib.util.spec_from_file_location("hakka_script_helper", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class Headers:
    def __init__(self): self.values = [("set-cookie", "one=1"), ("set-cookie", "two=2"), ("x-test", "old")]
    def items(self, multi=False): return list(self.values) if multi else [("set-cookie", "two=2"), ("x-test", "old")]
    def __setitem__(self, name, value):
        self.values = [(key, item) for key, item in self.values if key.lower() != name.lower()] + [(name, value)]
    def __delitem__(self, name): self.values = [(key, value) for key, value in self.values if key.lower() != name.lower()]
headers = Headers()
client = module.HakkaScriptHelper(1, "x" * 64, timeout_seconds=0.05, report=lambda _message: None)
message = type("Message", (), {"headers": headers})()
client._apply_headers(message, {"set-cookie": "two=2", "x-test": "changed"})
async def run():
    await client.lock.acquire()
    started = time.monotonic()
    result = await client._execute({"type": "hook", "id": "queued", "phase": "request", "request": {}})
    elapsed = time.monotonic() - started
    client.lock.release()
    return result, elapsed
result, elapsed = asyncio.run(run())
print(json.dumps({"headers": headers.values, "result": result, "elapsed": elapsed}))
`
  const result = spawnSync('python3', ['-c', harness, helper], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  const output = JSON.parse(result.stdout)
  expect(output.headers).toEqual([
    ['set-cookie', 'one=1'],
    ['set-cookie', 'two=2'],
    ['x-test', 'changed'],
  ])
  expect(output.result).toBeNull()
  expect(output.elapsed).toBeLessThan(0.15)
})
