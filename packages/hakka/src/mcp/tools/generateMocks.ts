import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { compileQuery, generateMockRules, parseRangeFilters, parseSearchTokens } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { type ControlSender, dispatch } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerGenerateMocksTool(server: McpServer, store: RequestStore, sender: ControlSender): void {
  server.registerTool(
    'generate_mocks',
    {
      description:
        '"Record, then mock": generate mock rules from already-captured traffic in one call. Selects requests ' +
        'using the same filters as search_requests (query DSL, method, urlContains), dedupes to one rule per ' +
        '(method, url path+query) — newest capture wins — and carries over status/content-type/body. With ' +
        'apply=false (default) the rules are returned for review only. With apply=true they are additionally ' +
        'sent as mock.add commands over the bridge (fire-and-forget, DEV builds only).',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'Advanced search DSL string to narrow which captured requests to generate mocks from — same grammar ' +
              'as search_requests: url:/header:/body: scopes, /regex/, *glob*, -negation, dur>/size> ranges.',
          ),
        method: z.string().optional().describe('HTTP method filter (GET, POST, …) — case-insensitive'),
        urlContains: z.string().optional().describe('Case-insensitive substring match against the full URL'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .default(50)
          .describe('Max requests to consider (most recent first), before dedup'),
        apply: z
          .boolean()
          .optional()
          .default(false)
          .describe('When true, also send each generated rule as a mock.add command over the bridge'),
      },
    },
    async (args) => {
      const { query, method, urlContains, limit = 50, apply = false } = args

      let pool = store.getAll()
      if (query && query.trim()) {
        const { ranges, rest } = parseRangeFilters(query)
        const predicate = compileQuery({ tokens: parseSearchTokens(rest), ...ranges })
        pool = pool.filter(predicate)
      }
      if (method) {
        const m = method.toUpperCase()
        pool = pool.filter((r) => r.method.toUpperCase() === m)
      }
      if (urlContains) {
        const needle = urlContains.toLowerCase()
        pool = pool.filter((r) => r.url.toLowerCase().includes(needle))
      }
      if (limit > 0) {
        pool = pool.slice(0, limit)
      }

      const rules = generateMockRules(pool, { idPrefix: 'mcp-gen' })

      if (!apply) {
        return textResult({ applied: 0, rules })
      }

      if (!sender.connected) {
        return textResult({ applied: 0, rules, error: 'bridge_disconnected' }, true)
      }

      let applied = 0
      for (const rule of rules) {
        const sent = dispatch(sender, { kind: 'mock.add', rule })
        if (sent) applied++
      }
      return textResult({ applied, rules })
    },
  )
}
