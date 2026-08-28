#!/usr/bin/env node
/**
 * Live process-level smoke test of the `hakka mcp` server subcommand.
 *
 * Unlike packages/hakka-cli/src/mcp/server.test.ts (in-process over
 * InMemoryTransport), this spawns the built dist/cli.mjs as a child process
 * (`hakka mcp`) and speaks MCP over real stdio pipes via the SDK's Client +
 * StdioClientTransport — what a real MCP client (Claude Code, Cursor, ...)
 * actually does.
 *
 * Steps: build cli -> spawn `dist/cli.mjs mcp` -> initialize handshake ->
 * tools/list (assert the five tools) -> tools/call stats on the empty store
 * -> clean shutdown (verify no orphan child process). Every step is
 * timeout-guarded (~10s).
 *
 * @modelcontextprotocol/sdk isn't hoisted to the repo root under bun
 * workspaces — imported via an explicit path into
 * packages/hakka-cli/node_modules/@modelcontextprotocol/sdk so resolution doesn't
 * depend on hoisting layout.
 *
 * Usage:
 *   node scripts/smoke-mcp-handshake.mjs
 *
 * Exit code 0 + a one-line PASS on success; exit code 1 + the failing step
 * printed to stderr on failure.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const mcpPkgDir = path.join(repoRoot, 'packages', 'hakka-cli')
const serverBin = path.join(mcpPkgDir, 'dist', 'cli.mjs')
const serverArgs = ['mcp']
const sdkDir = path.join(mcpPkgDir, 'node_modules', '@modelcontextprotocol', 'sdk')

const STEP_TIMEOUT_MS = 10_000

const EXPECTED_TOOLS = ['list_requests', 'get_request', 'search_requests', 'stats', 'clear']

function fail(step, detail) {
  process.stderr.write(`FAIL [${step}]: ${detail}\n`)
  process.exit(1)
}

/**
 * Race a promise against a timeout, failing loudly with the step name.
 * `getExtraContext` (if given) is called for its return value only when the
 * step fails, to attach extra diagnostics (e.g. buffered server stderr).
 */
async function withTimeout(step, promise, ms = STEP_TIMEOUT_MS, getExtraContext) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      }),
    ])
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const extra = getExtraContext?.()
    fail(step, extra ? `${detail}\nserver stderr:\n${extra}` : detail)
  } finally {
    clearTimeout(timer)
  }
}

async function loadSdk() {
  if (!existsSync(sdkDir)) {
    fail('sdk-resolve', `@modelcontextprotocol/sdk not found at ${sdkDir} — run "bun install" in ${mcpPkgDir} first`)
  }
  const sdkPkgUrl = pathToFileURL(sdkDir).href
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(`${sdkPkgUrl}/dist/esm/client/index.js`),
    import(`${sdkPkgUrl}/dist/esm/client/stdio.js`),
  ])
  return { Client, StdioClientTransport }
}

async function buildServer() {
  if (!existsSync(mcpPkgDir)) {
    fail('build', `packages/hakka-cli not found at ${mcpPkgDir}`)
  }
  try {
    execFileSync('bun', ['run', 'build'], {
      cwd: mcpPkgDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      encoding: 'utf8',
    })
  } catch (err) {
    const stdout = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout ?? '') : ''
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr ?? '') : ''
    fail('build', `"bun run build" failed in ${mcpPkgDir}\n${stdout}\n${stderr}`.trim())
  }
  if (!existsSync(serverBin)) {
    fail('build', `build succeeded but ${serverBin} does not exist`)
  }
}

async function main() {
  await buildServer()
  const { Client, StdioClientTransport } = await loadSdk()

  // Point at an unreachable bridge port so the server starts cleanly without
  // a live Hakka bridge — the store stays empty, as step 5 needs.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverBin, ...serverArgs],
    env: {
      ...process.env,
      HAKKA_BRIDGE_URL: 'ws://127.0.0.1:1',
      HAKKA_MCP_MAX_REQUESTS: '500',
    },
    stderr: 'pipe',
  })

  const client = new Client({ name: 'hakka-mcp-smoke-test', version: '0.0.0' })

  // Surface server stderr on failure for debuggability, but don't let it
  // pollute stdout (which the MCP protocol owns on the server side).
  let stderrOutput = ''
  transport.stderr?.on('data', (chunk) => {
    stderrOutput += chunk.toString()
  })

  await withTimeout('initialize', client.connect(transport), STEP_TIMEOUT_MS, () => stderrOutput)

  let childPid
  try {
    childPid = transport.pid ?? transport._process?.pid
  } catch {
    childPid = undefined
  }

  try {
    const toolsResult = await withTimeout('tools/list', client.listTools())
    const toolNames = toolsResult.tools.map((t) => t.name)
    const missing = EXPECTED_TOOLS.filter((name) => !toolNames.includes(name))
    if (missing.length > 0) {
      fail('tools/list', `missing expected tools: ${missing.join(', ')} (got: ${toolNames.join(', ')})`)
    }

    const statsResult = await withTimeout('tools/call stats', client.callTool({ name: 'stats', arguments: {} }))
    if (statsResult.isError) {
      fail('tools/call stats', `tool returned isError=true: ${JSON.stringify(statsResult.content)}`)
    }
    const statsText = statsResult.content?.[0]?.text
    if (typeof statsText !== 'string') {
      fail('tools/call stats', `expected text content, got: ${JSON.stringify(statsResult.content)}`)
    }
    let stats
    try {
      stats = JSON.parse(statsText)
    } catch {
      fail('tools/call stats', `result text is not valid JSON: ${statsText}`)
    }
    const requiredFields = ['total', 'pending', 'success', 'error', 'errorRate', 'avgDurationMs', 'byHost']
    const missingFields = requiredFields.filter((f) => !(f in stats))
    if (missingFields.length > 0) {
      fail('tools/call stats', `result missing fields: ${missingFields.join(', ')} (got: ${statsText})`)
    }
    if (stats.total !== 0) {
      fail('tools/call stats', `expected empty store (total=0), got total=${stats.total}`)
    }
  } finally {
    await withTimeout('shutdown', client.close(), 5_000)

    if (childPid != null) {
      const alive = await withTimeout('orphan-check', waitForExit(transport, childPid), 5_000)
      if (alive === false) {
        fail('shutdown', `child process (pid ${childPid}) did not exit after client.close()`)
      }
    }
  }

  process.stdout.write('PASS hakka-mcp stdio handshake: initialize, tools/list, tools/call(stats), clean shutdown\n')
  process.exit(0)
}

/**
 * Poll whether the given pid has exited within the timeout. Resolves true
 * once the process is confirmed gone, false if it's still alive after
 * repeated checks.
 */
async function waitForExit(_transport, pid) {
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (isPidAlive(pid)) {
    // Last resort: make sure we don't leave an orphan even though the smoke
    // test itself is about to report failure.
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
    return false
  }
  return true
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

main().catch((err) => {
  fail('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err))
})
