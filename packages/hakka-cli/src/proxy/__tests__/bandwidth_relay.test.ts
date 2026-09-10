import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const relay = fileURLToPath(new URL('../bandwidth_relay.py', import.meta.url))

test('paces real local HTTP downloads without blocking concurrent tunnels or losing half-closed requests', () => {
  const harness = `
import asyncio, importlib.util, json, sys, time
spec = importlib.util.spec_from_file_location('relay', sys.argv[1])
module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)

async def upstream(reader, writer):
    await reader.readuntil(b'\\r\\n\\r\\n')
    body = b'x' * 2048
    writer.write(b'HTTP/1.1 200 OK\\r\\nContent-Length: 2048\\r\\nConnection: close\\r\\n\\r\\n' + body)
    await writer.drain(); writer.close(); await writer.wait_closed()

async def fetch(port, upstream_port):
    reader, writer = await asyncio.open_connection('127.0.0.1', port)
    writer.write(b'GET / HTTP/1.1\\r\\nHost: local\\r\\nConnection: close\\r\\n\\r\\n')
    await writer.drain(); writer.write_eof(); started = time.monotonic(); payload = await reader.read(); elapsed = time.monotonic() - started
    writer.close(); await writer.wait_closed(); return elapsed, payload

async def main():
    origin = await asyncio.start_server(upstream, '127.0.0.1', 0)
    origin_port = origin.sockets[0].getsockname()[1]
    sidecar = module.BandwidthRelay('127.0.0.1', origin_port, module.BandwidthLimits(download_bytes_per_second=2048))
    proxy = await asyncio.start_server(sidecar.handle, '127.0.0.1', 0)
    proxy_port = proxy.sockets[0].getsockname()[1]
    started = time.monotonic(); first, second = await asyncio.gather(fetch(proxy_port, origin_port), fetch(proxy_port, origin_port)); total = time.monotonic() - started
    proxy.close(); origin.close(); await proxy.wait_closed(); await origin.wait_closed()
    print(json.dumps({'first': first[0], 'second': second[0], 'total': total, 'sizes': [len(first[1]), len(second[1])]}))
asyncio.run(main())
`
  const result = spawnSync('python3', ['-c', harness, relay], { encoding: 'utf8', timeout: 10_000 })
  expect(result.status, result.stderr).toBe(0)
  const measured = JSON.parse(result.stdout) as { first: number; second: number; total: number; sizes: number[] }
  // Each tunnel takes roughly one second. Concurrent independent tunnels are
  // paced fairly: they do not serialize into a two-second transfer.
  expect(measured.first).toBeGreaterThanOrEqual(0.8)
  expect(measured.second).toBeGreaterThanOrEqual(0.8)
  expect(measured.total).toBeLessThan(1.8)
  expect(measured.sizes[0]).toBeGreaterThan(2048)
  expect(measured.sizes[1]).toBeGreaterThan(2048)
})

test('pacer cancellation propagates without a blocked event loop', () => {
  const harness = `
import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location('relay', sys.argv[1])
module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)
async def main():
    task = asyncio.create_task(module.BytePacer(1).pace(100))
    await asyncio.sleep(0)
    task.cancel()
    try: await task
    except asyncio.CancelledError: print(json.dumps({'cancelled': True}))
asyncio.run(main())
`
  const result = spawnSync('python3', ['-c', harness, relay], { encoding: 'utf8', timeout: 2_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ cancelled: true })
})

test('caps active clients and reports readiness only after binding', () => {
  const harness = `
import asyncio, importlib.util, json, subprocess, sys
spec = importlib.util.spec_from_file_location('relay', sys.argv[1])
module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)
async def hold(reader, writer):
    await reader.read(); writer.close(); await writer.wait_closed()
async def main():
    target = await asyncio.start_server(hold, '127.0.0.1', 0)
    target_port = target.sockets[0].getsockname()[1]
    relay = module.BandwidthRelay('127.0.0.1', target_port, module.BandwidthLimits(), max_clients=1)
    server = await asyncio.start_server(relay.handle, '127.0.0.1', 0)
    port = server.sockets[0].getsockname()[1]
    _one_reader, one_writer = await asyncio.open_connection('127.0.0.1', port)
    await asyncio.sleep(0.01)
    two_reader, two_writer = await asyncio.open_connection('127.0.0.1', port)
    rejected = await asyncio.wait_for(two_reader.read(), 1) == b''
    one_writer.close(); two_writer.close(); await one_writer.wait_closed(); await two_writer.wait_closed()
    server.close(); target.close(); await server.wait_closed(); await target.wait_closed()
    process = subprocess.Popen([sys.executable, sys.argv[1], '--listen-port', '0', '--target-port', '1'], stdout=subprocess.PIPE, text=True)
    ready = json.loads(process.stdout.readline())
    process.terminate(); process.wait(timeout=2)
    print(json.dumps({'rejected': rejected, 'ready': ready}))
asyncio.run(main())
`
  const result = spawnSync('python3', ['-c', harness, relay], { encoding: 'utf8', timeout: 5_000 })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ rejected: true, ready: { type: 'ready', port: expect.any(Number) } })
})
