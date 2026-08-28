import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { analyzeRequests, compileQuery, parseRangeFilters, parseSearchTokens } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerDiagnoseTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'diagnose',
    {
      description:
        'Diagnose captured traffic in one call: ranked findings (failures with a likely cause, slow ' +
        'requests, plaintext secrets in request bodies, oversized responses, uncacheable GETs, and ' +
        'N+1 / repeated fetches), the slowest requests, and a one-line summary. Optionally scope with ' +
        'the same `query` DSL as search_requests (e.g. `url:/checkout`). Prefer this over paging raw ' +
        'requests when answering "why did X fail" or "why is this slow"; then act with create_mock / ' +
        'set_throttle / set_breakpoint.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Advanced search DSL to scope the diagnosis (same grammar as search_requests).'),
        slowMs: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Flag requests slower than this many ms as findings. Default 1000.'),
      },
    },
    (args) => {
      const { query, slowMs } = args
      let pool = store.getAll()
      if (query && query.trim()) {
        const { ranges, rest } = parseRangeFilters(query)
        const predicate = compileQuery({ tokens: parseSearchTokens(rest), ...ranges })
        pool = pool.filter(predicate)
      }
      return textResult(analyzeRequests(pool, slowMs !== undefined ? { slowMs } : {}))
    },
  )
}
