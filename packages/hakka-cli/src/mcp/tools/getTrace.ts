import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { assembleTraceTree, summarizeTraceGroup } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import type { SpanStore } from '../SpanStore.js'
import { textResult } from './toolResult.js'

// Hands the resolved group's requests + spans to hakka-core's assembleTraceTree/summarizeTraceGroup —
// the same functions the browser's trace waterfall/badge use — rather than reimplementing here.
export function registerGetTraceTool(server: McpServer, store: RequestStore, spanStore: SpanStore): void {
  server.registerTool(
    'get_trace',
    {
      description:
        'Get the full trace (request hops + framework spans) for one logical operation: a browser fetch, the ' +
        "server work it triggered, and that work's upstream calls, correlated by `correlationId`/`traceId`. " +
        'Pass either `requestId` (any hop in the trace) or `correlationId` directly. Returns the same waterfall ' +
        'bars + badge summary the UI renders. Read-only: no bridge traffic.',
      inputSchema: {
        requestId: z
          .string()
          .optional()
          .describe('Any request id belonging to the trace — its correlationId is resolved automatically.'),
        correlationId: z.string().optional().describe('The trace/correlation id directly, if already known.'),
        verbose: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include verbose (non-primary) spans in the waterfall. Default false.'),
      },
    },
    (args) => {
      const { requestId, correlationId, verbose = false } = args

      if (!requestId && !correlationId) {
        return textResult({ error: 'invalid_args', message: 'One of requestId or correlationId is required' }, true)
      }

      let groupId: string
      if (correlationId) {
        groupId = correlationId
      } else {
        const seed = store.get(requestId!)
        if (!seed) {
          return textResult({ error: 'not_found', requestId }, true)
        }
        groupId = seed.correlationId ?? seed.id
      }

      const requests = store.getAll().filter((r) => (r.correlationId ?? r.id) === groupId)
      const spans = spanStore.getEntries().filter((s) => s.traceId === groupId)

      if (requests.length === 0) {
        return textResult({ error: 'not_found', groupId }, true)
      }

      const trace = assembleTraceTree(requests, spans, { verbose })
      const traceSummary = summarizeTraceGroup(requests, spans)

      return textResult({ groupId, requests, trace, traceSummary })
    },
  )
}
