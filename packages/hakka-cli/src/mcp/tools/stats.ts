import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerStatsTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'stats',
    {
      description: 'Aggregate stats over all requests currently in the store.',
    },
    (_extra) => {
      const s = store.stats()
      return textResult(s)
    },
  )
}
