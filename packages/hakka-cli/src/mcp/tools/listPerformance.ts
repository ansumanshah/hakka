import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { DiagnosticStore } from '../DiagnosticStore.js'
import { textResult } from './toolResult.js'

export function registerListPerformanceTool(server: McpServer, store: DiagnosticStore): void {
  server.registerTool(
    'list_performance',
    {
      description:
        'Read bounded canonical v1 performance measurements, newest arrival first. Missing measurements are omitted. Store eviction and invalid input counts do not establish producer drop counts, collection interval, target correlation or source identity.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional().default(25) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ limit }) => textResult(store.listPerformance(limit)),
  )
}
