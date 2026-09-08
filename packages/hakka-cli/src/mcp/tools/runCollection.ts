import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { runCollection } from '../../runCommand.js'
import { textResult } from './toolResult.js'

export function registerRunCollectionTool(server: McpServer): void {
  server.registerTool(
    'run_collection',
    {
      description:
        'Run a local Hakka collection directory or request.hakka without the desktop app. ' +
        'Sends the authored requests, checks assertions, and returns per-request outcomes without response bodies. ' +
        'Requests can change remote data; inspect the collection and obtain user authorization before execution. ' +
        'JavaScript hooks are disabled for MCP execution and fail before any request is sent; unsupported protocols fail explicitly.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        path: z.string().min(1).describe('Local collection directory or request.hakka file.'),
        environment: z.record(z.string(), z.string()).optional(),
        folder: z.string().optional().describe('Relative folder within the collection.'),
        dataFile: z.string().optional().describe('Local JSON or CSV dataset.'),
        repeat: z.number().int().min(1).max(100).default(1),
        timeoutMs: z.number().int().min(1).max(60000).default(10000),
      },
    },
    async ({ path, ...options }) => {
      try {
        const report = await runCollection(path, { ...options, allowScripts: false })
        return textResult(report, report.failed > 0)
      } catch {
        return textResult(
          {
            error: 'collection_run_failed',
            message: 'Check the collection format and paths, or use hakka run --json for input diagnostics.',
          },
          true,
        )
      }
    },
  )
}
