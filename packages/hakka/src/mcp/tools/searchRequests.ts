import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { compileQuery, parseRangeFilters, parseSearchTokens } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerSearchRequestsTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'search_requests',
    {
      description:
        'Search captured requests with optional filters. All filters (structured + query DSL) are ANDed. ' +
        'Returns newest first. `query` accepts the Hakka advanced search DSL: scopes url:/header:/body: ' +
        '(default scope searches all), /regex/, *glob*, -negation, quoted "phrases", and dur>/dur</size>/size< ' +
        'range tokens (ms / bytes with b|kb|mb suffix). Example: `url:/users -body:password dur>200`.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'Advanced search DSL string. Scopes: url:, header:/headers:, body: (default = all). ' +
              '/regex/ for regex, *glob* for wildcard, plain text for substring, -token to negate, ' +
              '"quoted phrase" for literal spaces. Range tokens: dur>100, dur<=500 (ms); size>1kb, size<2mb (bytes).',
          ),
        method: z.string().optional().describe('HTTP method filter (GET, POST, …) — case-insensitive'),
        status: z.number().int().optional().describe('Minimum HTTP status code (e.g. 400 returns 4xx and 5xx)'),
        urlContains: z.string().optional().describe('Case-insensitive substring match against the full URL'),
        runtime: z
          .enum(['client', 'server', 'edge'])
          .optional()
          .describe('Filter by capture runtime (client / server / edge)'),
        errorOnly: z.boolean().optional().default(false).describe('Only return errored or 4xx/5xx requests'),
        limit: z.number().int().min(1).max(500).optional().default(50),
      },
    },
    (args) => {
      const { query, method, status, urlContains, runtime, errorOnly, limit = 50 } = args

      // DSL narrows the pool first (unbounded); structured filters and `limit` apply afterward — same order as the web/RN/iOS/Android UIs.
      let pool = store.getAll()
      if (query && query.trim()) {
        const { ranges, rest } = parseRangeFilters(query)
        const predicate = compileQuery({ tokens: parseSearchTokens(rest), ...ranges })
        pool = pool.filter(predicate)
      }

      let results = pool
      if (method) {
        const m = method.toUpperCase()
        results = results.filter((r) => r.method.toUpperCase() === m)
      }
      if (status !== undefined) {
        results = results.filter((r) => (r.status ?? 0) >= status)
      }
      if (urlContains) {
        const needle = urlContains.toLowerCase()
        results = results.filter((r) => r.url.toLowerCase().includes(needle))
      }
      if (runtime) {
        results = results.filter((r) => r.runtime === runtime)
      }
      if (errorOnly) {
        results = results.filter((r) => Boolean(r.error) || (r.status != null && r.status >= 400))
      }
      if (limit > 0) {
        results = results.slice(0, limit)
      }

      return textResult({ count: results.length, requests: results })
    },
  )
}
