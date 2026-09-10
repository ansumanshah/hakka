import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ControlCommand } from 'hakka-core'

import { registerApplyRuleBundleTool } from '../tools/applyRuleBundle'
import { registerRunCollectionTool } from '../tools/runCollection'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function connect() {
  const server = new McpServer({ name: 'test', version: '1' })
  const commands: ControlCommand[] = []
  registerApplyRuleBundleTool(server, {
    connected: true,
    sendControl(command) {
      commands.push(command)
      return true
    },
  })
  registerRunCollectionTool(server)
  const client = new Client({ name: 'agent', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(left)
  await client.connect(right)
  cleanups.push(async () => {
    await client.close()
    await server.close()
  })
  return { client, commands }
}

describe('agent workflows over MCP', () => {
  it('validates the full bundle before mutation and supports dry-run plus stable-ID retries', async () => {
    const { client, commands } = await connect()
    const rule = { id: 'stable', pattern: '/api', enabled: true, response: { status: 200, body: '{}' } }
    const invalid = await client.callTool({
      name: 'apply_rule_bundle',
      arguments: {
        bundle: { version: 1, rules: [rule, { ...rule, id: 'bad', enabled: 'yes' }] },
      },
    })
    expect(invalid.isError).toBe(true)
    expect(commands).toHaveLength(0)
    await client.callTool({
      name: 'apply_rule_bundle',
      arguments: { bundle: { version: 1, rules: [rule] }, dryRun: true },
    })
    expect(commands).toHaveLength(0)
    for (let i = 0; i < 2; i++)
      await client.callTool({ name: 'apply_rule_bundle', arguments: { bundle: { version: 1, rules: [rule] } } })
    expect(commands).toHaveLength(2)
    expect(commands[0]).toEqual(commands[1])
  })

  it('runs an authored request and exposes failures through MCP isError', async () => {
    const { client } = await connect()
    const fixture = Bun.serve({ port: 0, fetch: () => new Response('private-response', { status: 503 }) })
    cleanups.push(async () => {
      fixture.stop(true)
    })
    const dir = await mkdtemp(join(tmpdir(), 'hakka-agent-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'request.hakka')
    await writeFile(
      path,
      JSON.stringify({
        seq: 0,
        spec: {
          id: 'one',
          name: 'Check service',
          method: 'GET',
          url: fixture.url.href,
          headers: [],
          query: [],
          body: { none: {} },
          auth: { inherit: {} },
          assertions: [{ id: 'status', enabled: true, target: { status: {} }, op: 'equals', expected: '200' }],
          captures: [],
          followRedirects: true,
        },
      }),
    )
    const result = await client.callTool({ name: 'run_collection', arguments: { path } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private-response')
    const content = result.content as Array<{ text: string }>
    const report = JSON.parse(content[0]!.text)
    expect(report.items[0].status).toBe(503)
    expect(report.failed).toBe(1)
  })
})
