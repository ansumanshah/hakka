import { randomUUID } from 'node:crypto'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { scrubNetworkRequestForShare } from 'hakka-core'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { awaitReplayResult, checkReplayable } from './replayHelpers.js'
import { textResult } from './toolResult.js'

const DEFAULT_TIMEOUT_MS = 5000

// Waits event-driven (RequestStore.onAdd) for the replay to land back as a newly-captured request.
// checkReplayable runs BEFORE dispatch so non-replayable requests (websocket, send-only server/edge captures) fail fast instead of timing out.
export function registerReplayRequestTool(server: McpServer, store: RequestStore, sender: ControlSender): void {
  server.registerTool(
    'replay_request',
    {
      description:
        'Re-issue a previously captured request as a real network call inside the connected app, then wait for ' +
        'it to be recaptured and return the share-scrubbed result. Useful for "did my fix actually work" without a manual ' +
        'repro. Refuses websocket and server/edge-captured (Next.js) requests immediately with a structured ' +
        'error instead of timing out — see runtime_not_replayable.',
      inputSchema: {
        targetId: z
          .string()
          .optional()
          .describe('Runtime target ID from list_targets; required when multiple peers are connected.'),
        requestId: z.string().min(1).describe('The id of a previously captured request to replay'),
        timeoutMs: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(DEFAULT_TIMEOUT_MS)
          .describe('How long to wait for the replay to land. Default 5000.'),
      },
    },
    async (args) => {
      const { requestId, timeoutMs = DEFAULT_TIMEOUT_MS } = args

      const req = store.get(requestId)
      if (!req) {
        return textResult({ error: 'not_found', requestId }, true)
      }

      const replayable = checkReplayable(req)
      if (!replayable.ok) {
        return textResult({ error: replayable.reason, message: replayable.message }, true)
      }

      const replayMarker = `mcp-replay-${randomUUID()}`
      const replayResult = awaitReplayResult(store, replayMarker, timeoutMs)
      const sent = await dispatchAcknowledged(sender, args.targetId, {
        kind: 'request.replay',
        requestId,
        replayMarker,
      })
      if (!sent) {
        return textResult({ error: 'bridge_disconnected' }, true)
      }

      const replayed = await replayResult
      if (!replayed) {
        return textResult({ error: 'timeout', message: `No replay landed within ${timeoutMs}ms` }, true)
      }

      return textResult({ replayed: scrubNetworkRequestForShare(replayed).request })
    },
  )
}
