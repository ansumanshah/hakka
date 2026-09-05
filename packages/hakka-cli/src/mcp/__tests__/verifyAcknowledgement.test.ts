import { expect, test } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { REPLAY_MARKER_HEADER, type RuntimeControlResult } from 'hakka-core'

import { RequestStore } from '../RequestStore'
import type { ControlSender } from '../tools/controlDispatch'
import { registerVerifyFixTool } from '../tools/verifyFix'

test.each(['applied', 'timeout'] as const)(
  'verify_fix gates replay on mock result %s and preserves selected target',
  async (status) => {
    const store = new RequestStore()
    store.add({ id: 'original', url: 'https://example.com/', method: 'GET', startTime: 1 })
    let acknowledge!: (result: RuntimeControlResult) => void
    let mockRequested!: () => void
    const requested = new Promise<void>((resolve) => {
      mockRequested = resolve
    })
    const targets: Array<string | undefined> = []
    const kinds: string[] = []
    const sender: ControlSender = {
      connected: true,
      sendControl: () => {
        throw new Error('legacy broadcast must not be used')
      },
      requestControl: async (command, targetId) => {
        kinds.push(command.kind)
        targets.push(targetId)
        if (command.kind === 'mock.add')
          return new Promise((resolve) => {
            acknowledge = resolve
            mockRequested()
          })
        if (command.kind === 'request.replay') {
          store.add({
            id: 'replayed',
            url: 'https://example.com/',
            method: 'GET',
            startTime: 2,
            status: 200,
            requestHeaders: { [REPLAY_MARKER_HEADER]: command.replayMarker! },
          })
        }
        return { commandId: 'replay', targetId: targetId!, status: 'applied' }
      },
    }
    const server = new McpServer({ name: 'test', version: '1' })
    registerVerifyFixTool(server, store, sender)
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    const client = new Client({ name: 'test', version: '1' })
    await client.connect(b)
    try {
      const result = client.callTool({
        name: 'verify_fix',
        arguments: {
          requestId: 'original',
          targetId: 'a',
          mock: { pattern: 'example.com' },
          expect: { status: 200 },
          timeoutMs: 1000,
        },
      })
      await requested
      expect(kinds).toEqual(['mock.add'])
      acknowledge(
        status === 'applied'
          ? { commandId: 'mock', targetId: 'a', status: 'applied' }
          : { commandId: 'mock', targetId: 'a', status: 'failed', error: 'timeout' },
      )
      const response = await result
      const payload = JSON.parse((response.content as { text: string }[])[0]!.text)
      if (status === 'applied') {
        expect(payload.passed).toBe(true)
        expect(kinds).toEqual(['mock.add', 'request.replay'])
        expect(targets).toEqual(['a', 'a'])
      } else {
        expect(response.isError).toBe(true)
        expect(payload.error).toBe('timeout')
        expect(kinds).toEqual(['mock.add'])
      }
    } finally {
      await client.close()
      await server.close()
    }
  },
)
