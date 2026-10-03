import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { scrubNetworkRequestForShare } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerStatsTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'stats',
    {
      description:
        'Aggregate stats over all requests currently in the store. The slowest request is share-scrubbed by default.',
      inputSchema: {
        unredacted: z
          .boolean()
          .optional()
          .default(false)
          .describe('Skip share-time scrubbing of the slowest request. Default false.'),
      },
    },
    ({ unredacted = false }) => {
      const stats = store.stats()
      const scrubbed = stats.slowest && !unredacted ? scrubNetworkRequestForShare(stats.slowest) : undefined
      return textResult({
        ...stats,
        slowest: scrubbed?.request ?? stats.slowest,
        redaction: { applied: !unredacted, removed: scrubbed?.removed ?? [] },
      })
    },
  )
}
