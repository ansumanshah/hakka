import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { REPLAY_MARKER_HEADER, type ControlCommand, type NetworkRequest } from 'hakka-core'

import { RequestStore } from '../RequestStore.js'
import { registerResources } from '../resources.js'
import { registerReplayRequestTool } from '../tools/replayRequest.js'
import { registerVerifyFixTool } from '../tools/verifyFix.js'

const SECRET = 'sk-live-abcdef0123456789'

function capturedRequest(id: string): NetworkRequest {
  return {
    id,
    url: `https://api.example.com/items?api_key=${SECRET}`,
    method: 'POST',
    status: 200,
    startTime: 1,
    duration: 100,
    requestHeaders: {},
    requestBody: JSON.stringify({ password: SECRET }),
    responseBody: JSON.stringify({ token: SECRET }),
  }
}

let server: McpServer
let client: Client
let store: RequestStore

beforeEach(async () => {
  store = new RequestStore(100)
  store.add(capturedRequest('original'))
  server = new McpServer({ name: 'test', version: '0.0.0' })
  const sender = {
    connected: true,
    sendControl(command: ControlCommand): boolean {
      if (command.kind === 'request.replay') {
        setTimeout(() => {
          store.add({
            ...capturedRequest('replayed'),
            requestHeaders: { [REPLAY_MARKER_HEADER]: command.replayMarker! },
          })
        }, 0)
      }
      return true
    },
  }
  registerResources(server, store)
  registerReplayRequestTool(server, store, sender)
  registerVerifyFixTool(server, store, sender)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(clientTransport)
})

afterEach(async () => {
  await client.close()
  await server.close()
})

describe('MCP resource and replay share boundaries', () => {
  it('recent requests scrub secrets without mutating stored captures or changing array shape', async () => {
    const result = await client.readResource({ uri: 'hakka://requests/recent' })
    const requests = JSON.parse(result.contents[0]!.text as string)
    expect(requests).toHaveLength(1)
    expect(requests[0].id).toBe('original')
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(store.get('original')!.requestBody).toContain(SECRET)
  })

  it.each(['replay_request', 'verify_fix'])('%s scrubs replay results', async (name) => {
    const result = await client.callTool({ name, arguments: { requestId: 'original', timeoutMs: 1000 } })
    const payload = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(result.isError).not.toBe(true)
    expect(payload.replayed.id).toBe('replayed')
    expect(payload.replayed.status).toBe(200)
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(store.get('replayed')!.responseBody).toContain(SECRET)
  })

  it('verify_fix checks the captured body while scrubbing duration diagnostic URLs', async () => {
    const result = await client.callTool({
      name: 'verify_fix',
      arguments: {
        requestId: 'original',
        timeoutMs: 1000,
        expect: { bodyContains: SECRET },
        maxDurationMs: 10,
      },
    })
    const payload = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(result.isError).not.toBe(true)
    expect(payload.passed).toBe(false)
    expect(payload.violations.map((violation: { rule: string }) => violation.rule)).toEqual(['max-duration-ms'])
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })
})
