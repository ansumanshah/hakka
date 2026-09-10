import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const addon = fileURLToPath(new URL('../hakka_mitm_addon.py', import.meta.url))

test('caps aggregate matching delays without waiting for the cap', () => {
  const harness = `
import asyncio
import importlib.util
import json
import sys
import types

mitmproxy = types.ModuleType("mitmproxy")
http = types.ModuleType("mitmproxy.http")
http.HTTPFlow = object
mitmproxy.http = http
mitmproxy.ctx = types.SimpleNamespace(options=types.SimpleNamespace(stream_large_bodies="1b"))
sys.modules["mitmproxy"] = mitmproxy
sys.modules["mitmproxy.http"] = http

spec = importlib.util.spec_from_file_location("hakka_mitm_addon", sys.argv[1])
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.RULES = {"headerRules": [], "blockRules": [], "delayRules": [
    (addon.re.compile("/slow$"), {"match": "/slow$", "phase": "request", "delayMs": 20000}),
    (addon.re.compile("/slow$"), {"match": "/slow$", "phase": "request", "delayMs": 20000}),
]}
sleeps = []
async def capture_sleep(seconds):
    sleeps.append(seconds)
addon.asyncio.sleep = capture_sleep
flow = types.SimpleNamespace(request=types.SimpleNamespace(pretty_url="http://example.test/slow"))
asyncio.run(addon.apply_delay(flow, "request"))
print(json.dumps(sleeps))
`
  const result = spawnSync('python3', ['-c', harness, addon], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual([30])
})

test('applies a matching request block at request headers before streaming can begin', () => {
  const harness = `
import asyncio
import importlib.util
import json
import sys
import types

mitmproxy = types.ModuleType("mitmproxy")
http = types.ModuleType("mitmproxy.http")
http.HTTPFlow = object
http.Response = types.SimpleNamespace(make=lambda status, body, headers: {"status": status, "body": body, "headers": headers})
mitmproxy.http = http
mitmproxy.ctx = types.SimpleNamespace(options=types.SimpleNamespace(stream_large_bodies=None))
sys.modules["mitmproxy"] = mitmproxy
sys.modules["mitmproxy.http"] = http

spec = importlib.util.spec_from_file_location("hakka_mitm_addon", sys.argv[1])
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.RULES = {"headerRules": [], "delayRules": [], "blockRules": [
    (addon.re.compile("/blocked$"), {"match": "/blocked$", "status": 451, "body": "blocked"}),
]}
addon.HAS_REQUEST_RULES = True
addon.configure({"stream_large_bodies"})
request = types.SimpleNamespace(pretty_url="http://example.test/blocked", stream=True, headers={})
flow = types.SimpleNamespace(request=request, response=None)
asyncio.run(addon.HakkaCapture().requestheaders(flow))
print(json.dumps({"configured": mitmproxy.ctx.options.stream_large_bodies, "stream": request.stream, "response": flow.response}))
`
  const result = spawnSync('python3', ['-c', harness, addon], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({
    configured: null,
    stream: false,
    response: { status: 451, body: 'blocked' },
  })
})

test('disables request streaming for latency and offline profiles before their async decision', () => {
  const harness = `
import asyncio, importlib.util, json, os, sys, types
os.environ["HAKKA_PROXY_LATENCY_MS"] = "20"
os.environ["HAKKA_PROXY_OFFLINE"] = "1"
mitmproxy = types.ModuleType("mitmproxy")
http = types.ModuleType("mitmproxy.http")
http.HTTPFlow = object
http.Response = types.SimpleNamespace(make=lambda status, body, headers: {"status": status})
mitmproxy.http = http
mitmproxy.ctx = types.SimpleNamespace(options=types.SimpleNamespace(stream_large_bodies="1b"))
sys.modules["mitmproxy"] = mitmproxy; sys.modules["mitmproxy.http"] = http
spec = importlib.util.spec_from_file_location("hakka_mitm_addon", sys.argv[1])
addon = importlib.util.module_from_spec(spec); spec.loader.exec_module(addon)
addon.configure({"stream_large_bodies"})
request = types.SimpleNamespace(pretty_url="http://example.test/upload", stream=True, headers={})
flow = types.SimpleNamespace(request=request, response=None)
asyncio.run(addon.HakkaCapture().requestheaders(flow))
print(json.dumps({"configured": mitmproxy.ctx.options.stream_large_bodies, "stream": request.stream, "status": flow.response["status"]}))
`
  const result = spawnSync('python3', ['-c', harness, addon], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ configured: null, stream: false, status: 503 })
})

test('restores the prior streaming threshold after dynamic request breakpoints are removed', () => {
  const harness = `
import importlib.util
import json
import sys
import types

mitmproxy = types.ModuleType("mitmproxy")
http = types.ModuleType("mitmproxy.http")
http.HTTPFlow = object
mitmproxy.http = http
mitmproxy.ctx = types.SimpleNamespace(options=types.SimpleNamespace(stream_large_bodies="1b"))
sys.modules["mitmproxy"] = mitmproxy
sys.modules["mitmproxy.http"] = http

spec = importlib.util.spec_from_file_location("hakka_mitm_addon", sys.argv[1])
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.HAS_REQUEST_RULES = False
capture = addon.HakkaCapture()
capture.set_breakpoints([{"id": "dynamic", "pattern": "/x", "on": "request", "enabled": True}])
while_active = mitmproxy.ctx.options.stream_large_bodies
capture.set_breakpoints([])
print(json.dumps({"active": while_active, "restored": mitmproxy.ctx.options.stream_large_bodies}))
`
  const result = spawnSync('python3', ['-c', harness, addon], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ active: null, restored: '1b' })
})

