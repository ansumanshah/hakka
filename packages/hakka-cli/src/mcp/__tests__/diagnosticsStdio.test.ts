import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startBridgeServer } from 'hakka-bridge'
import WebSocket from 'ws'

/** Build core → bridge → CLI first: this exercises the actual built CLI stdio process. */
test('built CLI receives network, console and performance through its existing bridge', async () => {
  const bridge = await startBridgeServer({ host: '127.0.0.1', port: 0 })
  const publisher = new WebSocket(`ws://127.0.0.1:${bridge.port}`)
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      fileURLToPath(new URL('../../../dist/cli.mjs', import.meta.url)),
      'mcp',
      '--url',
      `ws://127.0.0.1:${bridge.port}`,
      '--no-serve',
    ],
    env: { HAKKA_MCP_SERVE: '0', HAKKA_WORKSPACE_DIR: '' },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'diagnostic-stdio-smoke', version: '0.0.0' })
  try {
    await client.connect(transport)
    const deadline = Date.now() + 2500
    while (publisher.readyState !== WebSocket.OPEN) {
      if (Date.now() > deadline) throw new Error('publisher did not connect')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const send = (type: string, payload: unknown): void => publisher.send(JSON.stringify({ type, payload }))
    // Repeating a bounded probe tolerates the child's asynchronous bridge connect.
    let logs: Record<string, unknown> | undefined
    let performance: Record<string, unknown> | undefined
    while (Date.now() <= deadline) {
      send('console', [
        { id: 'stdio-log', timestamp: 123, level: 'warn', message: 'captured fact', metadata: { secret: 'private' } },
      ])
      send('performance', [
        {
          id: 'stdio-cpu',
          schemaVersion: 1,
          timestamp: 123,
          kind: 'metric.cpu',
          processCpuPercent: 175.5,
          tags: { secret: 'private' },
        },
      ])
      send('request', {
        id: 'stdio-request',
        url: 'https://example.test/stdio',
        method: 'GET',
        status: 200,
        startTime: 123,
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      logs = (await client.callTool({ name: 'list_logs', arguments: { limit: 1 } })).structuredContent
      performance = (await client.callTool({ name: 'list_performance', arguments: { limit: 1 } })).structuredContent
      if (logs && performance && Number(logs.retained) > 0 && Number(performance.retained) > 0) break
    }
    expect(logs).toMatchObject({ status: 'inspected', invalid: 0, measurementScope: 'upstream-store' })
    expect(performance).toMatchObject({ status: 'inspected', invalid: 0, collectorDroppedSamples: 'unavailable' })
    expect(logs?.entries).toMatchObject([{ message: 'captured fact', level: 'warn' }])
    expect(performance?.entries).toMatchObject([{ kind: 'metric.cpu', processCpuPercent: 175.5 }])
    expect(JSON.stringify({ logs, performance })).not.toContain('private')
    const requests = (await client.callTool({ name: 'list_requests', arguments: { summary: true, limit: 1 } }))
      .structuredContent
    expect(requests?.requests).toMatchObject([{ id: 'stdio-request', url: 'https://example.test/stdio' }])
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names).toContain('list_logs')
    expect(names).toContain('list_performance')
  } finally {
    await client.close()
    publisher.close()
    await bridge.close()
  }
}, 10_000)
