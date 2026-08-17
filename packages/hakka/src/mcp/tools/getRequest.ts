import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerGetRequestTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'get_request',
    {
      description: 'Get a single captured request by its id.',
      inputSchema: {
        id: z.string().describe('The request id'),
      },
    },
    (args) => {
      const req = store.get(args.id)
      if (!req) {
        return textResult({ error: 'not_found', id: args.id }, true)
      }
      return textResult(req)
    },
  )
}
