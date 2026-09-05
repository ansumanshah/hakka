import { afterEach, beforeEach, expect, test } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { NetworkRequest } from 'hakka-core'

import { RequestStore } from '../RequestStore.js'
import { registerListRequestsTool } from '../tools/listRequests.js'

let store: RequestStore
let server: McpServer
let client: Client
const secret = 'private-cursor-value'
const request = (id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest => ({
  id,
  url: `https://example.com/?password=${secret}`,
  method: 'GET',
  startTime: 1,
  requestBody: JSON.stringify({ password: secret }),
  ...overrides,
})

beforeEach(async () => {
  store = new RequestStore(3)
  server = new McpServer({ name: 'cursor-test', version: '1' })
  registerListRequestsTool(server, store)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  client = new Client({ name: 'cursor-client', version: '1' })
  await client.connect(b)
})
afterEach(async () => {
  await client.close()
  await server.close()
})

async function read(args: Record<string, unknown>) {
  const result = await client.callTool({ name: 'list_requests', arguments: args })
  return JSON.parse((result.content as { text: string }[])[0]!.text)
}

test('insertions between pages and updates use change order rather than capture timestamps', async () => {
  store.add(request('a', { startTime: 999 }))
  store.add(request('b', { startTime: 0 }))
  const first = await read({ cursor: '', limit: 1, summary: true })
  expect(first.requests.map((r: NetworkRequest) => r.id)).toEqual(['a'])
  expect(first.hasMore).toBe(true)
  store.add(request('c', { startTime: -1 }))
  const second = await read({ cursor: first.nextCursor, limit: 1 })
  expect(second.requests.map((r: NetworkRequest) => r.id)).toEqual(['b'])
  store.add(request('a', { status: 200 }))
  const third = await read({ cursor: second.nextCursor })
  expect(third.requests.map((r: NetworkRequest) => r.id)).toEqual(['c', 'a'])
  expect(third.requests[1].status).toBe(200)
  expect(third.hasMore).toBe(false)
  const empty = await read({ cursor: third.nextCursor })
  expect(empty.requests).toEqual([])
  expect(empty.nextCursor).toBe(third.nextCursor)
})

test('multiple unread updates coalesce to the latest request without duplicate IDs', async () => {
  const first = await read({ cursor: '' })
  store.add(request('a', { status: 100 }))
  store.add(request('a', { status: 200 }))
  const page = await read({ cursor: first.nextCursor, summary: true })
  expect(page.requests).toHaveLength(1)
  expect(page.requests[0].status).toBe(200)
  expect(page.requests[0].requestBody).toBeUndefined()
  expect(JSON.stringify(page)).not.toContain(secret)
  expect(store.get('a')!.requestBody).toContain(secret)
})

test('eviction and clear explicitly expire cursors and permit an empty-cursor restart', async () => {
  for (const id of ['a', 'b', 'c']) store.add(request(id))
  const first = await read({ cursor: '' })
  store.add(request('d'))
  expect((await read({ cursor: first.nextCursor })).error).toBe('cursor_expired')
  const restarted = await read({ cursor: '' })
  expect(restarted.requests.map((r: NetworkRequest) => r.id)).toEqual(['b', 'c', 'd'])
  store.clear()
  expect((await read({ cursor: restarted.nextCursor })).error).toBe('cursor_expired')
  expect((await read({ cursor: '' })).requests).toEqual([])
})

test('legacy offset/full results remain unchanged and incompatible pagination is rejected', async () => {
  store.add(request('a'))
  store.add(request('b'))
  const page = await read({ offset: 1, limit: 1, unredacted: true })
  expect(page.requests[0].id).toBe('a')
  expect(page.requests[0].requestBody).toContain(secret)
  expect(page.nextCursor).toBeUndefined()
  expect((await read({ cursor: '', offset: 1 })).error).toBe('invalid_pagination')
  expect((await read({ cursor: 'not-json' })).error).toBe('invalid_cursor')
})
