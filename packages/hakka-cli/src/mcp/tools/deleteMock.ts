import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerDeleteMockTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'delete_mock',
    {
      description:
        'Delete a mock rule by id. The command is applied inside selected runtime; application is acknowledged ' +
        'over the bridge. Affects DEV builds only.',
      inputSchema: {
        targetId: z
          .string()
          .optional()
          .describe('Runtime target ID from list_targets; required when multiple peers are connected.'),
        id: z.string().min(1).describe('Mock rule id (as returned by create_mock)'),
      },
    },
    async (args) => {
      const sent = await dispatchAcknowledged(sender, args.targetId, { kind: 'mock.remove', id: args.id })
      if (!sent) {
        return textResult({ id: args.id, sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ id: args.id, sent: true })
    },
  )
}
