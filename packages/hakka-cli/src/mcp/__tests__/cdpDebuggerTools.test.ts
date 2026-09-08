import { expect, test } from 'bun:test'
import { once } from 'node:events'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebSocketServer } from 'ws'
import type WebSocket from 'ws'

import { registerCdpDebuggerTools } from '../tools/cdpDebuggerTools.js'

function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) resolve()
      else if (Date.now() > deadline) reject(new Error('condition did not become true'))
      else setTimeout(check, 2)
    }
    check()
  })
}

test('CDP MCP tools reuse one live connection, reconnect after close, and release it on shutdown', async () => {
  const wss = new WebSocketServer({ port: 0 })
  await once(wss, 'listening')
  const address = wss.address()
  if (typeof address === 'string' || address === null) throw new Error('Expected an assigned TCP port')
  const previousUrl = process.env.HAKKA_CDP_URL
  process.env.HAKKA_CDP_URL = `ws://127.0.0.1:${address.port}`
  let connections = 0
  const active = new Set<WebSocket>()
  wss.on('connection', (socket) => {
    connections++
    active.add(socket)
    socket.on('close', () => active.delete(socket))
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { id: number; method: string }
      if (message.method === 'Debugger.enable') {
        socket.send(
          JSON.stringify({ method: 'Debugger.scriptParsed', params: { scriptId: 'script-1', url: 'app.js' } }),
        )
      }
      const result =
        message.method === 'Debugger.getScriptSource'
          ? { scriptSource: '🙂abc' }
          : message.method === 'Debugger.setBreakpoint'
            ? { breakpointId: 'bp-1', locations: [] }
            : {}
      socket.send(JSON.stringify({ id: message.id, result }))
    })
  })

  const server = new McpServer({ name: 'cdp-tools-test', version: '1' })
  const closeDebugger = registerCdpDebuggerTools(server)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'cdp-tools-client', version: '1' })
  await client.connect(clientTransport)

  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names).toContain('cdp_list_scripts')
    expect(names).toContain('cdp_set_breakpoint')
    const first = await client.callTool({ name: 'cdp_list_scripts', arguments: {} })
    expect(first.isError).toBeUndefined()
    await client.callTool({ name: 'cdp_get_script_source', arguments: { scriptId: 'script-1', maxBytes: 5 } })
    expect(connections).toBe(1)
    expect(active.size).toBe(1)

    active.values().next().value!.terminate()
    await waitFor(() => active.size === 0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const reconnected = await client.callTool({ name: 'cdp_list_scripts', arguments: {} })
    expect(reconnected.isError).toBeUndefined()
    expect(connections).toBe(2)

    await closeDebugger()
    await waitFor(() => active.size === 0)
    const closed = await client.callTool({ name: 'cdp_list_scripts', arguments: {} })
    expect(closed.isError).toBe(true)
    expect(connections).toBe(2)
  } finally {
    await closeDebugger()
    await client.close()
    await server.close()
    for (const socket of active) socket.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    if (previousUrl === undefined) delete process.env.HAKKA_CDP_URL
    else process.env.HAKKA_CDP_URL = previousUrl
  }
})
