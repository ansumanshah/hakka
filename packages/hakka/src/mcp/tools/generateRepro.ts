import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildReproBundle, compileQuery, parseRangeFilters, parseSearchTokens } from 'hakka-core'
import { generateTestFile } from 'hakka-core/test'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

// Read-only: the bundle is returned for the caller to write to disk (e.g. as
// a `.hakka-repro` file via serializeReproBundle).
export function registerGenerateReproTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'generate_repro',
    {
      description:
        'Build a self-contained "repro bundle" from a failing request (or a filtered session slice): the ' +
        'requests, the mock rules that replay them (same generation as generate_mocks), and a generated ' +
        'hakka-core/test regression test file (same generation as generate_test) — everything needed to hand a ' +
        'failure to someone else or file it as a reproducible bug. Selects requests using the same filters as ' +
        'search_requests (query DSL, method, urlContains). Read-only: nothing is sent over the bridge.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'Advanced search DSL string to narrow which captured requests go into the repro bundle — same ' +
              'grammar as search_requests: url:/header:/body: scopes, /regex/, *glob*, -negation, dur>/size> ranges.',
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
          .describe('Max requests to consider (most recent first), before mock dedup'),
        suiteName: z
          .string()
          .optional()
          .describe('Top-level describe() suite name for the generated test file. Default: "Hakka captured session".'),
        framework: z
          .enum(['vitest', 'bun', 'jest'])
          .optional()
          .default('vitest')
          .describe("Which test runner's globals the generated test file imports from. Default: vitest."),
        meta: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Free-form metadata to attach to the bundle (failure description, device, app version, …).'),
      },
    },
    (args) => {
      const { query, method, urlContains, limit = 50, suiteName, framework = 'vitest', meta } = args

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

      const bundle = buildReproBundle(pool, {
        mockOptions: { idPrefix: 'mcp-repro' },
        ...(meta !== undefined ? { meta } : {}),
      })
      const testFile = generateTestFile(pool, { suiteName, framework })

      return textResult({
        version: bundle.version,
        exportedAt: bundle.exportedAt,
        meta: bundle.meta,
        requests: bundle.requests,
        mocks: bundle.mocks,
        testFile,
      })
    },
  )
}
