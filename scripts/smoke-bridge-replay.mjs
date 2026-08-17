#!/usr/bin/env node
/**
 * Fixture-replay smoke test for the bridge -> MCP pipeline.
 *
 * Replays fixtures/hakka-records/v1/network-request.json through the real
 * bridge frame parser (packages/hakka/src/mcp/bridgeListener.ts
 * `parseBridgeFrame`) into a real RequestStore, then calls every MCP tool
 * (list_requests, get_request, search_requests, stats, clear) through the
 * real MCP protocol (InMemoryTransport) and asserts response shapes + exact
 * values.
 *
 * Imports hakka mcp's `src/*.ts` directly rather than building `dist/` first
 * — `dist/server.mjs` is a bundled CLI entrypoint that doesn't export
 * `parseBridgeFrame`/`RequestStore`/`registerTools` individually. Works
 * under `bun` (native TS loader) or `node` >=22.6 (--experimental-strip-types)
 * / >=23.6+ unflagged. If your node is too old to strip types, use bun.
 *
 * The other four fixtures (trace.json, trace-minimal.json,
 * health-report*.json) are OTel-style records (`kind: "trace"` /
 * `kind: "health.report"`) with no hakka mcp ingest path yet — skipped
 * explicitly below, not silently ignored.
 *
 * Usage:
 *   bun scripts/smoke-bridge-replay.mjs
 *   node scripts/smoke-bridge-replay.mjs
 *
 * Exit code 0 + one-line PASS summary on success; exit code 1 + the failing
 * assertion printed to stderr on failure.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Re-exec under bun — packages/hakka/src/mcp/tools/index.ts uses `.js`-suffixed
// TS-style specifiers that plain node's type-stripping resolver rejects.
// Same pattern as smoke-control-roundtrip.mjs; process.versions.bun only
// exists inside bun.
if (!process.versions.bun) {
  const result = spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  if (result.error) {
    process.stderr.write(`FAIL [bun-reexec]: could not spawn "bun" to run this script: ${result.error.message}\n`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fixturesDir = path.join(repoRoot, 'fixtures', 'hakka-records', 'v1')
const mcpPkgDir = path.join(repoRoot, 'packages', 'hakka')
const mcpSrcDir = path.join(mcpPkgDir, 'src', 'mcp')
// bun workspaces keep this SDK un-hoisted in packages/hakka/node_modules
// (see scripts/smoke-mcp-handshake.mjs) — resolve via explicit path rather
// than relying on hoisting.
const sdkDir = path.join(mcpPkgDir, 'node_modules', '@modelcontextprotocol', 'sdk')
const sdkPkgUrl = pathToFileURL(sdkDir).href

function fail(step, detail) {
  process.stderr.write(`FAIL [${step}]: ${detail}\n`)
  process.exit(1)
}

function loadFixture(name) {
  const filePath = path.join(fixturesDir, name)
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (err) {
    fail('load-fixture', `could not read/parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main() {
  const networkRequestRecord = loadFixture('network-request.json')
  const traceFull = loadFixture('trace.json')
  const traceMinimal = loadFixture('trace-minimal.json')
  const healthFull = loadFixture('health-report.json')
  const healthMinimal = loadFixture('health-report-minimal.json')

  assert.equal(networkRequestRecord.kind, 'network.request', 'network-request.json kind mismatch')
  assert.equal(traceFull.kind, 'trace', 'trace.json kind mismatch')
  assert.equal(traceMinimal.kind, 'trace', 'trace-minimal.json kind mismatch')
  assert.equal(healthFull.kind, 'health.report', 'health-report.json kind mismatch')
  assert.equal(healthMinimal.kind, 'health.report', 'health-report-minimal.json kind mismatch')

  for (const [name, kind] of [
    ['trace.json', traceFull.kind],
    ['trace-minimal.json', traceMinimal.kind],
    ['health-report.json', healthFull.kind],
    ['health-report-minimal.json', healthMinimal.kind],
  ]) {
    process.stdout.write(
      `SKIP ${name} (kind="${kind}"): no bridge/MCP ingest path exists for this record kind yet ` +
        `— bridgeListener.parseBridgeFrame only accepts { type: "request", payload: NetworkRequest } frames, ` +
        `and hakka mcp registers no trace/health-report tool or resource.\n`,
    )
  }

  let parseBridgeFrame, RequestStore, registerTools, registerResources
  try {
    ;({ parseBridgeFrame } = await import(path.join(mcpSrcDir, 'bridgeListener.ts')))
    ;({ RequestStore } = await import(path.join(mcpSrcDir, 'RequestStore.ts')))
    ;({ registerTools } = await import(path.join(mcpSrcDir, 'tools/index.ts')))
    ;({ registerResources } = await import(path.join(mcpSrcDir, 'resources.ts')))
  } catch (err) {
    fail(
      'import',
      `failed to import hakka mcp src as TypeScript — retry with "bun scripts/smoke-bridge-replay.mjs" ` +
        `(bun always has a native TS loader; plain node needs >=22.6 with --experimental-strip-types or >=23.6+ unflagged): ${
          err instanceof Error ? (err.stack ?? err.message) : String(err)
        }`,
    )
  }

  const [{ Client }, { InMemoryTransport }, { McpServer }] = await Promise.all([
    import(`${sdkPkgUrl}/dist/esm/client/index.js`),
    import(`${sdkPkgUrl}/dist/esm/inMemory.js`),
    import(`${sdkPkgUrl}/dist/esm/server/mcp.js`),
  ])

  const networkRequestPayload = networkRequestRecord.request
  assert.ok(
    networkRequestPayload && typeof networkRequestPayload === 'object',
    'network-request.json missing `request`',
  )

  const wireFrame = JSON.stringify({ type: 'request', payload: networkRequestPayload })
  const parsed = parseBridgeFrame(wireFrame)
  if (parsed === null) {
    fail('parseBridgeFrame', `real parser rejected the canonical frame built from network-request.json: ${wireFrame}`)
  }
  assert.equal(parsed.id, networkRequestPayload.id, 'parsed frame id mismatch')
  assert.equal(parsed.url, networkRequestPayload.url, 'parsed frame url mismatch')
  assert.equal(parsed.method, networkRequestPayload.method, 'parsed frame method mismatch')
  assert.equal(parsed.status, networkRequestPayload.status, 'parsed frame status mismatch')

  // Also prove the parser's negative-path contract: malformed input returns
  // null, never throws.
  const malformedFrame = JSON.stringify({ type: 'request', payload: { url: networkRequestPayload.url } }) // missing id
  assert.equal(parseBridgeFrame(malformedFrame), null, 'parser should reject a payload missing `id`')
  assert.equal(parseBridgeFrame('{not json'), null, 'parser should reject invalid JSON')

  const store = new RequestStore(500)
  store.add(parsed)
  assert.equal(store.size, 1, 'store size after ingesting one fixture request')
  assert.ok(store.get(networkRequestPayload.id), 'store.get should find the ingested request by id')

  // A second, synthetic request derived from the same fixture (status bumped
  // into error range) so search/filter/stats assertions have more than one
  // row, while staying deterministic.
  const secondPayload = {
    ...networkRequestPayload,
    id: `${networkRequestPayload.id}-err`,
    method: 'GET',
    status: 500,
    error: 'Internal error',
    startTime: networkRequestPayload.startTime + 1,
    duration: 50, // deliberately less than the fixture's 128ms so `slowest` stays deterministic
  }
  const secondFrame = JSON.stringify({ type: 'request', payload: secondPayload })
  const secondParsed = parseBridgeFrame(secondFrame)
  assert.ok(secondParsed, 'second synthetic frame should parse')
  store.add(secondParsed)
  assert.equal(store.size, 2, 'store size after ingesting two fixture-derived requests')

  // registerTools also registers write tools (create_mock, set_throttle, …)
  // that need a ControlSender to dispatch over — a stub that never sends is
  // enough since this script only exercises the read tools. The write-tool
  // roundtrip is covered by scripts/smoke-control-roundtrip.mjs instead.
  const noopSender = { sendControl: () => false }
  const mcpServer = new McpServer({ name: 'smoke-bridge-replay', version: '0.0.0' })
  registerTools(mcpServer, store, noopSender)
  registerResources(mcpServer, store)

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await mcpServer.connect(serverTransport)

  const client = new Client({ name: 'smoke-bridge-replay-client', version: '0.0.0' })
  await client.connect(clientTransport)

  try {
    const toolsList = await client.listTools()
    const toolNames = toolsList.tools.map((t) => t.name)
    const expectedTools = ['list_requests', 'get_request', 'search_requests', 'stats', 'clear']
    for (const name of expectedTools) {
      assert.ok(toolNames.includes(name), `tools/list missing "${name}" (got: ${toolNames.join(', ')})`)
    }

    const listResult = await client.callTool({ name: 'list_requests', arguments: { limit: 10 } })
    assert.ok(!listResult.isError, `list_requests returned isError: ${JSON.stringify(listResult.content)}`)
    const listBody = JSON.parse(listResult.content[0].text)
    assert.equal(listBody.total, 2, 'list_requests total should be 2')
    assert.equal(listBody.count, 2, 'list_requests count should be 2')
    // newest-first: the error request (added second) must come first.
    assert.equal(listBody.requests[0].id, secondPayload.id, 'list_requests should return newest-first')
    assert.equal(
      listBody.requests[1].id,
      networkRequestPayload.id,
      'list_requests second row should be the original fixture request',
    )

    const getFoundResult = await client.callTool({ name: 'get_request', arguments: { id: networkRequestPayload.id } })
    assert.ok(!getFoundResult.isError, `get_request(found) returned isError: ${JSON.stringify(getFoundResult.content)}`)
    const getFoundBody = JSON.parse(getFoundResult.content[0].text)
    assert.equal(getFoundBody.id, networkRequestPayload.id, 'get_request id mismatch')
    assert.equal(getFoundBody.url, networkRequestPayload.url, 'get_request url mismatch')
    assert.equal(getFoundBody.method, 'POST', 'get_request method mismatch')
    assert.equal(getFoundBody.status, 201, 'get_request status mismatch')

    const getMissingResult = await client.callTool({ name: 'get_request', arguments: { id: 'does-not-exist' } })
    assert.equal(getMissingResult.isError, true, 'get_request(missing) should set isError')
    const getMissingBody = JSON.parse(getMissingResult.content[0].text)
    assert.equal(getMissingBody.error, 'not_found', 'get_request(missing) error field mismatch')

    const searchErrResult = await client.callTool({ name: 'search_requests', arguments: { errorOnly: true } })
    assert.ok(
      !searchErrResult.isError,
      `search_requests(errorOnly) returned isError: ${JSON.stringify(searchErrResult.content)}`,
    )
    const searchErrBody = JSON.parse(searchErrResult.content[0].text)
    assert.equal(searchErrBody.count, 1, 'search_requests(errorOnly) should return exactly 1 result')
    assert.equal(searchErrBody.requests[0].id, secondPayload.id, 'search_requests(errorOnly) returned wrong request')

    const searchMethodResult = await client.callTool({ name: 'search_requests', arguments: { method: 'post' } })
    assert.ok(!searchMethodResult.isError, 'search_requests(method) returned isError')
    const searchMethodBody = JSON.parse(searchMethodResult.content[0].text)
    assert.equal(searchMethodBody.count, 1, 'search_requests(method=post) should be case-insensitive and return 1')
    assert.equal(
      searchMethodBody.requests[0].id,
      networkRequestPayload.id,
      'search_requests(method=post) returned wrong request',
    )

    const searchUrlResult = await client.callTool({
      name: 'search_requests',
      arguments: { urlContains: 'api.example.com/users' },
    })
    const searchUrlBody = JSON.parse(searchUrlResult.content[0].text)
    assert.equal(searchUrlBody.count, 2, 'search_requests(urlContains) should match both requests (same fixture URL)')

    const statsResult = await client.callTool({ name: 'stats', arguments: {} })
    assert.ok(!statsResult.isError, `stats returned isError: ${JSON.stringify(statsResult.content)}`)
    const statsBody = JSON.parse(statsResult.content[0].text)
    assert.equal(statsBody.total, 2, 'stats.total mismatch')
    assert.equal(statsBody.error, 1, 'stats.error mismatch')
    assert.equal(statsBody.success, 1, 'stats.success mismatch')
    assert.equal(statsBody.errorRate, 0.5, 'stats.errorRate mismatch')
    assert.ok(
      statsBody.byHost['api.example.com'] === 2,
      'stats.byHost should count both requests under api.example.com',
    )
    assert.equal(statsBody.avgDurationMs, 89, 'stats.avgDurationMs mismatch ((128 + 50) / 2)')
    assert.equal(
      statsBody.slowest?.id,
      networkRequestPayload.id,
      'stats.slowest should be the 128ms fixture request, not the 50ms synthetic one',
    )

    const clearResult = await client.callTool({ name: 'clear', arguments: {} })
    assert.ok(!clearResult.isError, `clear returned isError: ${JSON.stringify(clearResult.content)}`)
    const clearBody = JSON.parse(clearResult.content[0].text)
    assert.equal(clearBody.ok, true, 'clear should report ok=true')
    assert.equal(store.size, 0, 'store should be empty after clear tool call')

    const listAfterClear = await client.callTool({ name: 'list_requests', arguments: {} })
    const listAfterClearBody = JSON.parse(listAfterClear.content[0].text)
    assert.equal(listAfterClearBody.total, 0, 'list_requests after clear should report total=0')
  } finally {
    await client.close()
    await mcpServer.close()
  }

  process.stdout.write(
    'PASS smoke-bridge-replay: network-request.json replayed through the real bridge parser into a real RequestStore; ' +
      'list_requests/get_request/search_requests/stats/clear all verified over real MCP protocol; ' +
      '4 non-network fixtures explicitly skipped (no ingest path)\n',
  )
  process.exit(0)
}

main().catch((err) => {
  fail('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err))
})
