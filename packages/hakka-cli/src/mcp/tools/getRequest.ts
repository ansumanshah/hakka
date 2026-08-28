import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { scrubNetworkRequestForShare } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerGetRequestTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'get_request',
    {
      description:
        'Get a single captured request by its id. Share-time scrubbing (secrets/PII pattern-matched and ' +
        'removed) is applied by default, since this hands the request straight into agent context — pass ' +
        '`unredacted: true` to see it as captured.',
      inputSchema: {
        id: z.string().describe('The request id'),
        unredacted: z
          .boolean()
          .optional()
          .default(false)
          .describe('Skip share-time scrubbing and return the request exactly as captured. Default false.'),
      },
    },
    (args) => {
      const req = store.get(args.id)
      if (!req) {
        return textResult({ error: 'not_found', id: args.id }, true)
      }
      if (args.unredacted) {
        return textResult({ ...req, redaction: { applied: false, removed: [] } })
      }
      const { request: scrubbed, removed } = scrubNetworkRequestForShare(req)
      return textResult({ ...scrubbed, redaction: { applied: true, removed } })
    },
  )
}
