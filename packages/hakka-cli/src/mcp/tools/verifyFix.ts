import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { analyzeRequests, scrubNetworkRequestForShare } from 'hakka-core'
import { z } from 'zod'

import { evaluateAssertions, evaluateOutcome } from '../../assert.js'
import type { RequestStore } from '../RequestStore.js'
import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { buildMockRuleFromArgs } from './mockRuleArgs.js'
import { awaitReplayResult, checkReplayable } from './replayHelpers.js'
import { textResult } from './toolResult.js'

const DEFAULT_TIMEOUT_MS = 5000

// "Fix, then verify" in one call: mock via buildMockRuleFromArgs (shared with
// create_mock), replay via replayHelpers (shared with replay_request), then
// check the outcome via assert.ts's evaluateOutcome/evaluateAssertions.
export function registerVerifyFixTool(server: McpServer, store: RequestStore, sender: ControlSender): void {
  server.registerTool(
    'verify_fix',
    {
      description:
        'Replay a captured request (optionally after installing a mock rule first) and check the outcome — ' +
        'status and/or response-body-contains. Returned captures are share-scrubbed. The "fix this, then verify it" loop in one call. Refuses ' +
        'websocket and server/edge-captured (Next.js) requests immediately (see replay_request).',
      inputSchema: {
        targetId: z
          .string()
          .optional()
          .describe('Runtime target ID from list_targets; required when multiple peers are connected.'),
        requestId: z.string().min(1).describe('The id of a previously captured request to replay and verify'),
        mock: z
          .object({
            pattern: z.string().min(1),
            method: z.string().optional(),
            mode: z.enum(['mock', 'block', 'redirect']).optional().default('mock'),
            status: z.number().int().optional().default(200),
            body: z.string().optional(),
            redirectTo: z.string().optional(),
            delayMs: z.number().int().min(0).optional(),
            modify: z
              .object({
                setRequestHeaders: z.record(z.string(), z.string()).optional(),
                removeRequestHeaders: z.array(z.string()).optional(),
                setQueryParams: z.record(z.string(), z.string()).optional(),
                removeQueryParams: z.array(z.string()).optional(),
                status: z.number().int().optional(),
                setResponseHeaders: z.record(z.string(), z.string()).optional(),
                removeResponseHeaders: z.array(z.string()).optional(),
                replaceBody: z.array(z.object({ find: z.string(), replace: z.string() })).optional(),
              })
              .optional(),
          })
          .optional()
          .describe('Optional mock/block/redirect rule to install (same shape as create_mock) before replaying.'),
        waitMs: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe('Delay after installing the mock, before replaying.'),
        timeoutMs: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(DEFAULT_TIMEOUT_MS)
          .describe('How long to wait for the replay to land.'),
        expect: z
          .object({
            status: z.number().int().optional(),
            bodyContains: z.string().optional(),
          })
          .optional()
          .describe('Expected outcome of the replayed request. Omit to only replay without asserting.'),
        maxDurationMs: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Also fail if the replayed request took longer than this.'),
      },
    },
    async (args) => {
      const targets = sender.getTargets?.()
      const targetId = args.targetId ?? (targets?.length === 1 ? targets[0]?.id : undefined)
      const { requestId, mock, waitMs = 0, timeoutMs = DEFAULT_TIMEOUT_MS, expect, maxDurationMs } = args

      const req = store.get(requestId)
      if (!req) {
        return textResult({ error: 'not_found', requestId }, true)
      }

      if (mock) {
        const mockId = `mcp-verify-mock-${randomUUID()}`
        const rule = buildMockRuleFromArgs(mockId, mock)
        const mockSent = await dispatchAcknowledged(sender, targetId, { kind: 'mock.add', rule })
        if (!mockSent) {
          return textResult({ error: 'bridge_disconnected', step: 'mock.add' }, true)
        }
      }

      if (waitMs > 0) {
        await sleep(waitMs)
      }

      const replayable = checkReplayable(req)
      if (!replayable.ok) {
        return textResult({ error: replayable.reason, message: replayable.message }, true)
      }

      const replayMarker = `mcp-verify-replay-${randomUUID()}`
      const replayResult = awaitReplayResult(store, replayMarker, timeoutMs)
      const replaySent = await dispatchAcknowledged(sender, targetId, {
        kind: 'request.replay',
        requestId,
        replayMarker,
      })
      if (!replaySent) {
        return textResult({ error: 'bridge_disconnected', step: 'request.replay' }, true)
      }

      const replayed = await replayResult
      if (!replayed) {
        return textResult({ error: 'timeout', message: `No replay landed within ${timeoutMs}ms` }, true)
      }

      const { request: scrubbed } = scrubNetworkRequestForShare(replayed)
      const violations = expect ? evaluateOutcome(replayed, expect) : []
      if (maxDurationMs !== undefined) {
        // maxFailures: Infinity so this single-request check doesn't also apply
        // evaluateAssertions' unrelated default (max-failures: 0), meant for the CLI's
        // whole-session `assert` command.
        const diagnosis = analyzeRequests([scrubbed])
        violations.push(
          ...evaluateAssertions([scrubbed], diagnosis, { maxDurationMs, maxFailures: Number.POSITIVE_INFINITY }),
        )
      }

      return textResult({ replayed: scrubbed, violations, passed: violations.length === 0 })
    },
  )
}
