import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerDeleteBreakpointTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'delete_breakpoint',
    {
      description:
        'Delete a breakpoint by id. The command is applied inside selected runtime; application is acknowledged ' +
        'over the bridge. Affects DEV builds only.',
      inputSchema: {
        targetId: z
          .string()
          .optional()
          .describe('Runtime target ID from list_targets; required when multiple peers are connected.'),
        id: z.string().min(1).describe('Breakpoint id (as returned by set_breakpoint)'),
      },
    },
    async (args) => {
      const sent = await dispatchAcknowledged(sender, args.targetId, { kind: 'breakpoint.remove', id: args.id })
      if (!sent) {
        return textResult({ id: args.id, sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ id: args.id, sent: true })
    },
  )
}
