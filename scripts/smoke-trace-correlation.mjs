#!/usr/bin/env node
/**
 * Full-loop proof of cross-target trace correlation (ADR 0001, option C): a
 * fixture "client" frame and a hakka-node-captured "server" frame carrying
 * the same trace id, relayed through a real bridge hub, and grouped into a
 * single trace by hakka-core's `groupRequests(..., 'trace')` — the same
 * function the web store and hakka mcp rely on.
 *
 *   1. Start a real bridge server (packages/hakka-bridge/src, ephemeral port).
 *   2. Instrument a plain Node http "backend" with hakka-node's real capture
 *      (`embedBridge: false`). Its handler reads the incoming
 *      `x-hakka-trace` header and makes one outbound `fetch` call;
 *      hakka-node's trace propagation links that call to the incoming trace
 *      id.
 *   3. Inject a fixture "client" frame directly over a raw `ws` connection
 *      (`runtime: 'client'`, same correlationId) — standing in for a real
 *      RN/web client peer.
 *   4. A third `ws` "viewer" peer (the bridge relays to every other
 *      connected peer, never back to the sender) collects both frames.
 *   5. Assert both carry the same correlationId, and that
 *      `groupRequests(received, 'trace')` yields one group of size 2.
 *
 * Every step is timeout-guarded. Exit 0 + PASS on success; exit 1 + the
 * failing step on stderr otherwise.
 *
 * Imports packages/hakka-bridge/src and packages/hakka-node/src directly (real
 * modules, not build artifacts) and re-execs under bun when not already
 * running under it — same extensionless-import constraint as
 * scripts/smoke-control-roundtrip.mjs.
 *
 * Usage:
 *   bun scripts/smoke-trace-correlation.mjs
 *   node scripts/smoke-trace-correlation.mjs   (auto re-execs under bun)
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.versions.bun) {
  const result = spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  if (result.error) {
    process.stderr.write(
      `FAIL [bun-reexec]: could not spawn "bun" to run this script (needed because packages/hakka-bridge/src and ` +
        `packages/hakka-node/src use extensionless imports that plain node's ESM resolver rejects): ${result.error.message}\n`,
    )
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const bridgeSrcDir = path.join(repoRoot, 'packages', 'hakka-bridge', 'src')
const hakkaNodeSrcDir = path.join(repoRoot, 'packages', 'hakka-node', 'src')
const coreSrcDir = path.join(repoRoot, 'packages', 'hakka-core', 'src')

const STEP_TIMEOUT_MS = 10_000
const POLL_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 50
const TRACE_ID = 'T-SMOKE-TRACE'

function fail(step, detail) {
  process.stderr.write(`FAIL [${step}]: ${detail}\n`)
  process.exit(1)
}

async function withTimeout(step, promise, ms = STEP_TIMEOUT_MS) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      }),
    ])
  } catch (err) {
    fail(step, err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}

async function pollUntil(step, check, ms = POLL_TIMEOUT_MS) {
  const deadline = Date.now() + ms
  for (;;) {
    const result = check()
    if (result) return result
    if (Date.now() >= deadline) fail(step, `condition never became true within ${ms}ms`)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function describeErr(err) {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

async function main() {
  let startBridgeServer
  let startCapture, stopCapture
  let groupRequests
  let WebSocket

  try {
    ;({ startBridgeServer } = await import(path.join(bridgeSrcDir, 'server.ts')))
  } catch (err) {
    fail('import-bridge', `failed to import packages/hakka-bridge/src as TypeScript (use bun): ${describeErr(err)}`)
  }

  try {
    ;({ startCapture, stopCapture } = await import(path.join(hakkaNodeSrcDir, 'serverCapture.ts')))
  } catch (err) {
    fail('import-hakka-node', `failed to import packages/hakka-node/src as TypeScript (use bun): ${describeErr(err)}`)
  }

  try {
    ;({ groupRequests } = await import(path.join(coreSrcDir, 'index.ts')))
  } catch (err) {
    fail('import-core', `failed to import packages/hakka-core/src as TypeScript (use bun): ${describeErr(err)}`)
  }

  // Bare specifier so bun's resolver dedupes to the same `ws` instance the
  // bridge server (and hakka-node's bridge client) use — see the note in
  // smoke-control-roundtrip.mjs for why an explicit file path would break this.
  ;({ default: WebSocket } = await import('ws'))

  const bridge = await withTimeout('start-bridge', startBridgeServer({ port: 0 }))
  const bridgeUrl = `ws://127.0.0.1:${bridge.port}`

  let clientPeer
  let viewerPeer
  let upstream
  let app

  try {
    upstream = http.createServer((_req, res) => res.end('UP'))
    const upstreamPort = await listen(upstream)

    app = http.createServer(async (_req, res) => {
      await fetch(`http://127.0.0.1:${upstreamPort}/upstream-call`)
        .then((r) => r.text())
        .catch(() => {})
      res.statusCode = 200
      res.end('OK')
    })
    const appPort = await listen(app)

    const capture = startCapture({ bridgeUrl, embedBridge: false, bridge: true })

    viewerPeer = new WebSocket(bridgeUrl)
    await withTimeout(
      'viewer-connect',
      new Promise((resolve, reject) => {
        viewerPeer.once('open', resolve)
        viewerPeer.once('error', reject)
      }),
    )
    const received = []
    viewerPeer.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8')
      try {
        const msg = JSON.parse(raw)
        if (msg?.type === 'request' && msg.payload) received.push(msg.payload)
      } catch {
        /* ignore non-JSON frames */
      }
    })

    clientPeer = new WebSocket(bridgeUrl)
    await withTimeout(
      'client-peer-connect',
      new Promise((resolve, reject) => {
        clientPeer.once('open', resolve)
        clientPeer.once('error', reject)
      }),
    )
    const clientFixture = {
      id: 'fixture-client-1',
      url: 'https://example.com/checkout',
      method: 'POST',
      status: 200,
      startTime: Date.now(),
      endTime: Date.now() + 5,
      duration: 5,
      source: 'fetch',
      runtime: 'client',
      correlationId: TRACE_ID,
    }
    clientPeer.send(JSON.stringify({ type: 'request', payload: clientFixture }))

    await withTimeout(
      'server-request',
      new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port: appPort, path: '/', headers: { 'x-hakka-trace': TRACE_ID } },
          (res) => {
            res.on('data', () => {})
            res.on('end', resolve)
          },
        )
        req.on('error', reject)
        req.end()
      }),
    )

    await pollUntil(
      'viewer receives both frames',
      () =>
        received.some((r) => r.id === 'fixture-client-1') && received.some((r) => r.url?.includes('/upstream-call')),
    )

    const clientRec = received.find((r) => r.id === 'fixture-client-1')
    const serverRec = received.find((r) => r.url?.includes('/upstream-call'))
    assert.ok(clientRec, 'fixture client frame never arrived at the viewer')
    assert.ok(serverRec, 'hakka-node-captured server frame never arrived at the viewer')
    assert.equal(clientRec.correlationId, TRACE_ID, 'fixture client frame should carry the trace id')
    assert.equal(serverRec.correlationId, TRACE_ID, 'hakka-node-captured server frame should carry the trace id')
    assert.equal(serverRec.runtime, 'server', 'hakka-node-captured server frame should be tagged runtime: server')

    const groups = groupRequests([clientRec, serverRec], 'trace')
    assert.equal(groups.length, 1, `expected exactly one trace group, got ${groups.length}`)
    assert.equal(
      groups[0].items.length,
      2,
      `expected the trace group to contain 2 requests, got ${groups[0].items.length}`,
    )
    assert.equal(groups[0].key, TRACE_ID, 'trace group key should be the shared correlationId')

    capture.stop()

    process.stdout.write(
      'PASS smoke-trace-correlation: fixture client frame + hakka-node-captured server frame relayed over a ' +
        `REAL bridge socket, both carrying correlationId ${JSON.stringify(TRACE_ID)}, and hakka-core's ` +
        "groupRequests(..., 'trace') over the pair returned exactly one group of size 2\n",
    )
  } finally {
    stopCapture()
    try {
      clientPeer?.terminate()
    } catch {
      /* already gone */
    }
    try {
      viewerPeer?.terminate()
    } catch {
      /* already gone */
    }
    try {
      upstream?.close()
    } catch {
      /* already gone */
    }
    try {
      app?.close()
    } catch {
      /* already gone */
    }
    await withTimeout('bridge-close', bridge.close(), 5_000)
  }

  process.exit(0)
}

main().catch((err) => {
  fail('unexpected', describeErr(err))
})
