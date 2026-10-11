import { describe, expect, test } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MAX_DIAGNOSTIC_FRAME_BYTES, startBridgeServer } from 'hakka-bridge'
import WebSocket from 'ws'

import { createBridgeListener } from '../bridgeListener'
import { DiagnosticStore } from '../DiagnosticStore'
import { RequestStore } from '../RequestStore'
import { SpanStore } from '../SpanStore'
import { registerTools } from '../tools/index'

const metric = { id: 'cpu', kind: 'metric.cpu', schemaVersion: 1, timestamp: 123, processCpuPercent: 175.5 }
const log = { id: 'log', timestamp: 123, level: 'info', message: 'captured log' }
const frame = (type: string, payload: unknown): string => JSON.stringify({ type, payload })

describe('bounded diagnostic retention', () => {
  test('retains newest arrivals with exact eviction and page omission counts', () => {
    const store = new DiagnosticStore(2)
    store.ingestFrame(
      frame('console', [log, { ...log, id: 'new', timestamp: 10 }, { ...log, id: 'latest', timestamp: 5 }]),
    )
    const page = store.listLogs(1)
    expect(page.entries.map((entry) => entry.timestamp)).toEqual([5])
    expect(page).toMatchObject({ retained: 2, omitted: 1, evicted: 1, invalid: 0 })
    expect(page.collectorDroppedSamples).toBe('unavailable')
    expect(page.targetCorrelation).toBe('unavailable')
    expect(page.sourceIdentity).toBe('unverified')
    expect(page.sampleIntervalMs).toBe('unavailable')
  })

  test('scrubs log text and drops private IDs, category, metadata, tags and sessions', () => {
    const store = new DiagnosticStore()
    store.ingestFrame(
      frame('console', [
        {
          ...log,
          id: '/Users/private/source.ts',
          category: '/home/private',
          message:
            'Bearer secret-token password=hunter2 email=person@example.com /Users/private/source.ts https://private.test?a=secret sk-live-abcdefghijk',
          metadata: { secret: 'raw-metadata-secret' },
          sessionId: 'session-secret',
          tags: { secret: 'tag-secret' },
        },
      ]),
    )
    const page = store.listLogs()
    const output = JSON.stringify(page)
    for (const secret of [
      'secret-token',
      'hunter2',
      'person@example.com',
      '/Users/private',
      'private.test',
      'sk-live-',
      'raw-metadata-secret',
      'session-secret',
      'tag-secret',
    ])
      expect(output).not.toContain(secret)
    expect(page.entries[0].id).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.keys(page.entries[0]).sort()).toEqual(['id', 'level', 'message', 'timestamp'])
    store.ingestFrame(frame('console', [{ ...log, message: 'x'.repeat(1000) }]))
    expect(store.listLogs().entries[0].message.length).toBe(512)
  })

  test('projects measurements without manufacturing missing values or revealing metadata', () => {
    const store = new DiagnosticStore(2)
    store.ingestFrame(
      frame('performance', [
        { ...metric, sessionId: 'private', tags: { secret: 'private' }, metadata: { secret: 'private' } },
        { id: 'memory', kind: 'metric.memory', schemaVersion: 1, timestamp: 100 },
        { id: 'network', kind: 'metric.network_usage', schemaVersion: 1, timestamp: 50, txBytes: 0 },
      ]),
    )
    const page = store.listPerformance()
    expect(page).toMatchObject({ retained: 2, evicted: 1, invalid: 0 })
    expect(page.entries[0]).toMatchObject({ kind: 'metric.network_usage', txBytes: 0 })
    expect(page.entries[0]).not.toHaveProperty('rxBytes')
    expect(page.entries[1]).not.toHaveProperty('heapUsedBytes')
    expect(JSON.stringify(page)).not.toContain('private')
    store.ingestFrame(frame('performance', [metric]))
    expect(store.listPerformance().entries[0]).toMatchObject({ processCpuPercent: 175.5 })
  })

  test('rejects malformed versions/values and counts invalid entries without throwing', () => {
    const store = new DiagnosticStore()
    expect(() =>
      store.ingestFrame(
        frame('performance', [
          { ...metric, schemaVersion: 2 },
          { ...metric, timestamp: -1 },
          { ...metric, processCpuPercent: null },
          { ...metric, kind: 'breadcrumb' },
          { ...metric, kind: 'metric.memory', pssBytes: 1.5 },
          { ...metric, processCpuPercent: -2 },
          null,
          metric,
        ]),
      ),
    ).not.toThrow()
    expect(store.listPerformance()).toMatchObject({ invalid: 7, retained: 1 })
    store.ingestFrame(
      frame('console', [
        { ...log, level: 'narration' },
        { ...log, timestamp: null },
      ]),
    )
    expect(store.listLogs()).toMatchObject({ invalid: 2, retained: 0 })
  })

  test('bounds frames, batch size and record size independently', () => {
    const store = new DiagnosticStore()
    store.ingestFrame(
      frame(
        'console',
        Array.from({ length: 101 }, () => log),
      ),
    )
    store.ingestFrame(frame('console', [{ ...log, metadata: { oversized: 'x'.repeat(8192) } }]))
    store.ingestFrame(frame('console', [{ ...log, message: 'x'.repeat(MAX_DIAGNOSTIC_FRAME_BYTES) }]))
    store.ingestFrame('{"type":"console","payload":[')
    expect(store.listLogs()).toMatchObject({ retained: 0, invalid: 4 })
    expect(() =>
      store.ingestFrame(
        '{"type":"console","payload":[{"metadata":' + '['.repeat(5000) + '0' + ']'.repeat(5000) + '}]}',
      ),
    ).not.toThrow()
  })

  test('returned pages cannot mutate retained records', () => {
    const store = new DiagnosticStore()
    store.ingestFrame(frame('console', [log]))
    store.listLogs().entries[0].message = 'mutated'
    expect(store.listLogs().entries[0].message).toBe(log.message)
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('diagnostics were not received')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('existing WebSocket listener exposes real relayed diagnostics through MCP tools', async () => {
  const hub = await startBridgeServer({ host: '127.0.0.1', port: 0 })
  const diagnostics = new DiagnosticStore()
  const requests = new RequestStore(10)
  const spans = new SpanStore(10)
  const listener = createBridgeListener(requests, `ws://127.0.0.1:${hub.port}`, spans, diagnostics)
  const publisher = new WebSocket(`ws://127.0.0.1:${hub.port}`)
  const server = new McpServer({ name: 'diagnostic-test', version: '0.0.0' })
  const closeTools = registerTools(server, requests, listener, spans, diagnostics)
  const client = new Client({ name: 'diagnostic-test-client', version: '0.0.0' })
  try {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    await waitFor(() => listener.connected && publisher.readyState === WebSocket.OPEN)
    publisher.send(frame('console', [{ ...log, metadata: { secret: 'private' } }]))
    publisher.send(frame('performance', [{ ...metric, sessionId: 'private' }]))
    await waitFor(() => diagnostics.listLogs().retained === 1 && diagnostics.listPerformance().retained === 1)
    for (const name of ['list_logs', 'list_performance']) {
      const result = await client.callTool({ name, arguments: {} })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({
        status: 'inspected',
        retained: 1,
        invalid: 0,
        measurementScope: 'upstream-store',
      })
      expect(JSON.stringify(result)).not.toContain('private')
      expect((await client.callTool({ name, arguments: { limit: 51 } })).isError).toBe(true)
    }
    expect(requests.size).toBe(0)
    expect(hub.hub.size).toBe(0)
  } finally {
    listener.close()
    publisher.close()
    await closeTools()
    await client.close()
    await server.close()
    await hub.close()
  }
})
