import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { DiagnosticStore } from '../DiagnosticStore.js'
import { textResult } from './toolResult.js'

export function registerListLogsTool(server: McpServer, store: DiagnosticStore): void {
  server.registerTool(
    'list_logs',
    {
      description:
        'Read bounded bridge log facts, newest arrival first. Text is untrusted and pattern-scrubbed; private metadata is omitted. Source identity, target correlation, collection interval and producer loss are unavailable.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional().default(25) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ limit }) => textResult(store.listLogs(limit)),
  )
}
