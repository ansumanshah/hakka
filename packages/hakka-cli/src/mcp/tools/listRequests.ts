import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { scrubRequestsForShare } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerListRequestsTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'list_requests',
    {
      description:
        'List captured HTTP requests, newest first. Use limit to page through results (default 50, max 500). ' +
        'Set summary: true to return selection fields only; use get_request for bodies and headers. ' +
        'Share-time scrubbing (secrets/PII pattern-matched and removed) is applied by default, since this hands ' +
        'requests straight into agent context — pass `unredacted: true` to see them as captured.',
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().default(50).describe('Max results to return'),
        offset: z.number().int().min(0).optional().default(0).describe('Skip N results (for pagination)'),
        summary: z
          .boolean()
          .optional()
          .default(false)
          .describe('Return only id, URL, method, status, duration and runtime.'),
        unredacted: z
          .boolean()
          .optional()
          .default(false)
          .describe('Skip share-time scrubbing and return requests exactly as captured. Default false.'),
      },
    },
    (args) => {
      const { limit = 50, offset = 0, unredacted = false, summary = false } = args
      const all = store.getAll({ limit: offset + limit })
      const page = all.slice(offset, offset + limit)
      const { requests, removed } = unredacted ? { requests: page, removed: [] } : scrubRequestsForShare(page)
      return textResult({
        total: store.size,
        offset,
        count: requests.length,
        requests: summary
          ? requests.map(({ id, url, method, status, duration, runtime }) => ({
              id,
              url,
              method,
              status,
              duration,
              runtime,
            }))
          : requests,
        redaction: { applied: !unredacted, removed },
      })
    },
  )
}
