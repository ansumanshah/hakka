import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerListRequestsTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'list_requests',
    {
      description:
        'List captured HTTP requests, newest first. Use limit to page through results (default 50, max 500).',
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().default(50).describe('Max results to return'),
        offset: z.number().int().min(0).optional().default(0).describe('Skip N results (for pagination)'),
      },
    },
    (args) => {
      const { limit = 50, offset = 0 } = args
      const all = store.getAll({ limit: offset + limit })
      const page = all.slice(offset, offset + limit)
      return textResult({ total: store.size, offset, count: page.length, requests: page })
    },
  )
}
