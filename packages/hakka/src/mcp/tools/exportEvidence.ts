import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildEvidenceBundle, compileQuery, parseRangeFilters, parseSearchTokens } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import type { SpanStore } from '../SpanStore.js'
import { textResult } from './toolResult.js'

/** Same (startTime asc, id tie-break) order `buildEvidenceBundle` sorts by internally — used here only to predict its default focal pick before spans can be resolved. */
function compareRequests(a: NetworkRequest, b: NetworkRequest): number {
  if (a.startTime !== b.startTime) return a.startTime - b.startTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// `logs` is always `[]` — the MCP process has no console-entry source; only
// the browser's "Copy as agent context" action captures real console entries.
export function registerExportEvidenceTool(server: McpServer, store: RequestStore, spanStore: SpanStore): void {
  server.registerTool(
    'export_evidence',
    {
      description:
        'Build a size-budgeted "evidence bundle" from already-captured traffic: the requests, mock rules that ' +
        'replay them, the trace (request hops + framework spans), a diagnose summary, and console entries ' +
        "(browser-side only — always empty here, see the tool description note). Same shape the browser's " +
        '"Copy as agent context" action produces. Selects requests using the same filters as search_requests ' +
        '(query DSL, method, urlContains). Read-only: nothing is sent over the bridge.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Advanced search DSL string to narrow the pool — same grammar as search_requests.'),
        method: z.string().optional().describe('HTTP method filter (GET, POST, …) — case-insensitive'),
        urlContains: z.string().optional().describe('Case-insensitive substring match against the full URL'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .default(50)
          .describe('Max requests to consider (most recent first) before bundling'),
        focusRequestId: z
          .string()
          .optional()
          .describe('Which request the bundle is "about". Default: earliest in the selected pool.'),
        maxBytes: z.number().int().min(1).optional().describe('Size budget for the serialized bundle. Default 65536.'),
      },
    },
    (args) => {
      const { query, method, urlContains, limit = 50, focusRequestId, maxBytes } = args

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

      if (pool.length === 0) {
        return textResult({ error: 'no_requests', message: 'No requests matched the given filters' }, true)
      }

      const sorted = [...pool].sort(compareRequests)
      const focal = focusRequestId ? store.get(focusRequestId) : sorted[0]
      const groupId = focal?.correlationId
      const spans = groupId ? spanStore.getEntries().filter((s) => s.traceId === groupId) : []

      const bundle = buildEvidenceBundle(pool, {
        ...(focusRequestId !== undefined ? { focusRequestId } : {}),
        spans,
        logs: [],
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      })

      return textResult(bundle)
    },
  )
}
