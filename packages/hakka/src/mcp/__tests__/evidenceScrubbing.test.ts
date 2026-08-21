import { beforeEach, describe, expect, it } from 'bun:test'

/**
 * Evidence scrubbing — share-time scrubbing (`hakka-core`'s `shareScrub.ts`) applied by
 * default across every MCP tool that hands captured request data to an agent:
 * `get_request`, `list_requests`, `search_requests`, `export_evidence`, `generate_repro`.
 *
 * This is the test the task exists to write: a known secret placed in a header, a JSON
 * body field, a query string, a cookie, and a nested body object must not appear in the
 * output of ANY of these tools by default. Tested through the real MCP protocol (server +
 * client over `InMemoryTransport`), same style as `readTools.test.ts` — an agent sees the
 * wire result, not the function's return value.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ControlCommand, NetworkRequest } from 'hakka-core'

import { RequestStore } from '../RequestStore.js'
import { SpanStore } from '../SpanStore.js'
import { registerTools, type ControlSender } from '../tools/index.js'

class SilentSender implements ControlSender {
  send(_command: ControlCommand): void {}
}

const SECRET = 'sk-live-abcdef0123456789'

let idSeq = 0
/** A request carrying SECRET in a header, a JSON body field, a query string param, a cookie header, and a nested body object — every placement the task's own acceptance test requires. */
function secretRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  idSeq++
  return {
    id: `req-${idSeq}`,
    url: `https://api.example.com/v1/chat?api_key=${SECRET}`,
    method: 'POST',
    status: 200,
    startTime: idSeq,
    duration: 100,
    requestHeaders: {
      Authorization: `Bearer ${SECRET}`,
      Cookie: `session_id=${SECRET}`,
    },
    responseHeaders: {},
    requestBody: JSON.stringify({
      password: SECRET,
      nested: { auth: { token: SECRET } },
    }),
    responseBody: JSON.stringify({ ok: true }),
    ...overrides,
  }
}

let store: RequestStore
let client: Client
let closeAll: () => Promise<void>

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[]
    isError?: boolean
  }
  return { ...JSON.parse(result.content[0].text), __isError: result.isError ?? false }
}

beforeEach(async () => {
  idSeq = 0
  store = new RequestStore(100)
  const mcpServer = new McpServer({ name: 'test', version: '0.0.0' })
  registerTools(mcpServer, store, new SilentSender(), new SpanStore(50))

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await mcpServer.connect(serverTransport)
  client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(clientTransport)
  closeAll = async () => {
    await client.close()
    await mcpServer.close()
  }
})

describe('get_request — scrubs by default', () => {
  it('the secret does not appear anywhere in the result', async () => {
    const req = secretRequest()
    store.add(req)

    const payload = await call('get_request', { id: req.id })

    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect(payload.redaction).toBeDefined()
    await closeAll()
  })

  it('unredacted: true opts out and the secret survives', async () => {
    const req = secretRequest()
    store.add(req)

    const payload = await call('get_request', { id: req.id, unredacted: true })

    // The MCP store itself always redacts headers at ingest (RequestStore.redact), so
    // assert on the body field, which only share-time scrubbing would otherwise touch.
    expect(JSON.stringify(payload)).toContain(SECRET)
    expect(payload.redaction).toEqual({ applied: false, removed: [] })
    await closeAll()
  })
})

describe('list_requests — scrubs by default', () => {
  it('the secret does not appear anywhere in the page', async () => {
    store.add(secretRequest())

    const payload = await call('list_requests')

    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect((payload.redaction as { applied: boolean }).applied).toBe(true)
    await closeAll()
  })

  it('unredacted: true opts out', async () => {
    store.add(secretRequest())

    const payload = await call('list_requests', { unredacted: true })

    expect(JSON.stringify(payload)).toContain(SECRET)
    await closeAll()
  })
})

describe('search_requests — scrubs by default', () => {
  it('the secret does not appear anywhere in the results', async () => {
    store.add(secretRequest())

    const payload = await call('search_requests', {})

    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect((payload.redaction as { applied: boolean }).applied).toBe(true)
    await closeAll()
  })

  it('unredacted: true opts out', async () => {
    store.add(secretRequest())

    const payload = await call('search_requests', { unredacted: true })

    expect(JSON.stringify(payload)).toContain(SECRET)
    await closeAll()
  })
})

describe('export_evidence — scrubs by default', () => {
  it('the secret does not appear anywhere in the bundle, including derived mocks', async () => {
    store.add(secretRequest())

    const payload = await call('export_evidence', {})

    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect((payload.redaction as { applied: boolean }).applied).toBe(true)
    await closeAll()
  })

  it('unredacted: true opts out', async () => {
    store.add(secretRequest())

    const payload = await call('export_evidence', { unredacted: true })

    expect(JSON.stringify(payload)).toContain(SECRET)
    await closeAll()
  })
})

describe('generate_repro — scrubs by default, including the generated test file', () => {
  it('the secret does not appear anywhere in the bundle or the generated test file', async () => {
    store.add(secretRequest())

    const payload = await call('generate_repro', {})

    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect(payload.testFile).not.toContain(SECRET)
    expect((payload.redaction as { applied: boolean }).applied).toBe(true)
    await closeAll()
  })

  it('unredacted: true opts out, including the generated test file', async () => {
    store.add(secretRequest())

    const payload = await call('generate_repro', { unredacted: true })

    expect(JSON.stringify(payload)).toContain(SECRET)
    await closeAll()
  })
})
