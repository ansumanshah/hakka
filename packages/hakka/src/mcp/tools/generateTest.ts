import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { compileQuery, parseRangeFilters, parseSearchTokens } from 'hakka-core'
import { generateTestFile } from 'hakka-core/test'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerGenerateTestTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'generate_test',
    {
      description:
        'Turn already-captured traffic into a runnable hakka-core/test regression test file. Selects requests using ' +
        'the same filters as search_requests (query DSL, method, urlContains), grouped by host into one describe ' +
        'block per host with one it() per request — asserting method/url/status, top-level response-shape keys ' +
        '(JSON bodies only, not deep values), and a generous 10x-captured duration bound. Requests with no status ' +
        'are skipped with a comment. Read-only: nothing is sent over the bridge, the file content is returned for ' +
        'the caller to write to disk.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'Advanced search DSL string to narrow which captured requests to generate the test from — same ' +
              'grammar as search_requests: url:/header:/body: scopes, /regex/, *glob*, -negation, dur>/size> ranges.',
          ),
        urlContains: z.string().optional().describe('Case-insensitive substring match against the full URL'),
        method: z.string().optional().describe('HTTP method filter (GET, POST, …) — case-insensitive'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .default(50)
          .describe('Max requests to consider (most recent first)'),
        suiteName: z
          .string()
          .optional()
          .describe('Top-level describe() suite name. Default: "Hakka captured session".'),
        framework: z
          .enum(['vitest', 'bun', 'jest'])
          .optional()
          .default('vitest')
          .describe("Which test runner's globals the generated file imports from. Default: vitest."),
      },
    },
    (args) => {
      const { query, urlContains, method, limit = 50, suiteName, framework = 'vitest' } = args

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

      const code = generateTestFile(pool, { suiteName, framework })
      return textResult({ count: pool.length, code })
    },
  )
}
