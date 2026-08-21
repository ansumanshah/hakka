import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { compileQuery, detectLeaks, parseRangeFilters, parseSearchTokens } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerDetectLeaksTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'detect_leaks',
    {
      description:
        'Detect captured traffic sending a credential or PII somewhere it should not: a bearer ' +
        'token/JWT/API key/session cookie sent to a host outside a first-party allowlist, a request ' +
        'that starts carrying an email/phone/device-id field its endpoint never carried before, PII ' +
        'in a URL or query string, and a credential in a place that gets cached (a GET query string, ' +
        'or a response marked cacheable). Every finding carries the evidence that produced it — never ' +
        'a bare score. Silence on a category means nothing was confident enough to report, not that ' +
        'the category was not checked. Optionally scope with the same `query` DSL as search_requests.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Advanced search DSL to scope the scan (same grammar as search_requests).'),
        firstPartyHosts: z
          .array(z.string())
          .optional()
          .describe(
            'Hostnames or glob patterns (e.g. "*.myapp.com") that are your own infrastructure. ' +
              'Omit to auto-infer the busiest host in this capture as first-party; if the capture is ' +
              'too small or too flat to infer confidently, credential-to-third-party detection is ' +
              'skipped rather than guessed.',
          ),
      },
    },
    (args) => {
      const { query, firstPartyHosts } = args
      let pool = store.getAll()
      if (query && query.trim()) {
        const { ranges, rest } = parseRangeFilters(query)
        const predicate = compileQuery({ tokens: parseSearchTokens(rest), ...ranges })
        pool = pool.filter(predicate)
      }
      return textResult(detectLeaks(pool, firstPartyHosts ? { firstPartyHosts } : {}))
    },
  )
}
