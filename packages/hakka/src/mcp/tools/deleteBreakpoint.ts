import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatch } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerDeleteBreakpointTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'delete_breakpoint',
    {
      description:
        'Delete a breakpoint by id. The command is applied inside connected app(s); delivery is fire-and-forget ' +
        'over the bridge (no acknowledgment). Affects DEV builds only.',
      inputSchema: {
        id: z.string().min(1).describe('Breakpoint id (as returned by set_breakpoint)'),
      },
    },
    (args) => {
      const sent = dispatch(sender, { kind: 'breakpoint.remove', id: args.id })
      if (!sent) {
        return textResult({ id: args.id, sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ id: args.id, sent: true })
    },
  )
}
