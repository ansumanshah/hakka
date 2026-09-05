import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { RequestStore } from '../RequestStore.js'
import { mockRuleEntryFor, refusalReasonFor } from './capturedMockConverter.js'
import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerPromoteCaptureToMockTool(server: McpServer, store: RequestStore, sender: ControlSender): void {
  server.registerTool(
    'promote_capture_to_mock',
    {
      description:
        'Freeze a captured request into a mock rule that replays its real response verbatim, then install it ' +
        'inside connected app(s) over the bridge. The rule matches the endpoint (scheme/host/port/path), not the ' +
        'one query string this capture happened to carry. Re-promoting the same capture replaces the same rule ' +
        'rather than duplicating it. Refuses to promote a capture that errored or never finished — mocking a ' +
        'captured failure or a still-pending request would fabricate a response that never happened. Delivery is ' +
        'acknowledged over the bridge. Affects DEV builds only.',
      inputSchema: {
        targetId: z
          .string()
          .optional()
          .describe('Runtime target ID from list_targets; required when multiple peers are connected.'),
        id: z.string().min(1).describe('The captured request id (as returned by list_requests / search_requests)'),
      },
    },
    async (args) => {
      const request = store.get(args.id)
      if (!request) {
        return textResult({ error: 'not_found', id: args.id }, true)
      }

      const refusal = refusalReasonFor(request)
      if (refusal === 'errored_capture') {
        return textResult(
          {
            error: 'errored_capture',
            id: args.id,
            message: `Capture ${args.id} errored (${request.error}) — refusing to promote it into a mock.`,
          },
          true,
        )
      }
      if (refusal === 'incomplete_capture') {
        return textResult(
          {
            error: 'incomplete_capture',
            id: args.id,
            message: `Capture ${args.id} has no response yet (still pending) — refusing to promote it into a mock.`,
          },
          true,
        )
      }

      const rule = mockRuleEntryFor(request)
      const sent = await dispatchAcknowledged(sender, args.targetId, { kind: 'mock.add', rule })
      if (!sent) {
        return textResult({ id: rule.id, sourceId: args.id, sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ id: rule.id, sourceId: args.id, sent: true, pattern: rule.pattern, method: rule.method })
    },
  )
}