test('closes the breakpoint transport when completion drain stalls at the pause deadline', () => {
  const harness = `
import asyncio
import importlib.util
import json
import sys
import time
import types

mitmproxy = types.ModuleType("mitmproxy")
http = types.ModuleType("mitmproxy.http")
http.HTTPFlow = object
mitmproxy.http = http
mitmproxy.ctx = types.SimpleNamespace(options=types.SimpleNamespace(stream_large_bodies=None))
sys.modules["mitmproxy"] = mitmproxy
sys.modules["mitmproxy.http"] = http

spec = importlib.util.spec_from_file_location("hakka_mitm_addon", sys.argv[1])
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.BREAKPOINT_TIMEOUT = 0.05
addon.BREAKPOINT_COMPLETION_TIMEOUT = 0.03
capture = addon.HakkaCapture()

class StalledCompletionWriter:
    def __init__(self):
        self.closed = False
        self.drains = 0
        self.writes = []

    def write(self, value):
        self.writes.append(value.decode("utf-8"))
        if '"type":"pause"' in self.writes[-1]:
            asyncio.get_running_loop().call_soon(self.release_pause)

    def release_pause(self):
        future = next(iter(capture.pending_breakpoints.values()))[0]
        future.set_result({"action": "abort"})

    async def drain(self):
        self.drains += 1
        if self.drains == 1:
            return
        await asyncio.Event().wait()

    def close(self):
        self.closed = True

writer = StalledCompletionWriter()
capture.breakpoint_writer = writer
capture.set_breakpoints([{"id": "held", "pattern": "/held", "on": "request", "enabled": True}])
request = types.SimpleNamespace(
    pretty_url="http://example.test/held",
    method="POST",
    headers={"content-type": "text/plain"},
)
flow = types.SimpleNamespace(id="flow", request=request)

async def run():
    started = time.monotonic()
    result = await asyncio.wait_for(capture.pause_for_breakpoint(flow, "request"), timeout=0.25)
    pause_elapsed = time.monotonic() - started
    for _ in range(20):
        if writer.closed:
            break
        await asyncio.sleep(0.01)
    return {
        "result": result,
        "pauseElapsed": pause_elapsed,
        "closed": writer.closed,
        "drains": writer.drains,
        "writes": len(writer.writes),
        "pending": len(capture.pending_breakpoints),
    }

print(json.dumps(asyncio.run(run())))
`
  const result = spawnSync('python3', ['-c', harness, addon], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({
    result: false,
    closed: true,
    drains: 2,
    writes: 2,
    pending: 0,
  })
  expect(JSON.parse(result.stdout).pauseElapsed).toBeLessThan(0.05)
})

test('keeps a healthy breakpoint transport usable after a pause watchdog expires', () => {
  const harness = `
import asyncio
import importlib.util
import json
import sys
import types

mitmproxy = types.ModuleType("mitmproxy")
http = types.ModuleType("mitmproxy.http")
http.HTTPFlow = object
mitmproxy.http = http
mitmproxy.ctx = types.SimpleNamespace(options=types.SimpleNamespace(stream_large_bodies=None))
sys.modules["mitmproxy"] = mitmproxy
sys.modules["mitmproxy.http"] = http

spec = importlib.util.spec_from_file_location("hakka_mitm_addon", sys.argv[1])
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.BREAKPOINT_TIMEOUT = 0.01
addon.BREAKPOINT_COMPLETION_TIMEOUT = 0.03
capture = addon.HakkaCapture()

class HealthyWriter:
    def __init__(self):
        self.closed = False
        self.messages = []

    def write(self, value):
        self.messages.append(json.loads(value))

    async def drain(self):
        return

    def close(self):
        self.closed = True

writer = HealthyWriter()
capture.breakpoint_writer = writer
capture.set_breakpoints([{"id": "held", "pattern": "/held", "on": "request", "enabled": True}])

def flow(identifier):
    request = types.SimpleNamespace(pretty_url="http://example.test/held", method="POST", headers={})
    return types.SimpleNamespace(id=identifier, request=request)

async def run():
    first = await capture.pause_for_breakpoint(flow("first"), "request")
    await asyncio.sleep(0)
    second = await capture.pause_for_breakpoint(flow("second"), "request")
    await asyncio.sleep(0)
    return {
        "results": [first, second],
        "types": [message["type"] for message in writer.messages],
        "closed": writer.closed,
        "rules": len(capture.breakpoints),
    }

print(json.dumps(asyncio.run(run())))
`
  const result = spawnSync('python3', ['-c', harness, addon], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    results: [false, false],
    types: ['pause', 'complete', 'pause', 'complete'],
    closed: false,
    rules: 1,
  })
})
