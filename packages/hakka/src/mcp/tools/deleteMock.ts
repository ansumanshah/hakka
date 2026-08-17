import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatch } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerDeleteMockTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'delete_mock',
    {
      description:
        'Delete a mock rule by id. The command is applied inside connected app(s); delivery is fire-and-forget ' +
        'over the bridge (no acknowledgment). Affects DEV builds only.',
      inputSchema: {
        id: z.string().min(1).describe('Mock rule id (as returned by create_mock)'),
      },
    },
    (args) => {
      const sent = dispatch(sender, { kind: 'mock.remove', id: args.id })
      if (!sent) {
        return textResult({ id: args.id, sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ id: args.id, sent: true })
    },
  )
}
