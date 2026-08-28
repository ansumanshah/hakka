#!/usr/bin/env node
/**
 * Full-loop proof of the agent-writable MCP tools: MCP tool call ->
 * hakka mcp's BridgeListener.sendControl -> a real bridge server -> a
 * connected "app" peer running hakka-core's parseControlCommand +
 * applyControlCommand against its own singleton engines.
 *
 * hakka mcp's own unit tests only assert the ControlCommand shape sent to a
 * FakeSender — this script is the one test that proves the write path over a
 * real WebSocket and real engines:
 *
 *   1. Start a real bridge server (packages/hakka-bridge/src, ephemeral port).
 *   2. Connect a fake "app" peer (plain `ws`, in this process) that runs
 *      hakka-core's real mockEngine / breakpointEngine / ThrottleEngine and
 *      applies every incoming control frame via parseControlCommand +
 *      applyControlCommand.
 *   3. Start hakka mcp's real MCP server with a real BridgeListener pointed
 *      at the bridge (MCP client side stays InMemoryTransport).
 *   4. Call create_mock over MCP, poll the app peer's mockEngine.getRules()
 *      for the minted id.
 *   5. Also assert set_throttle, a raw mock.add+modify frame sent directly
 *      via listener.sendControl (create_mock has no modify param), and
 *      delete_mock.
 *
 * Every step is timeout-guarded. Exit 0 + PASS on success; exit 1 + the
 * failing step on stderr otherwise.
 *
 * Re-execs itself under bun when not already running under it:
 * packages/hakka-bridge/src uses extensionless relative imports that node's ESM
 * resolver rejects even with type-stripping enabled.
 *
 *   bun scripts/smoke-control-roundtrip.mjs
 *   node scripts/smoke-control-roundtrip.mjs   (auto re-execs under bun)
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Re-exec under bun — see the note above; process.versions.bun only exists
// inside bun.
if (!process.versions.bun) {
  const result = spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  if (result.error) {
    process.stderr.write(
      `FAIL [bun-reexec]: could not spawn "bun" to run this script (needed because packages/hakka-bridge/src uses ` +
        `extensionless imports that plain node's ESM resolver rejects): ${result.error.message}\n`,
    )
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const bridgeSrcDir = path.join(repoRoot, 'packages', 'hakka-bridge', 'src')
const mcpPkgDir = path.join(repoRoot, 'packages', 'hakka-cli')
const mcpSrcDir = path.join(mcpPkgDir, 'src', 'mcp')
const coreSrcDir = path.join(repoRoot, 'packages', 'hakka-core', 'src')
// SDK resolved via explicit path (bun keeps it un-hoisted under
// packages/hakka-cli/node_modules). `ws` must NOT be resolved this way — an
// explicit path would load a second `ws` instance from the one
// packages/hakka-bridge/src/server.ts uses, causing a misleading "Unexpected
// server response: 101" handshake failure.
const sdkDir = path.join(mcpPkgDir, 'node_modules', '@modelcontextprotocol', 'sdk')
const sdkPkgUrl = pathToFileURL(sdkDir).href

const STEP_TIMEOUT_MS = 10_000
const POLL_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 50

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
    if (Date.now() >= deadline) {
      fail(step, `condition never became true within ${ms}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

async function main() {
  let startBridgeServer
  let createBridgeListener, RequestStore, registerTools, registerResources
  let mockEngine, breakpointEngine, ThrottleEngine, parseControlCommand, applyControlCommand

  try {
    ;({ startBridgeServer } = await import(path.join(bridgeSrcDir, 'server.ts')))
  } catch (err) {
    fail('import-bridge', `failed to import packages/hakka-bridge/src as TypeScript (use bun): ${describeErr(err)}`)
  }

  try {
    ;({ createBridgeListener } = await import(path.join(mcpSrcDir, 'bridgeListener.ts')))
    ;({ RequestStore } = await import(path.join(mcpSrcDir, 'RequestStore.ts')))
    ;({ registerTools } = await import(path.join(mcpSrcDir, 'tools/index.ts')))
    ;({ registerResources } = await import(path.join(mcpSrcDir, 'resources.ts')))
  } catch (err) {
    fail('import-mcp', `failed to import packages/hakka-cli/src/mcp as TypeScript (use bun): ${describeErr(err)}`)
  }

  try {
    ;({ mockEngine, breakpointEngine, ThrottleEngine, parseControlCommand, applyControlCommand } = await import(
      path.join(coreSrcDir, 'index.ts')
    ))
  } catch (err) {
    fail('import-core', `failed to import packages/hakka-core/src as TypeScript (use bun): ${describeErr(err)}`)
  }

  const [{ Client }, { InMemoryTransport }, { McpServer }, { default: WebSocket }] = await Promise.all([
    import(`${sdkPkgUrl}/dist/esm/client/index.js`),
    import(`${sdkPkgUrl}/dist/esm/inMemory.js`),
    import(`${sdkPkgUrl}/dist/esm/server/mcp.js`),
    // Bare specifier — see the `ws` note above for why.
    import('ws'),
  ])

  const bridge = await withTimeout('start-bridge', startBridgeServer({ port: 0 }))
  const bridgeUrl = `ws://127.0.0.1:${bridge.port}`

  // Reset the hakka-core singleton engines to a known-clean state — they are
  // process-wide singletons sharing the module graph the fake app peer runs
  // against, so leftover state from an earlier run must not leak in.
  mockEngine.clearRules()
  for (const bp of breakpointEngine.getBreakpoints?.() ?? []) {
    breakpointEngine.removeBreakpoint(bp.id)
  }
  ThrottleEngine.setProfile('none')

  let appPeer
  let bridgeClosed = false
  let mcpTransportPair
  let mcpServer
  let client
  let listener

  try {
    appPeer = new WebSocket(bridgeUrl)
    await withTimeout(
      'app-peer-connect',
      new Promise((resolve, reject) => {
        appPeer.once('open', resolve)
        appPeer.once('error', reject)
      }),
    )

    const appliedResults = []
    appPeer.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8')
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      if (!msg || msg.type !== 'control') return
      const cmd = parseControlCommand(msg.payload)
      if (!cmd) return
      appliedResults.push(applyControlCommand(cmd))
    })

    const store = new RequestStore(50)
    listener = createBridgeListener(store, bridgeUrl)
    await withTimeout(
      'mcp-listener-connect',
      new Promise((resolve, reject) => {
        const deadline = Date.now() + STEP_TIMEOUT_MS
        const check = () => {
          if (listener.connected) return resolve()
          if (Date.now() > deadline) return reject(new Error('BridgeListener never reported connected'))
          setTimeout(check, 25)
        }
        check()
      }),
    )

    mcpServer = new McpServer({ name: 'smoke-control-roundtrip', version: '0.0.0' })
    registerTools(mcpServer, store, listener)
    registerResources(mcpServer, store)

    mcpTransportPair = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(mcpTransportPair[0])
    client = new Client({ name: 'smoke-control-roundtrip-client', version: '0.0.0' })
    await client.connect(mcpTransportPair[1])

    const createResult = await withTimeout(
      'create_mock',
      client.callTool({
        name: 'create_mock',
        arguments: { pattern: '/api/checkout', method: 'POST', mode: 'mock', status: 201, body: '{"ok":true}' },
      }),
    )
    assert.ok(!createResult.isError, `create_mock returned isError: ${JSON.stringify(createResult.content)}`)
    const createBody = JSON.parse(createResult.content[0].text)
    assert.equal(createBody.sent, true, 'create_mock should report sent:true (bridge connected)')
    assert.ok(/^mcp-mock-\d+$/.test(createBody.id), `create_mock id should match mcp-mock-<n>, got ${createBody.id}`)
    const mintedId = createBody.id

    await pollUntil('mockEngine.getRules() contains minted id', () =>
      mockEngine.getRules().some((r) => r.id === mintedId),
    )
    const rule = mockEngine.getRules().find((r) => r.id === mintedId)
    assert.equal(rule.pattern, '/api/checkout', 'relayed rule pattern mismatch')
    assert.equal(rule.method, 'POST', 'relayed rule method mismatch')
    assert.equal(rule.response.status, 201, 'relayed rule response.status mismatch')
    assert.equal(rule.response.body, '{"ok":true}', 'relayed rule response.body mismatch')
    assert.equal(rule.enabled, true, 'relayed rule should be enabled')

    const throttleResult = await withTimeout(
      'set_throttle',
      client.callTool({ name: 'set_throttle', arguments: { profile: 'custom', latencyMs: 250, downloadKbps: 512 } }),
    )
    assert.ok(!throttleResult.isError, `set_throttle returned isError: ${JSON.stringify(throttleResult.content)}`)
    await pollUntil(
      'ThrottleEngine.current reflects custom profile',
      () => ThrottleEngine.current.profile === 'custom' && ThrottleEngine.current.latencyMs === 250,
    )
    assert.equal(ThrottleEngine.current.downloadKbps, 512, 'ThrottleEngine downloadKbps mismatch after relay')

    // `create_mock` has no `modify` parameter (mock/block/redirect only), but
    // the control-channel contract supports it (`MockRuleModify` in
    // `packages/hakka-core/src/engine/MockEngine.ts`). Drive it directly through
    // `BridgeListener.sendControl` to prove the full relay path covers this
    // shape too.
    const modifyRuleId = 'smoke-modify-rule'
    const sentModify = listener.sendControl({
      kind: 'mock.add',
      rule: {
        id: modifyRuleId,
        pattern: '/api/modify-smoke',
        enabled: true,
        modify: {
          setRequestHeaders: { 'X-Injected': 'yes' },
          setQueryParams: { extra: '1' },
          status: 201,
          setResponseHeaders: { 'X-Resp': 'hi' },
          replaceBody: [{ find: 'world', replace: 'mars' }],
        },
        response: { status: 200, body: '' },
      },
    })
    assert.equal(sentModify, true, 'sendControl(mock.add with modify) should report true (bridge connected)')

    await pollUntil('mockEngine.getRules() contains the modify-rule id', () =>
      mockEngine.getRules().some((r) => r.id === modifyRuleId),
    )
    const modifyRule = mockEngine.getRules().find((r) => r.id === modifyRuleId)
    assert.equal(modifyRule.modify?.setRequestHeaders?.['X-Injected'], 'yes', 'modify.setRequestHeaders mismatch')
    assert.equal(modifyRule.modify?.setQueryParams?.extra, '1', 'modify.setQueryParams mismatch')
    assert.equal(modifyRule.modify?.status, 201, 'modify.status mismatch')
    assert.equal(modifyRule.modify?.setResponseHeaders?.['X-Resp'], 'hi', 'modify.setResponseHeaders mismatch')
    assert.equal(modifyRule.modify?.replaceBody?.[0]?.find, 'world', 'modify.replaceBody[0].find mismatch')
    assert.equal(modifyRule.modify?.replaceBody?.[0]?.replace, 'mars', 'modify.replaceBody[0].replace mismatch')
    assert.equal(mockEngine.isRewrite(modifyRule), true, 'a rule with only a modify block must be isRewrite')
    mockEngine.removeRule(modifyRuleId)

    // `create_mock` also has no `failure`/`skipCount`/`stopAfter` params yet —
    // drive the wire shape directly the same way, proving the relay path
    // covers the transport-error mock + match-budget shapes too.
    const failureRuleId = 'smoke-failure-rule'
    const sentFailure = listener.sendControl({
      kind: 'mock.add',
      rule: {
        id: failureRuleId,
        pattern: '/api/failure-smoke',
        enabled: true,
        failure: { code: 'timeout' },
        skipCount: 1,
        stopAfter: 2,
        response: { status: 200, body: '' },
      },
    })
    assert.equal(sentFailure, true, 'sendControl(mock.add with failure/skipCount/stopAfter) should report true')

    await pollUntil('mockEngine.getRules() contains the failure-rule id', () =>
      mockEngine.getRules().some((r) => r.id === failureRuleId),
    )
    const failureRule = mockEngine.getRules().find((r) => r.id === failureRuleId)
    assert.equal(failureRule.failure?.code, 'timeout', 'failure.code mismatch')
    assert.equal(failureRule.skipCount, 1, 'skipCount mismatch')
    assert.equal(failureRule.stopAfter, 2, 'stopAfter mismatch')
    mockEngine.removeRule(failureRuleId)

    // ── breakpoint.resume / breakpoint.abort: raw sendControl frames (no MCP
    //    tool exposes these yet — that is deliberately a later task's UI
    //    surface) relayed over the real bridge into the app peer's real
    //    breakpointEngine singleton, proving the resume/abort wire seam
    //    end to end, not just unit-tested in isolation ──────────────────────
    const resumePause = breakpointEngine.pause('smoke-req-resume', 'request', {
      url: 'https://api.example.com/checkout',
      method: 'GET',
      headers: {},
      body: null,
    })
    const [pendingResume] = await pollUntil('breakpointEngine has a pending request-phase pause', () => {
      const paused = breakpointEngine.getPaused()
      return paused.length > 0 ? paused : null
    })
    const sentResume = listener.sendControl({
      kind: 'breakpoint.resume',
      pauseId: pendingResume.id,
      requestEdits: { method: 'PUT' },
    })
    assert.equal(sentResume, true, 'sendControl(breakpoint.resume) should report true (bridge connected)')
    const resumeAction = await withTimeout('breakpoint.resume resolves the pause', resumePause)
    assert.equal(
      resumeAction.type,
      'resume',
      'breakpoint.resume relayed over the real bridge should resolve with type "resume"',
    )
    // parseControlCommand fills every optional edit field in explicitly (undefined for absent) — same
    // convention every other kind's parser uses — so assert the one field that was actually sent rather
    // than a byte-exact object.
    assert.equal(
      resumeAction.edits?.method,
      'PUT',
      'breakpoint.resume relayed over the real bridge should carry the sent edits',
    )

    const abortPause = breakpointEngine.pause('smoke-req-abort', 'request', {
      url: 'https://api.example.com/checkout',
      method: 'GET',
      headers: {},
      body: null,
    })
    const [pendingAbort] = await pollUntil('breakpointEngine has a pending request-phase pause to abort', () => {
      const paused = breakpointEngine.getPaused()
      return paused.length > 0 ? paused : null
    })
    const sentAbort = listener.sendControl({ kind: 'breakpoint.abort', pauseId: pendingAbort.id })
    assert.equal(sentAbort, true, 'sendControl(breakpoint.abort) should report true (bridge connected)')
    const abortAction = await withTimeout('breakpoint.abort resolves the pause', abortPause)
    assert.deepEqual(
      abortAction,
      { type: 'abort' },
      'breakpoint.abort relayed over the real bridge should abort the pause',
    )

    const deleteResult = await withTimeout(
      'delete_mock',
      client.callTool({ name: 'delete_mock', arguments: { id: mintedId } }),
    )
    assert.ok(!deleteResult.isError, `delete_mock returned isError: ${JSON.stringify(deleteResult.content)}`)
    const deleteBody = JSON.parse(deleteResult.content[0].text)
    assert.equal(deleteBody.sent, true, 'delete_mock should report sent:true (bridge connected)')

    await pollUntil('mockEngine.getRules() no longer contains deleted id', () =>
      mockEngine.getRules().every((r) => r.id !== mintedId),
    )

    // ── disconnected-bridge negative path: kill the listener, then a write
    //    tool call must report sent:false + isError, never throw ───────────
    listener.close()
    await new Promise((resolve) => setTimeout(resolve, 100)) // let the socket actually close
    const disconnectedResult = await withTimeout(
      'create_mock-while-disconnected',
      client.callTool({ name: 'create_mock', arguments: { pattern: '/api/never-sent' } }),
    )
    assert.equal(disconnectedResult.isError, true, 'create_mock while disconnected should be isError')
    const disconnectedBody = JSON.parse(disconnectedResult.content[0].text)
    assert.equal(disconnectedBody.sent, false, 'create_mock while disconnected should report sent:false')

    process.stdout.write(
      'PASS smoke-control-roundtrip: create_mock/set_throttle/delete_mock + a raw mock.add-with-modify frame + ' +
        'raw breakpoint.resume/breakpoint.abort frames relayed over a REAL bridge socket into a real peer process ' +
        'running parseControlCommand+applyControlCommand against the real mockEngine/breakpointEngine/' +
        'ThrottleEngine singletons; disconnected-bridge path verified isError without throwing\n',
    )
  } finally {
    // ── cleanup — never leave a listening socket or child process behind ───
    try {
      appPeer?.terminate()
    } catch {
      // already gone
    }
    try {
      await client?.close()
    } catch {
      // already gone
    }
    try {
      await mcpServer?.close()
    } catch {
      // already gone
    }
    try {
      listener?.close()
    } catch {
      // already gone
    }
    if (!bridgeClosed) {
      bridgeClosed = true
      await withTimeout('bridge-close', bridge.close(), 5_000)
    }
  }

  process.exit(0)
}

function describeErr(err) {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

main().catch((err) => {
  fail('unexpected', describeErr(err))
})
